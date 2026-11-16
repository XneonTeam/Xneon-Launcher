// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test } from "bun:test"
import fs, { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { unlinkSync } from "node:fs"
import { recoverModpackInstall, stageModpackInstall, writeModpackDownload, validateModpackPaths } from "../../electrobun/main/builds/modpack-install.ts"
import { createArchive } from "../../electrobun/main/cloud/archive-builder.ts"
import { listArchiveEntries, packArchiveSync } from "../../packages/xnlc-archives/src/index.ts"
import { excluded } from "../../packages/xnlc-share/src/manifest.ts"

{
  const hash = (value: string) => createHash("sha256").update(value).digest("hex")
  describe("modpack-install", () => {
    test("дубли нормализованных путей и file/directory конфликты отсекаются до записи", () => {
      for (const paths of [["mods/a.jar", "Mods/A.jar"], ["config/é.json", "config/e\u0301.json"], ["mods/a.jar", "mods/a.jar/child"], ["mods/a.jar/child", "mods/a.jar"]]) {
        expect(() => validateModpackPaths(paths)).toThrow()
      }
      expect(() => validateModpackPaths(["mods/a.jar", "mods/b.jar", "config/settings.json"])).not.toThrow()
    })

    test("повторные обновления сохраняют disabled layout и каноническое имя прежнего файла", () => fixture(async root => {
      await install(root, { "mods/Case.jar": "one" })
      await fs.rename(path.join(root, "mods/Case.jar"), path.join(root, "mods/Case.jar.disabled"))
      await install(root, { "mods/case.jar": "two" })
      await install(root, { "mods/CASE.jar": "three" })
      expect(await fs.readdir(path.join(root, "mods"))).toEqual(["Case.jar.disabled"])
      expect(await fs.readFile(path.join(root, "mods/Case.jar.disabled"), "utf8")).toBe("three")
    }))

    test("новое имя версии управляемого мода наследует disabled по точной metadata identity", () => fixture(async root => {
      const archives = new Map(["1", "2"].map(version => [version, packArchiveSync({ "fabric.mod.json": Buffer.from(JSON.stringify({ id: "demo", name: "Demo", version })) })]))
      const jar = (version: string) => archives.get(version)!
      for (const [relative, version] of [["mods/demo-1.jar", "1"], ["mods/demo-2.jar", "2"]]) {
        const operation = await stageModpackInstall(root)
        try {
          await fs.mkdir(path.join(operation.directory, "mods"))
          await fs.writeFile(path.join(operation.directory, relative), jar(version))
          await operation.apply(async () => {})
        } finally { await operation.close() }
        if (version === "1") await fs.rename(path.join(root, relative), path.join(root, relative + ".disabled"))
      }
      expect(await fs.readdir(path.join(root, "mods"))).toEqual(["demo-2.jar.disabled"])
      expect(await fs.readFile(path.join(root, "mods/demo-2.jar.disabled"))).toEqual(jar("2"))
    }))

    test("legacy disabled переносит состояние, но неизвестные пользовательские байты не удаляются", () => fixture(async root => {
      const previous = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"1"}') })
      const incoming = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"2"}') })
      await fs.mkdir(path.join(root, "mods"))
      await fs.writeFile(path.join(root, "mods/user-original.jar.disabled"), previous)
      const operation = await stageModpackInstall(root)
      try {
        await fs.mkdir(path.join(operation.directory, "mods"))
        await fs.writeFile(path.join(operation.directory, "mods/new-version.jar"), incoming)
        await operation.apply(async () => {})
        expect((await fs.readdir(path.join(root, "mods"))).sort()).toEqual(["new-version.jar.disabled", "user-original.jar.disabled"])
        expect(await fs.readFile(path.join(root, "mods/user-original.jar.disabled"))).toEqual(previous)
        expect(await fs.readFile(path.join(root, "mods/new-version.jar.disabled"))).toEqual(incoming)
      } finally { await operation.close() }
    }))

    test("rollback переименованной disabled-версии восстанавливает прежний layout", () => fixture(async root => {
      const archives = ["1", "2"].map(version => packArchiveSync({ "fabric.mod.json": Buffer.from(JSON.stringify({ id: "rollback", version })) }))
      const first = await stageModpackInstall(root)
      try {
        await fs.mkdir(path.join(first.directory, "mods"))
        await fs.writeFile(path.join(first.directory, "mods/old.jar"), archives[0])
        await first.apply(async () => {})
      } finally { await first.close() }
      await fs.rename(path.join(root, "mods/old.jar"), path.join(root, "mods/old.jar.disabled"))
      const second = await stageModpackInstall(root)
      try {
        await fs.mkdir(path.join(second.directory, "mods"))
        await fs.writeFile(path.join(second.directory, "mods/new.jar"), archives[1])
        await expect(second.apply(async () => { throw new Error("scan failure") })).rejects.toThrow("scan failure")
        expect(await fs.readdir(path.join(root, "mods"))).toEqual(["old.jar.disabled"])
        expect(await fs.readFile(path.join(root, "mods/old.jar.disabled"))).toEqual(archives[0])
      } finally { await second.close() }
    }))

    test("legacy active JAR с тем же modId блокирует неоднозначную замену до изменения установленного пака", () => fixture(async root => {
      const previous = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"1"}') })
      const incoming = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"legacy","version":"2"}') })
      await fs.mkdir(path.join(root, "mods"))
      await fs.writeFile(path.join(root, "mods/user-owned.jar"), previous)
      const operation = await stageModpackInstall(root)
      try {
        await fs.mkdir(path.join(operation.directory, "mods"))
        await fs.writeFile(path.join(operation.directory, "mods/new-version.jar"), incoming)
        await expect(operation.apply(async () => {})).rejects.toMatchObject({ code: "UNMANAGED_MOD_CONFLICT" })
        expect(await fs.readdir(path.join(root, "mods"))).toEqual(["user-owned.jar"])
        expect(await fs.readFile(path.join(root, "mods/user-owned.jar"))).toEqual(previous)
      } finally { await operation.close() }
    }))

    test("ENOSPC при применении после backup восстанавливает прежние файлы и manifest", () => fixture(async root => {
      await install(root, { "mods/test.jar": "old" })
      const previous = await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")
      const operation = await stageModpackInstall(root)
      const rename = fs.rename
      try {
        const source = path.join(operation.directory, "mods/test.jar")
        await put(operation.directory, "mods/test.jar", "new")
        fs.rename = async (from, to) => {
          if (from === source) throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" })
          return rename(from, to)
        }
        await expect(operation.apply(async () => {})).rejects.toMatchObject({ code: "ENOSPC" })
        expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("old")
        expect(await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")).toBe(previous)
      } finally { fs.rename = rename; await operation.close() }
    }))
    async function put(root: string, relative: string, contents: string) {
      const file = path.join(root, relative)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, contents)
    }
    async function fixture(run: (root: string) => Promise<void>) {
      const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-install-"))
      try { await run(root) } finally { await fs.rm(root, { recursive: true, force: true }) }
    }
    async function install(root: string, files: Record<string, string>, validate = async () => {}) {
      const operation = await stageModpackInstall(root)
      try {
        for (const [name, bytes] of Object.entries(files)) await put(operation.directory, name, bytes)
        await operation.apply(validate)
      } finally { await operation.close() }
    }

    test("подготовка не меняет установленную версию; отказ удаляет только staging", () => fixture(async root => {
      await put(root, "mods/old.jar", "old")
      const operation = await stageModpackInstall(root)
      await put(operation.directory, "mods/new.jar", "new")
      expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
      await expect(fs.access(path.join(root, "mods/new.jar"))).rejects.toMatchObject({ code: "ENOENT" })
      await operation.close()
      await expect(fs.access(operation.directory)).rejects.toMatchObject({ code: "ENOENT" })
    }))

    test("отмена до применения не меняет файлы и manifest", () => fixture(async root => {
      await install(root, { "mods/old.jar": "old" })
      const before = await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")
      const controller = new AbortController()
      const operation = await stageModpackInstall(root, controller.signal)
      try {
        await put(operation.directory, "mods/new.jar", "new")
        controller.abort()
        await expect(operation.apply(async () => {})).rejects.toMatchObject({ name: "AbortError" })
        expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
        expect(await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")).toBe(before)
      } finally { await operation.close() }
    }))

    test("отказ финальной проверки откатывает замену, удаление, новые файлы и manifest", () => fixture(async root => {
      await install(root, { "mods/old.jar": "old", "config/test.json": "initial" })
      const before = await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")
      await expect(install(root, { "mods/new.jar": "new", "config/test.json": "updated" }, async () => { throw new Error("scan failed") })).rejects.toThrow("scan failed")
      expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
      expect(await fs.readFile(path.join(root, "config/test.json"), "utf8")).toBe("initial")
      expect(await fs.readFile(path.join(root, ".xnlc-modpack/managed.json"), "utf8")).toBe(before)
      await expect(fs.access(path.join(root, "mods/new.jar"))).rejects.toMatchObject({ code: "ENOENT" })
    }))

    test("отмена после записи файлов откатывается до подтверждения commit", () => fixture(async root => {
      await install(root, { "mods/old.jar": "old" })
      const controller = new AbortController()
      const operation = await stageModpackInstall(root, controller.signal)
      try {
        await put(operation.directory, "mods/new.jar", "new")
        await expect(operation.apply(async () => { controller.abort() })).rejects.toMatchObject({ name: "AbortError" })
        expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
      } finally { await operation.close() }
    }))

    test("изменённые overrides, legacy-файлы и миры не удаляются и не перезаписываются", () => fixture(async root => {
      await install(root, { "config/test.json": "initial", "mods/old.jar": "old" })
      await put(root, "config/test.json", "personal")
      await put(root, "mods/local.jar", "local")
      await put(root, "saves/world/level.dat", "world")
      await install(root, { "config/test.json": "updated", "mods/local.jar": "pack", "saves/world/level.dat": "replacement", "mods/new.jar": "new" })
      expect(await fs.readFile(path.join(root, "config/test.json"), "utf8")).toBe("personal")
      expect(await fs.readFile(path.join(root, "mods/local.jar"), "utf8")).toBe("local")
      expect(await fs.readFile(path.join(root, "saves/world/level.dat"), "utf8")).toBe("world")
      await expect(fs.access(path.join(root, "mods/old.jar"))).rejects.toMatchObject({ code: "ENOENT" })
    }))

    test("обновление выключенного пути оставляет файл выключенным", () => fixture(async root => {
      await install(root, { "mods/optional.jar": "old" })
      await fs.rename(path.join(root, "mods/optional.jar"), path.join(root, "mods/optional.jar.disabled"))
      await install(root, { "mods/optional.jar": "updated" })
      expect(await fs.readFile(path.join(root, "mods/optional.jar.disabled"), "utf8")).toBe("updated")
      await expect(fs.access(path.join(root, "mods/optional.jar"))).rejects.toMatchObject({ code: "ENOENT" })
    }))

    test("конкурентная подготовка получает одного владельца каталога", () => fixture(async root => {
      const results = await Promise.allSettled([stageModpackInstall(root), stageModpackInstall(root)])
      const ready = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof stageModpackInstall>>> => result.status === "fulfilled")
      try { expect(ready).toHaveLength(1) } finally { await Promise.all(ready.map(result => result.value.close())) }
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
    }))

    test("проверка перед применением может запретить установку при запущенной игре", () => fixture(async root => {
      await put(root, "mods/old.jar", "old")
      const operation = await stageModpackInstall(root, undefined, () => { throw new Error("game running") })
      try {
        await put(operation.directory, "mods/new.jar", "new")
        await expect(operation.apply(async () => {})).rejects.toThrow("game running")
        expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
      } finally { await operation.close() }
    }))

    test("ссылка в каталоге назначения не используется для записи", () => fixture(async root => {
      await fs.mkdir(path.join(root, "outside"))
      await fs.symlink(path.join(root, "outside"), path.join(root, "mods"), "junction")
      await expect(install(root, { "mods/test.jar": "new" })).rejects.toThrow("link")
      expect(await fs.readdir(path.join(root, "outside"))).toEqual([])
    }))

    test("ссылка вместо служебного каталога отклоняется без очистки её содержимого", () => fixture(async root => {
      const outside = path.join(root, "outside")
      await put(outside, "keep", "keep")
      await fs.symlink(outside, path.join(root, ".xnlc-modpack"), "junction")
      await expect(stageModpackInstall(root)).rejects.toThrow("link")
      expect(await fs.readFile(path.join(outside, "keep"), "utf8")).toBe("keep")
    }))

    test("входной архив не может заменить manifest установщика", () => fixture(async root => {
      await expect(install(root, { ".xnlc-modpack/managed.json": "{}" })).rejects.toThrow("installation state")
    }))

    for (const installed of [false, true]) {
      test(`восстановление после остановки процесса: новый файл записан=${installed}`, () => fixture(async root => {
        const transaction = path.join(root, ".xnlc-modpack/transaction")
        await put(transaction, "0.old", "old")
        if (installed) await put(root, "mods/test.jar", "new")
        await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: false, changes: [{ path: "mods/test.jar", before: hash("old"), after: hash("new") }] }))
        await recoverModpackInstall(root)
        expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("old")
        await recoverModpackInstall(root)
        await expect(fs.access(transaction)).rejects.toMatchObject({ code: "ENOENT" })
      }))
    }

    test("восстановление не затирает правки после аварии и сохраняет резервную копию", () => fixture(async root => {
      const transaction = path.join(root, ".xnlc-modpack/transaction")
      await put(transaction, "0.old", "old")
      await put(root, "mods/test.jar", "user after crash")
      await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: false, changes: [{ path: "mods/test.jar", before: hash("old"), after: hash("new") }] }))
      await expect(recoverModpackInstall(root)).rejects.toThrow("recovery conflict")
      expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("user after crash")
      expect(await fs.readFile(path.join(transaction, "0.old"), "utf8")).toBe("old")
    }))

    test("некорректный журнал отклоняется до изменения файлов", () => fixture(async root => {
      const transaction = path.join(root, ".xnlc-modpack/transaction")
      await put(root, "keep", "keep")
      await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: false, changes: [{ path: "../keep", before: null, after: hash("keep") }] }))
      await expect(recoverModpackInstall(root)).rejects.toThrow("Invalid modpack file path")
      expect(await fs.readFile(path.join(root, "keep"), "utf8")).toBe("keep")
    }))

    test("подтверждённый журнал только удаляет backup, не откатывая новую версию", () => fixture(async root => {
      const transaction = path.join(root, ".xnlc-modpack/transaction")
      await put(transaction, "0.old", "old")
      await put(root, "mods/test.jar", "new")
      await put(transaction, "journal.json", JSON.stringify({ version: 1, committed: true, changes: [{ path: "mods/test.jar", before: hash("old"), after: hash("new") }] }))
      await recoverModpackInstall(root)
      expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("new")
    }))

    test("неверный sha1/sha512 не создаёт staged-файл", () => fixture(async root => {
      for (const hashes of [{ sha1: "0".repeat(40) }, { sha512: "0".repeat(128) }, { sha1: "invalid" }]) {
        const file = path.join(root, "test.jar")
        await expect(writeModpackDownload(file, Buffer.from("new"), hashes)).rejects.toThrow("mismatch")
        await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
      }
    }))

    test("сбой rename после backup восстанавливает исходный файл", () => fixture(async root => {
      await install(root, { "mods/test.jar": "old" })
      const operation = await stageModpackInstall(root, undefined, () => unlinkSync(path.join(operation.directory, "mods/test.jar")))
      try {
        await put(operation.directory, "mods/test.jar", "new")
        await expect(operation.apply(async () => {})).rejects.toMatchObject({ code: "ENOENT" })
        expect(await fs.readFile(path.join(root, "mods/test.jar"), "utf8")).toBe("old")
      } finally { await operation.close() }
    }))

    test("реальное аварийное завершение процесса оставляет восстанавливаемый журнал", () => fixture(async root => {
      await install(root, { "mods/old.jar": "old" })
      const code = `
    import fs from "node:fs/promises"
    import path from "node:path"
    import { stageModpackInstall } from "./electrobun/main/builds/modpack-install.ts"
    const operation = await stageModpackInstall(process.env.INSTALL_TEST_ROOT)
    await fs.mkdir(path.join(operation.directory, "mods"))
    await fs.writeFile(path.join(operation.directory, "mods/new.jar"), "new")
    await operation.apply(async () => process.exit(23))
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { env: { ...process.env, INSTALL_TEST_ROOT: root }, stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode).toBe(23)
      expect(await fs.readFile(path.join(root, "mods/new.jar"), "utf8")).toBe("new")
      await recoverModpackInstall(root)
      expect(await fs.readFile(path.join(root, "mods/old.jar"), "utf8")).toBe("old")
      await expect(fs.access(path.join(root, "mods/new.jar"))).rejects.toMatchObject({ code: "ENOENT" })
    }))

    test("CurseForge сохраняет опубликованные SHA-1 и размер для проверки загрузки", async () => {
      const original = globalThis.fetch
      try {
        globalThis.fetch = async () => Response.json({ data: [{ id: 1, modId: 2, fileName: "test.jar", fileLength: 3, downloadUrl: "https://fixture.invalid/mod", hashes: [{ algo: 1, value: "a".repeat(40) }] }] })
        const { curseforgeGetFiles } = await import("../../packages/xnlc-mods/src/curseforge-client")
        const files = await curseforgeGetFiles([1])
        expect(files[1].sha1).toBe("a".repeat(40))
        expect(files[1].fileLength).toBe(3)
      } finally { globalThis.fetch = original }
    })

    test("служебный журнал не попадает в облачный архив и публикацию Share", () => fixture(async root => {
      await put(root, "mods/local.jar", "local")
      await put(root, ".xnlc-modpack/transaction/0.old", "backup")
      await put(root, ".xnlc-modpack/managed.json", "{}")
      const output = path.join(root, "export.zip")
      await createArchive(root, output)
      const entries = (await listArchiveEntries(output)).filter(entry => !entry.directory).map(entry => entry.name)
      expect(entries).toEqual(["mods/local.jar"])
      expect(excluded(".xnlc-modpack/transaction/0.old")).toBe(true)
      expect(excluded(".xnlc-modpack/managed.json")).toBe(true)
    }))
  })
}

{
  // Отдельный процесс изолирует mock.module, файловый профиль и состояние импорта.
  const scenario = `
  import { mock } from "bun:test"
  import assert from "node:assert/strict"
  import fs from "node:fs/promises"
  import path from "node:path"
  import { EventEmitter } from "node:events"
  import { createHash } from "node:crypto"
  import { packArchiveSync } from "./packages/xnlc-archives/src/index.ts"
  const root = process.env.MODPACK_TEST_ROOT
  const provider = process.env.MODPACK_TEST_PROVIDER
  const mode = process.env.MODPACK_TEST_MODE
  const local = process.env.MODPACK_TEST_LOCAL === "1"
  const handlers = new Map()
  const directory = path.join(root, mode === "custom" ? "external-instance" : "intents/Pack")
  const sha1 = bytes => createHash("sha1").update(bytes).digest("hex")
  let generation = 1, failDownload = false, failScan = false
  const bytes = Buffer.from("generation-" + "x".repeat(4096))
  const file = () => generation === 1 ? "old.jar" : "new.jar"
  const mr = () => ({ name: "Pack", dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.0" }, files: [{ path: "mods/" + file(), downloads: ["https://fixture.invalid/mod"], hashes: { sha1: mode === "checksum" && generation === 2 ? "0".repeat(40) : sha1(bytes) } }] })
  const cf = () => ({ name: "Pack", minecraft: { version: "1.21.1", modLoaders: [] }, files: [{ projectID: 1, fileID: generation }] })
  const archive = () => packArchiveSync({
    [provider === "modrinth" ? "modrinth.index.json" : "manifest.json"]: Buffer.from(JSON.stringify(provider === "modrinth" ? mr() : cf())),
    "overrides/config/settings.txt": Buffer.from("pack-" + generation),
    "overrides/mods/optional.jar": bytes,
  })
  mock.module("./electrobun/platform/desktop.ts", () => ({ app: new EventEmitter(), rpcRegistry: { handle: (name, run) => handlers.set(name, run) }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(root, "pack.zip")] }) }, nativeImage: {} }))
  mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => root, getDefaultLauncherDataRoot: () => root, launcherLocationConfig: path.join(root, "location.json") }))
  mock.module("./electrobun/main/runtime.ts", () => ({ getMainWindow: () => local ? {} : null, logRuntime: () => {}, logRuntimeDebug: () => {}, sendToRenderer: () => {} }))
  mock.module("./electrobun/main/minecraft-core.ts", () => ({ isLaunchActive: () => false, isGameDirActive: () => false, getGameDir: async () => directory }))
  mock.module("./electrobun/main/shared-game-cache.ts", () => ({ prepareInstanceStorageSync: directory => directory }))
  mock.module("./electrobun/main/stats.ts", () => ({ notifyStatsUpdated: () => {} }))
  mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: { loadBuildsLight: async () => local ? [] : [{ id: "build", name: "Pack", source: provider, projectSlug: "pack", modId: 1, intentPath: directory }], findBuildByName: async () => ({ id: "build" }), findBuildById: async () => ({ id: "build", name: "Pack", intentPath: directory }), getSetting: async () => undefined } }))
  mock.module("./electrobun/main/builds/scanner.ts", () => ({ scanIntentDir: async target => {
    if (failScan) throw new Error("synthetic scan failure")
    const names = await fs.readdir(path.join(target, "mods"))
    return { mods: names.map(slug => ({ slug })), resourcepacks: [], shaders: [], installedMods: Object.fromEntries(names.map(name => [name, path.join(target, "mods", name)])) }
  } }))
  mock.module("./electrobun/main/builds/import-file-progress.ts", () => ({ describeModrinthImportFiles: async () => [], describeCurseforgeImportFiles: async () => [], describeFtbImportFiles: async () => [], withImportFileProgress: tasks => tasks }))
  mock.module("@xnlc/mods", () => ({
    modrinthGetRawVersions: async () => [{ id: "version", files: [{ filename: "pack.mrpack", url: "https://fixture.invalid/pack" }], game_versions: ["1.21.1"] }],
    curseforgeGetDownloadUrl: async (project, id) => id === 1000 ? "https://fixture.invalid/pack" : "https://fixture.invalid/mod",
    curseforgeGetFiles: async () => ({ [generation]: { fileName: file(), downloadUrl: "https://fixture.invalid/mod", sha1: mode === "checksum" && generation === 2 ? "0".repeat(40) : sha1(bytes) } }),
    ftbGetModpackVersion: async () => ({ targets: [{ name: "minecraft", version: "1.21.1" }], files: [{ path: "mods", name: file(), sha1: mode === "checksum" && generation === 2 ? "0".repeat(40) : sha1(bytes), url: "https://fixture.invalid/mod" }] }),
    getFTBPath: entry => entry.path + "/" + entry.name,
  }))
  globalThis.fetch = async url => {
    if (String(url) === "https://fixture.invalid/pack") return new Response(archive())
    if (String(url) === "https://fixture.invalid/mod") {
      if (mode === "cancel" && generation === 2) handlers.get("build:cancel-import")()
      return failDownload ? new Response("missing", { status: 404 }) : new Response(bytes)
    }
    throw new Error("Unexpected network request: " + url)
  }
  const { registerBuildHandlers } = await import("./electrobun/main/builds/index.ts")
  const { setModpackPersistence } = await import("./electrobun/main/builds/modpack-install.ts")
  const metadataWrites = []
  setModpackPersistence({
    begin: async () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    write: async (_directory, _token, fields) => metadataWrites.push(fields), rollback: async () => {}, finalize: async () => {},
  })
  registerBuildHandlers()
  const invoke = async () => {
    if (local) {
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(path.join(root, "pack.zip"), archive())
      return handlers.get("build:open-and-import")(undefined, "modpack")
    }
    return handlers.get("build:import-" + provider)(undefined, "Pack", ...(provider === "modrinth" ? ["pack", "version", "build"] : provider === "curseforge" ? [1, 1000, "build"] : [1, 1, "build"]))
  }
  const first = await invoke()
  assert.equal(first.success, true, JSON.stringify(first))
  if (!local) {
    assert.equal(metadataWrites.length, 1, "Main сохраняет metadata до ответа renderer")
    const saved = metadataWrites[0]
    assert.equal(saved.source, provider)
    assert.equal(saved.version, first.version)
    assert.equal(saved.modLoader, first.modLoader)
    assert.equal(saved.loaderVersion, first.loaderVersion)
    assert.equal(saved.customVersionPath, undefined)
    assert.deepEqual(saved.mods, first.mods)
    assert.deepEqual(saved.installedMods, first.installedMods)
    assert.equal(saved.modsCount, first.mods.length)
    assert.equal(saved.modpackVersion, provider === "modrinth" ? "version" : provider === "curseforge" ? "1000" : "1")
  }
  await fs.mkdir(path.join(directory, "saves", "World"), { recursive: true })
  await fs.writeFile(path.join(directory, "saves", "World", "level.dat"), "world")
  await fs.writeFile(path.join(directory, "mods", "personal.jar.disabled"), "personal")
  if (provider !== "ftb") {
    await fs.rename(path.join(directory, "mods", "optional.jar"), path.join(directory, "mods", "optional.jar.disabled"))
    await fs.writeFile(path.join(directory, "config", "settings.txt"), "user override")
  }
  generation = 2
  failDownload = mode === "download"
  failScan = mode === "scan"
  const second = await invoke()
  if (mode === "success" || mode === "custom") {
    assert.equal(second.success, true, JSON.stringify(second))
    assert.deepEqual(await fs.readFile(path.join(directory, "mods", "new.jar")), bytes)
    await assert.rejects(fs.access(path.join(directory, "mods", "old.jar")), { code: "ENOENT" })
    assert.equal(second.installedMods["new.jar"], path.join(directory, "mods", "new.jar"))
  } else {
    assert.equal(second.success, false, JSON.stringify(second))
    if (mode === "cancel") assert.equal(second.cancelled, true)
    assert.deepEqual(await fs.readFile(path.join(directory, "mods", "old.jar")), bytes)
    await assert.rejects(fs.access(path.join(directory, "mods", "new.jar")), { code: "ENOENT" })
  }
  assert.equal(await fs.readFile(path.join(directory, "mods", "personal.jar.disabled"), "utf8"), "personal")
  assert.equal(await fs.readFile(path.join(directory, "saves", "World", "level.dat"), "utf8"), "world")
  if (provider !== "ftb") {
    assert.equal(await fs.readFile(path.join(directory, "config", "settings.txt"), "utf8"), "user override")
    assert.deepEqual(await fs.readFile(path.join(directory, "mods", "optional.jar.disabled")), bytes)
    await assert.rejects(fs.access(path.join(directory, "mods", "optional.jar")), { code: "ENOENT" })
  }
`
  describe("modpack-update", () => {
    for (const provider of ["modrinth", "curseforge", "ftb"]) {
      for (const mode of ["download", "scan", "success", "cancel", "custom"]) {
        test(`${provider}: ${mode} сохраняет прежние файлы, overrides и выключенный контент`, async () => {
          const root = await mkdtemp(path.join(tmpdir(), "xnlc-modpack-update-"))
          try {
            const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", scenario], {
              env: { ...process.env, MODPACK_TEST_ROOT: root, MODPACK_TEST_PROVIDER: provider, MODPACK_TEST_MODE: mode },
              stdout: "pipe", stderr: "pipe",
            })
            expect({ code: result.exitCode, error: result.stderr.toString() }).toEqual({ code: 0, error: "" })
          } finally { await rm(root, { recursive: true, force: true }) }
        }, 30000)
      }
    }

    for (const provider of ["modrinth", "curseforge"]) {
      for (const mode of ["download", "scan", "success", "cancel"]) {
        test(`локальный ${provider}: ${mode} использует ту же безопасную установку`, async () => {
          const root = await mkdtemp(path.join(tmpdir(), "xnlc-local-modpack-"))
          try {
            const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", scenario], {
              env: { ...process.env, MODPACK_TEST_ROOT: root, MODPACK_TEST_PROVIDER: provider, MODPACK_TEST_MODE: mode, MODPACK_TEST_LOCAL: "1" },
              stdout: "pipe", stderr: "pipe",
            })
            expect({ code: result.exitCode, error: result.stderr.toString() }).toEqual({ code: 0, error: "" })
          } finally { await rm(root, { recursive: true, force: true }) }
        }, 30000)
      }
    }

    for (const provider of ["modrinth", "curseforge", "ftb"]) test(`${provider}: несовпадение хеша не заменяет установленную сборку`, async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xnlc-modpack-checksum-"))
      try {
        const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", scenario], {
          env: { ...process.env, MODPACK_TEST_ROOT: root, MODPACK_TEST_PROVIDER: provider, MODPACK_TEST_MODE: "checksum" },
          stdout: "pipe", stderr: "pipe",
        })
        expect({ code: result.exitCode, error: result.stderr.toString() }).toEqual({ code: 0, error: "" })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 30000)
  })
}

{
  describe("missing-mods-boundary", () => {
    test("missing-mods config не может писать вне staging; отмена не превращается в частичный успех", () => {
      // Подменяем только сеть/системные зависимости в отдельном процессе.
      const scenario = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import { createHash } from "node:crypto"
    import { tmpdir } from "node:os"
    mock.module("./electrobun/platform/desktop.ts", () => ({ app: { getPath: () => process.cwd(), on() {} } }))
    mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: {} }))
    mock.module("./electrobun/main/runtime.ts", () => ({ logRuntime() {}, getMainWindow() {} }))
    mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => process.cwd() }))
    const { collectMissingFiles, downloadMissingModFiles } = await import("./electrobun/main/builds/missing-mods.ts")
    const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-missing-mods-"))
    const entry = { pattern: "../../outside.jar", url: "https://curseforge.invalid/download/42" }
    try {
      assert.throws(() => collectMissingFiles(root, [entry]), /Invalid missing mod path/)
      await assert.rejects(downloadMissingModFiles(root, [entry]), /Invalid missing mod path/)
      const controller = new AbortController()
      controller.abort(new Error("cancelled"))
      await assert.rejects(downloadMissingModFiles(root, [{ ...entry, pattern: "valid.jar" }], { signal: controller.signal }), /cancelled/)
      assert.deepEqual(await fs.readdir(root), [])
      const bytes = Buffer.from("valid-jar")
      globalThis.fetch = async () => new Response(bytes)
      const loadModsModule = async () => ({ curseforgeGetFiles: async () => ({ 42: { downloadUrl: "https://fixture.invalid/mod", sha1: createHash("sha1").update(bytes).digest("hex"), fileLength: bytes.length } }) })
      const good = await downloadMissingModFiles(root, [{ ...entry, pattern: "valid.jar" }], { loadModsModule })
      assert.equal(good.downloaded, 1)
      assert.equal(await fs.readFile(path.join(root, "mods/valid.jar"), "utf8"), "valid-jar")
      globalThis.fetch = async () => new Response("corrupted")
      const bad = await downloadMissingModFiles(root, [{ ...entry, pattern: "bad.jar" }], { loadModsModule })
      assert.equal(bad.failed, 1)
      await assert.rejects(fs.access(path.join(root, "mods/bad.jar")), { code: "ENOENT" })
      assert.deepEqual(await fs.readdir(path.join(root, "mods")), ["valid.jar"])
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", scenario], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    })
  })
}
