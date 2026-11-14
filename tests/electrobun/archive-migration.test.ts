import { expect, spyOn, test } from "bun:test"
import fs from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { packArchiveSync, readArchiveEntry } from "../../packages/xnlc-archives/src/index"
import { LegacyPreparation } from "../../packages/xnlc-core/src/core/legacy-preparation"
import { analyzeServerJar } from "../../packages/xnlc-servers/src/jar-analyzer"
import { createArchive } from "../../electrobun/main/cloud/archive-builder"
import { archiveService } from "../../electrobun/main/archives/service"
import { writeJavaArgFileIfTooLong } from "../../packages/xnlc-core/src/core/java-runner"

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
      const implementation = await readFile(new URL("../../packages/xnlc-core/src/core/legacy-preparation.ts", import.meta.url), "utf8")
      expect(implementation).not.toMatch(/\b(?:readFileSync|unzipSync)\s*\(/)
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
