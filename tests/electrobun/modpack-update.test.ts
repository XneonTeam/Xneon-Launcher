import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

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
