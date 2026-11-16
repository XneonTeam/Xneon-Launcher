// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test, setSystemTime, spyOn } from "bun:test"
import { ArchiveOperationBudget } from "../../electrobun/main/archives/operation-budget.ts"
import TestZip from "../helpers/zip.ts"
import fs from "node:fs"
import fsPromises, { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os, { tmpdir } from "node:os"
import { packArchiveSync, readArchiveEntry } from "../../packages/xnlc-archives/src/index.ts"
import { LegacyPreparation } from "../../packages/xnlc-core/src/core/legacy-preparation.ts"
import { analyzeServerJar } from "../../packages/xnlc-servers/src/jar-analyzer.ts"
import { createArchive } from "../../electrobun/main/cloud/archive-builder.ts"
import { archiveService } from "../../electrobun/main/archives/service.ts"
import { writeJavaArgFileIfTooLong } from "../../packages/xnlc-core/src/core/java-runner.ts"
import { bundledWorker } from "../../electrobun/platform/resources.ts"
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "../../electrobun/main/archives/protocol.ts"
import { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import { createArchive as createArchiveImported } from "../../dist-electrobun-tests/main/cloud/archive-builder.js"
import { META_ICON_ENTRY, META_NAME_ENTRY } from "../../dist-electrobun-tests/main/cloud/archive-meta.js"
import { createHash } from "node:crypto"
import { createThemeBundle, restoreThemeBundle } from "../../electrobun/main/cloud/theme-bundle.ts"
import { PNG } from "pngjs"

{
  describe("archive-budget", () => {
    test("архивные операции ограничены двумя задачами и очередь переживает ошибку", async () => {
      const budget = new ArchiveOperationBudget(2)
      let active = 0, peak = 0, finished = 0
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => budget.run(async () => {
        peak = Math.max(peak, ++active)
        try { await new Promise(resolve => setTimeout(resolve, 2)); if (index === 2) throw new Error("failure") }
        finally { active--; finished++ }
      })))
      expect(peak).toBe(2)
      expect(finished).toBe(10)
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
    })

    test("отменённая ожидающая задача не запускает Worker и не блокирует очередь", async () => {
      const budget = new ArchiveOperationBudget(1)
      const gate = Promise.withResolvers<void>()
      const first = budget.run(() => gate.promise)
      const controller = new AbortController()
      let ran = false
      const pending = budget.run(async () => { ran = true }, controller.signal)
      controller.abort(new Error("cancelled"))
      await expect(pending).rejects.toThrow("cancelled")
      gate.resolve()
      await first
      await budget.run(async () => {})
      expect(ran).toBe(false)
    })
  })
}

{
  describe("archive-fixture", () => {
    test("ZIP-фикстура сохраняет байты между повторными чтениями", () => {
      try {
        const fixture = new TestZip()
        fixture.addFile("item", Buffer.from("value"))
        setSystemTime(new Date("2026-01-01T00:00:00Z"))
        const first = fixture.toBuffer()
        setSystemTime(new Date("2026-01-02T00:00:00Z"))
        expect(fixture.toBuffer()).toEqual(first)
      } finally {
        setSystemTime()
      }
    })
  })
}

{
  describe("archive-migration", () => {
    test("classpath-JAR для Java 8 записывается асинхронно", async () => {
      const classpath = Array.from({ length: 200 }, (_, index) => path.join(tmpdir(), `library-${index}.jar`)).join(path.delimiter)
      const pending = writeJavaArgFileIfTooLong(["-cp", classpath, "Main"], classpath.length + 20, 1024, 8)
      const result = await pending
      try {
        expect(pending).toBeInstanceOf(Promise)
        expect(result.cleanupPath).not.toBeNull()
        const manifest = await readArchiveEntry(result.cleanupPath!, "META-INF/MANIFEST.MF")
        expect(manifest?.toString()).toContain("Class-Path: file:")
      } finally {
        if (result.cleanupPath) await rm(result.cleanupPath, { force: true })
      }
    })

    test("анализ серверного JAR асинхронен и читает только метаданные", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-jar-analysis-"))
      const syncRead = spyOn(fs, "readFileSync")
      try {
        const file = path.join(root, "server.jar")
        await writeFile(file, packArchiveSync({ "META-INF/MANIFEST.MF": Buffer.from("Manifest-Version: 1.0\nMain-Class: net.minecraft.server.Main\nMinecraft-Version: 1.21.1\n") }))
        const result = analyzeServerJar(file)
        expect(result).toBeInstanceOf(Promise)
        expect(await result).toMatchObject({ mainClass: "net.minecraft.server.Main" })
        expect(syncRead).not.toHaveBeenCalled()
      } finally {
        syncRead.mockRestore()
        await rm(root, { recursive: true, force: true })
      }
    })

    test("слияние legacy JAR сохраняет порядок патчей без синхронного чтения архивов", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-legacy-archive-"))
      try {
        await mkdir(path.join(root, "versions/base"), { recursive: true })
        await mkdir(path.join(root, "libraries/demo/patch/1"), { recursive: true })
        await writeFile(path.join(root, "versions/base/base.jar"), packArchiveSync({ "Example.class": Buffer.from("base"), "kept.txt": Buffer.from("kept"), "META-INF/SIGN.RSA": Buffer.from("signature") }))
        await writeFile(path.join(root, "libraries/demo/patch/1/patch-1.jar"), packArchiveSync({ "Example.class": Buffer.from("patched") }))
        const syncRead = spyOn(fs, "readFileSync")
        let result: string | undefined
        try {
          result = await new LegacyPreparation(root).prepare({ id: "base", type: "release", mainClass: "Main", libraries: [], jarMods: [{ name: "demo:patch:1" }] })
          expect(syncRead).not.toHaveBeenCalled()
        } finally {
          syncRead.mockRestore()
        }
        expect(result).toBeDefined()
        expect((await readArchiveEntry(result!, "Example.class"))?.toString()).toBe("patched")
        expect((await readArchiveEntry(result!, "kept.txt"))?.toString()).toBe("kept")
        expect(await readArchiveEntry(result!, "META-INF/SIGN.RSA")).toBeNull()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test("облачная упаковка проходит через ArchiveService", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-cloud-worker-"))
      const pack = spyOn(archiveService, "pack")
      try {
        await mkdir(path.join(root, "instance"))
        await writeFile(path.join(root, "instance/options.txt"), "settings")
        const output = path.join(root, "archive.zip")
        await createArchive(path.join(root, "instance"), output)
        expect(pack).toHaveBeenCalledTimes(1)
        expect((await readFile(output)).length).toBeGreaterThan(0)
      } finally {
        pack.mockRestore()
        await rm(root, { recursive: true, force: true })
      }
    })
  })
}

{
  async function runWorker(request: ArchiveWorkerRequest, cancelOnProgress = false): Promise<ArchiveWorkerResponse> {
    const worker = new Worker(new URL("../../electrobun/main/archives/archive.worker.ts", import.meta.url).href, { smol: true })
    try {
      return await new Promise<ArchiveWorkerResponse>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Archive worker response timeout")), 5000)
        worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
          if (event.data.type === "progress") {
            if (cancelOnProgress) worker.postMessage({ type: "abort", id: request.id })
            return
          }
          clearTimeout(timeout)
          resolve(event.data)
        }
        worker.onerror = (event: ErrorEvent) => {
          clearTimeout(timeout)
          reject(new Error(event.message))
        }
        worker.postMessage(request)
      })
    } finally {
      await worker.terminate()
    }
  }
  describe("archive-worker", () => {
    test("имя упакованного archive worker совпадает с путём фасада", () => {
      // Сборщик использует --entry-naming=[name].js и исходник archive.worker.ts.
      expect(path.basename(bundledWorker("archive-worker"))).toBe("archive.worker.js")
    })

    test("smol-воркер обрабатывает AbortController и сохраняет прежний файл", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-worker-abort-"))
      try {
        const outputPath = path.join(root, "archive.zip")
        const { writeFile, readdir } = await import("node:fs/promises")
        await writeFile(outputPath, "previous archive")
        const response = await runWorker({ type: "pack", id: 3, outputPath,
          sources: Array.from({ length: 1000 }, (_, index) => ({ kind: "data", entryName: `entry-${index}`, data: Buffer.alloc(4096, index % 256) })),
        }, true)
        expect(response).toMatchObject({ type: "error", code: "ABORTED" })
        expect(await readFile(outputPath, "utf8")).toBe("previous archive")
        expect(await readdir(root)).toEqual(["archive.zip"])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test("smol-воркер упаковывает архив и возвращает result", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-worker-pack-"))
      try {
        const outputPath = path.join(root, "archive.zip")
        expect(await runWorker({ type: "pack", id: 1, outputPath, sources: [
          { kind: "data", entryName: "config/мод.txt", data: Buffer.from("привет") },
        ] })).toMatchObject({ type: "result", files: 1 })
        expect((await readArchiveEntry(outputPath, "config/мод.txt"))?.toString()).toBe("привет")
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test("smol-воркер извлекает только выбранные записи и срезает префикс", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-worker-extract-"))
      try {
        const data = packArchiveSync({ "overrides/config/a.txt": Buffer.from("selected"), "ignored.txt": Buffer.from("ignored") })
        expect(await runWorker({ type: "extract", id: 2, destination: root, input: { data },
          entries: ["overrides/config/a.txt"], stripPrefix: "overrides/",
        })).toMatchObject({ type: "result", files: 1 })
        expect(await readFile(path.join(root, "config/a.txt"), "utf8")).toBe("selected")
        await expect(readFile(path.join(root, "ignored.txt"))).rejects.toMatchObject({ code: "ENOENT" })
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })
}

{
  const test = nodeTest
  const fs = fsPromises
  const createArchive = createArchiveImported
  async function makeIntent(root, files) {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(root, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
    }
  }
  describe("cloud-archive", () => {
    test("архив сборки содержит выбранные категории, метаданные и читается сторонним ZIP", async (t) => {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-cloud-archive-"))
      t.after(() => fs.rm(base, { recursive: true, force: true }))
      const intent = path.join(base, "intent")
      await makeIntent(intent, {
        "mods/a.jar": "jar-a",
        "mods/nested/b.jar": "jar-b",
        "mods/кириллица.jar": "мод",
        "config/x.txt": "cfg",
        "saves/world/level.dat": "level",
        "versions/1.20/client.json": "{}",
        "root.txt": "root",
      })

      const archivePath = path.join(base, "nested", "build.zip")
      const progress = []
      await createArchive(intent, archivePath, {
        categories: ["mods", "configs"],
        icon: "data:image/png;base64,AAA",
        name: "Моя сборка: v1",
        onProgress: (_stage, percent) => progress.push(percent),
      })

      const entries = new TestZip(await fs.readFile(archivePath)).getEntries()
      const contents = new Map(entries.map((entry) => [entry.entryName, entry.getData().toString("utf8")]))
      assert.deepEqual([...contents.keys()].sort(), [
        META_ICON_ENTRY,
        META_NAME_ENTRY,
        "config/",
        "config/x.txt",
        "mods/",
        "mods/a.jar",
        "mods/nested/",
        "mods/nested/b.jar",
        "mods/кириллица.jar",
      ])
      assert.equal(contents.get("mods/nested/b.jar"), "jar-b")
      assert.equal(contents.get("mods/кириллица.jar"), "мод")
      assert.equal(contents.get(META_ICON_ENTRY), "data:image/png;base64,AAA")
      assert.equal(contents.get(META_NAME_ENTRY), "Моя сборка: v1")
      assert.equal(progress.at(-1), 100)

      const fullArchive = path.join(base, "full.zip")
      await createArchive(intent, fullArchive)
      const full = new TestZip(await fs.readFile(fullArchive)).getEntries().map((entry) => entry.entryName).sort()
      assert.deepEqual(full, [
        "config/",
        "config/x.txt",
        "mods/",
        "mods/a.jar",
        "mods/nested/",
        "mods/nested/b.jar",
        "mods/кириллица.jar",
        "root.txt",
        "saves/",
        "saves/world/",
        "saves/world/level.dat",
      ])
    })

    test("пустая выборка категорий не создаёт архив и сообщает причину", async (t) => {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-cloud-archive-empty-"))
      t.after(() => fs.rm(base, { recursive: true, force: true }))
      const intent = path.join(base, "intent")
      await makeIntent(intent, { "mods/a.jar": "jar-a" })

      await assert.rejects(
        createArchive(intent, path.join(base, "build.zip"), { categories: ["saves"] }),
        /Нечего загружать/,
      )
    })
  })
}

{
  describe("theme-archive-streaming", () => {
    test("тема экспортируется прямо в файл через архивный фасад", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-theme-stream-"))
      const pack = spyOn(archiveService, "pack")
      try {
        const bytes = Buffer.from("theme background fixture")
        const name = `${createHash("sha256").update(bytes).digest("hex")}.png`
        await writeFile(path.join(root, name), bytes)
        const output = path.join(root, "theme.xntheme")
        const theme = { id: "fixture", name: "Fixture", primary: "#112233", accent: "#445566", background: { kind: "image", source: `xnl-theme://asset/${name}` } }
        await createThemeBundle(theme, root, output)
        expect(pack).toHaveBeenCalledTimes(1)
        expect((await readFile(output)).length).toBeGreaterThan(0)
        const restored = await restoreThemeBundle(output, path.join(root, "restored"))
        expect(restored.id).toBe("fixture")
        expect(await readFile(path.join(root, "restored", name))).toEqual(bytes)
      } finally {
        pack.mockRestore()
        await rm(root, { recursive: true, force: true })
      }
    })

    test("импорт темы распаковывает медиа через фасад и не устанавливает повреждённые файлы", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-theme-checksum-"))
      const extract = spyOn(archiveService, "extract")
      try {
        const name = `${"a".repeat(64)}.png`
        const destination = path.join(root, "media")
        await mkdir(destination)
        const theme = { id: "fixture", name: "Fixture", primary: "#112233", accent: "#445566" }
        const bytes = packArchiveSync({ "theme.json": Buffer.from(JSON.stringify({ format: "xneon-theme", version: 1, theme })), [`assets/${name}`]: Buffer.from("invalid checksum") })
        await expect(restoreThemeBundle(bytes, destination)).rejects.toThrow("checksum mismatch")
        expect(extract).toHaveBeenCalledTimes(1)
        await expect(readFile(path.join(destination, name))).rejects.toMatchObject({ code: "ENOENT" })
      } finally {
        extract.mockRestore()
        await rm(root, { recursive: true, force: true })
      }
    })
  })
}

{
  describe("theme-background-transfer", () => {
    test("a theme transfers its background bytes between profiles", async () => {
      const temp = path.resolve(".tmp")
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(path.join(temp, "theme-background-"))
      try {
        const png = new PNG({ width: 640, height: 480 })
        let state = 1
        for (let i = 0; i < png.data.length; i++) {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0
          png.data[i] = state >>> 24
        }
        const image = PNG.sync.write(png)
        const inline = "data:image/png;base64," + image.toString("base64")
        assert.ok(inline.length > 1024 * 1024)
        const name = createHash("sha256").update(image).digest("hex") + ".png"
        const managed = "xnl-theme://asset/" + name
        const sender = path.join(root, "sender")
        const legacy = path.join(root, "Фон.png")
        await mkdir(sender)
        await writeFile(path.join(sender, name), image)
        await writeFile(legacy, image)
        for (const [index, source] of [inline, managed, legacy].entries()) {
          const receiver = path.join(root, "receiver-" + index)
          const theme = { id: "custom-fixture", name: "Fixture", primary: "#112233", accent: "#445566", background: { kind: "image", source, dim: 0.2 } }
          const imported = await restoreThemeBundle(await createThemeBundle(theme, sender), receiver)
          assert.deepEqual(imported.background, { ...theme.background, source: managed })
          assert.deepEqual(await readFile(path.join(receiver, name)), image)
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })
}
