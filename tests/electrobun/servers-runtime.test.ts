// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { copyCustomServerJar, createServerWithFiles, duplicateServerWithFiles } from "../../electrobun/main/mc-server-creation.ts"
import type { McServerRow } from "../../electrobun/db/mc-servers.ts"
import nodeTest from "node:test"
import assert from "node:assert/strict"
import { prepareServerRuntime } from "../../electrobun/main/mc-server-start.ts"
import { packArchiveSync } from "../../packages/xnlc-archives/src/index.ts"
import { analyzeServerJar } from "../../packages/xnlc-servers/src/jar-analyzer.ts"
import { analyze } from "../../packages/xnlc-parser/src/index.ts"

{
  const row = (id: string): McServerRow => ({ id, name: "Server", gameVersion: "1.21.1", modloader: "vanilla", modloaderVersion: null, port: 65535,
    xmx: 2048, xms: 1024, extraJavaArgs: "-Dtest=yes", javaPath: null, autoRestart: 0, icon: null, relayEnabled: 0,
    onlineMode: 1, maxPlayers: 20, createdAt: "2026-11-15", trashedAt: null, customJar: null, source: "local", group: "group" })

  async function fixture(run: (options: ReturnType<typeof optionsFor>, root: string) => Promise<void>) {
    const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-server-create-"))
    try { await run(optionsFor(root), root) } finally { await fs.rm(root, { recursive: true, force: true }) }
  }
  function optionsFor(root: string) {
    const rows = new Map<string, McServerRow>()
    return {
      rows, directory: (id: string) => path.join(root, id),
      store: {
        createMcServer: async (value: McServerRow) => { if (rows.has(value.id)) throw new Error("duplicate"); rows.set(value.id, value) },
        getMcServer: async (id: string) => rows.get(id) ?? null,
        listMcServers: async () => [...rows.values()],
        deleteMcServer: async (id: string) => { rows.delete(id) },
      },
    }
  }
  describe("server-creation", () => {
    test("дубликат сохраняет метаданные, мир и новый порт, в том числе при wrap 65535", () => fixture(async (options, root) => {
      const original = row("original")
      await createServerWithFiles(original, options, async stage => {
        await fs.mkdir(path.join(stage, "world"))
        await fs.writeFile(path.join(stage, "world/level.dat"), "world")
        await fs.writeFile(path.join(stage, "server.properties"), "server-port=65535\nonline-mode=true\n")
      })
      const copy = await duplicateServerWithFiles(original.id, options)
      expect(copy?.port).not.toBe(65535)
      expect(copy?.group).toBe("group")
      expect(copy?.extraJavaArgs).toBe("-Dtest=yes")
      expect(options.rows.get(copy!.id)?.port).toBe(copy!.port)
      expect(await fs.readFile(path.join(root, copy!.id, "world/level.dat"), "utf8")).toBe("world")
      expect(await fs.readFile(path.join(root, copy!.id, "server.properties"), "utf8")).toContain(`server-port=${copy!.port}`)
    }))

    test("ошибка подготовки не пишет строку БД и убирает только свой staging", () => fixture(async (options, root) => {
      await expect(createServerWithFiles(row("new"), options, async stage => {
        await fs.writeFile(path.join(stage, "partial"), "data")
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
      })).rejects.toMatchObject({ code: "ENOSPC" })
      expect(options.rows.size).toBe(0)
      expect(await fs.readdir(root)).toEqual([])
    }))

    test("ошибка БД компенсируется, конфликт каталога не затирает чужие файлы", () => fixture(async (options, root) => {
      options.store.createMcServer = async () => { throw new Error("database unavailable") }
      await expect(createServerWithFiles(row("failed"), options)).rejects.toThrow("database unavailable")
      expect(await fs.readdir(root)).toEqual([])
      await fs.mkdir(path.join(root, "taken"))
      await fs.writeFile(path.join(root, "taken/keep"), "keep")
      await expect(createServerWithFiles(row("taken"), options)).rejects.toThrow()
      expect(await fs.readFile(path.join(root, "taken/keep"), "utf8")).toBe("keep")
    }))

    test("отсутствующий исходный каталог и ссылка не маскируются под успешную копию", () => fixture(async (options, root) => {
      options.rows.set("original", row("original"))
      await expect(duplicateServerWithFiles("original", options)).rejects.toMatchObject({ code: "SERVER_SOURCE_MISSING" })
      await fs.mkdir(path.join(root, "original"))
      await fs.mkdir(path.join(root, "outside"))
      await fs.symlink(path.join(root, "outside"), path.join(root, "original/link"), process.platform === "win32" ? "junction" : "dir")
      await expect(duplicateServerWithFiles("original", options)).rejects.toThrow("link")
      expect(options.rows.size).toBe(1)
      expect((await fs.readdir(root)).sort()).toEqual(["original", "outside"])
    }))

    test("одновременные копии выбирают разные имена и порты", () => fixture(async options => {
      await createServerWithFiles(row("original"), options)
      const copies = await Promise.all([duplicateServerWithFiles("original", options), duplicateServerWithFiles("original", options)])
      expect(new Set(copies.map(value => value?.name)).size).toBe(2)
      expect(new Set(copies.map(value => value?.port)).size).toBe(2)
    }))

    test("custom JAR копируется асинхронно; отсутствующий источник не создаёт сервер", () => fixture(async (options, root) => {
      const source = path.join(root, "custom.jar")
      await fs.writeFile(source, Buffer.alloc(8 * 1024 * 1024, 42))
      const copy = fs.copyFile
      let yielded = false, usedAsyncCopy = false
      fs.copyFile = async (...args) => {
        usedAsyncCopy = true
        queueMicrotask(() => { yielded = true })
        await copy(...args)
        expect(yielded).toBe(true)
      }
      try {
        await createServerWithFiles(row("custom"), options, stage => copyCustomServerJar(source, stage))
        expect(usedAsyncCopy).toBe(true)
        expect((await fs.stat(path.join(root, "custom/custom-server.jar"))).size).toBe(8 * 1024 * 1024)
      } finally { fs.copyFile = copy }
      await expect(createServerWithFiles(row("missing"), options, stage => copyCustomServerJar(path.join(root, "missing.jar"), stage))).rejects.toMatchObject({ code: "ENOENT" })
      expect(options.rows.has("missing")).toBe(false)
    }))
  })
}

{
  describe("server-pack-transaction", () => {
    for (const source of ["modrinth", "curseforge"]) for (const failure of ["none", "download", "checksum"]) {
      test(`server pack ${source}/${failure}: файлы и запись БД публикуются только вместе`, () => {
        const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import fs from "node:fs/promises"
      import path from "node:path"
      import { tmpdir } from "node:os"
      import { createHash } from "node:crypto"
      import { packArchiveSync } from "./packages/xnlc-archives/src/index.ts"
      const source = ${JSON.stringify(source)}, failure = ${JSON.stringify(failure)}
      const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-server-pack-")), rows = new Map(), handlers = new Map()
      const serverRoot = path.join(root, "servers")
      const bytes = Buffer.from("jar-bytes")
      const sha1 = createHash("sha1").update(bytes).digest("hex")
      const mr = { name: "Fixture", dependencies: { minecraft: "1.21.1" }, files: [{ path: "mods/test.jar", downloads: ["https://fixture.invalid/mod"], hashes: { sha1: failure === "checksum" ? "0".repeat(40) : sha1 } }] }
      const cf = { minecraft: { version: "1.21.1", modLoaders: [] }, files: [{ projectID: 1, fileID: 42 }] }
      const archive = packArchiveSync({ [source === "modrinth" ? "modrinth.index.json" : "manifest.json"]: Buffer.from(JSON.stringify(source === "modrinth" ? mr : cf)), "overrides/config/test.json": Buffer.from("{}") })
      mock.module("./electrobun/platform/desktop.ts", () => ({ rpcRegistry: { handle: (name, handler) => handlers.set(name, handler) }, app: { on() {}, getPath: () => root }, DesktopWindow: { getAllWindows: () => [] }, dialog: {}, viewSession: {} }))
      mock.module("./electrobun/main/remote-servers/handlers.ts", () => ({ registerMcServerHandler: (name, handler) => handlers.set(name, handler) }))
      mock.module("./electrobun/main/paths.ts", () => ({ getLauncherDataRoot: () => root, getMcServerDir: id => path.join(serverRoot, id) }))
      mock.module("./electrobun/main/shared-game-cache.ts", () => ({ getMinecraftResourceRoot: () => root, prepareInstanceStorageSync() {} }))
      mock.module("./electrobun/main/runtime.ts", () => ({ logRuntime() {}, sendToRenderer() {}, getMainWindow: () => null }))
      mock.module("./electrobun/main/minecraft-core.ts", () => ({ loadXnlcModule: async () => ({}) }))
      mock.module("./electrobun/main/xn-connect-manager.ts", () => ({ xnConnectManager: {} }))
      mock.module("./electrobun/main/stats.ts", () => ({ recordServerSession() {} }))
      mock.module("./electrobun/platform/process-metrics.ts", () => ({ readProcessMetrics() {} }))
      mock.module("./electrobun/main/i18n.ts", () => ({ getMainTranslator: async () => (key, params) => key + JSON.stringify(params ?? {}) }))
      mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: {
        getSetting: async () => undefined, createMcServer: async value => rows.set(value.id, value), getMcServer: async id => rows.get(id) ?? null,
        listMcServers: async () => [...rows.values()], deleteMcServer: async id => rows.delete(id),
      } }))
      mock.module("@xnlc/servers", () => ({ serverManager: { setProcessMetricsReader() {} }, ensureServerJar() {}, analyzeServerJar() {} }))
      mock.module("@xnlc/core/retry", () => ({ fetchWithRetry: (...args) => fetch(...args) }))
      mock.module("@xnlc/mods", () => ({
        modrinthGetRawVersions: async () => [{ id: "version", name: "Fixture", files: [{ filename: "pack.mrpack", url: "https://fixture.invalid/pack" }] }],
        curseforgeGetDownloadUrl: async () => "https://fixture.invalid/pack",
        curseforgeGetFiles: async () => ({ 42: { downloadUrl: "https://fixture.invalid/mod", fileName: "test.jar", fileLength: bytes.length, sha1: failure === "checksum" ? "0".repeat(40) : sha1 } }),
      }))
      globalThis.fetch = async input => {
        if (String(input).endsWith("/pack")) return new Response(archive)
        if (failure === "download") throw new Error("offline")
        return new Response(bytes)
      }
      try {
        const { registerMcServerHandlers } = await import("./electrobun/main/mc-server-handlers.ts")
        registerMcServerHandlers()
        const install = handlers.get("mc-server:install-pack")
        const request = { source, projectSlug: "fixture", versionId: "version", modId: 1, fileId: 42, port: 25567 }
        if (failure !== "none") {
          await assert.rejects(install(null, request))
          assert.equal(rows.size, 0)
          assert.deepEqual(await fs.readdir(serverRoot), [])
        } else {
          const result = await install(null, request)
          assert.equal(rows.size, 1)
          assert.equal(result.port, 25567)
          assert.equal(rows.get(result.id).port, result.port)
          assert.equal(await fs.readFile(path.join(serverRoot, result.id, "mods/test.jar"), "utf8"), "jar-bytes")
          assert.equal(await fs.readFile(path.join(serverRoot, result.id, "config/test.json"), "utf8"), "{}")
        }
      } finally { await fs.rm(root, { recursive: true, force: true }) }
    `
        const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
        expect(result.exitCode, result.stderr.toString()).toBe(0)
      })
    }
  })
}

{
  const test = nodeTest
  function setup(prepareJava, prepareJar = async () => 'server.jar') {
    const events = [], progress = new Map(), token = { cancelled: false }
    let installs = 0
    return {
      token, events, progress, counts: () => ({ installs, starts: 0 }),
      run: () => prepareServerRuntime({
        info: { id: 'server', gameVersion: '26.3', modloader: 'vanilla' },
        row: { javaPath: 'auto', customJar: null }, directory: '/server', token,
        t: (key, values) => key + (values?.message ? ': ' + values.message : ''),
        globalJava: async () => undefined,
        java: (...args) => prepareJava(token, ...args),
        jar: async (...args) => { installs++; return prepareJar(token, ...args) },
        console: line => events.push(['mc-server:log', { id: 'server', line }]),
        cancelled: () => { progress.delete('server'); events.push(['mc-server:state-change', { id: 'server', state: { status: 'stopped' } }]) },
        progress: value => {
          if (value.phase === 'done' || value.phase === 'error') progress.delete('server')
          else progress.set('server', value)
          events.push(['mc-server:download-progress', { id: 'server', progress: value }])
        },
      }),
    }
  }
  describe("server-start-cancellation", () => {
    test('отмена подготовки Java не начинает установку ядра и не возвращает прогресс', async () => {
      const fixture = setup(async (token, _version, report) => { token.cancelled = true; report(50, 25); return { path: 'java' } })
      assert.equal(await fixture.run(), null)
      assert.deepEqual(fixture.counts(), { installs: 0, starts: 0 })
      assert.equal(fixture.progress.size, 0)
      assert.equal(fixture.events.filter(([channel]) => channel === 'mc-server:download-progress').length, 1)
      assert.equal(fixture.events.at(-1)[1].state.status, 'stopped')
    })
    test('ошибка Java снимает сохранённый прогресс и отправляет ошибку', async () => {
      const fixture = setup(async () => { throw new Error('runtime unavailable') })
      await assert.rejects(fixture.run(), /runtime unavailable/)
      assert.equal(fixture.progress.size, 0)
      assert.equal(fixture.events.at(-1)[1].progress.phase, 'error')
      assert.deepEqual(fixture.counts(), { installs: 0, starts: 0 })
    })
    test('отмена во время установки ядра не возвращает готовый runtime и прогресс', async () => {
      const fixture = setup(async () => ({ path: 'java' }), async (token, ...args) => {
        token.cancelled = true; args[5]({ phase: 'downloading', percent: 70 }); throw new Error('installation interrupted')
      })
      assert.equal(await fixture.run(), null)
      assert.deepEqual(fixture.counts(), { installs: 1, starts: 0 })
      assert.equal(fixture.progress.size, 0)
      assert.equal(fixture.events.at(-1)[1].state.status, 'stopped')
    })
    test('успешная подготовка возвращает Java и JAR, сохраняя Java override', async () => {
      let preferred
      const fixture = setup(async (_token, _version, _report, java) => { preferred = java; return { path: 'java' } })
      assert.deepEqual(await fixture.run(), { javaPath: 'java', jarPath: 'server.jar' })
      assert.equal(preferred, undefined)
      assert.equal(fixture.counts().installs, 1)
    })
  })
}

{
  describe("server-metadata-parity", () => {
    for (const loader of ["fabric", "forge", "neoforge"] as const) {
      test(`общие ${loader} metadata одинаково читаются server analyzer и content parser`, async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-metadata-parity-"))
        try {
          const name = loader === "fabric" ? "fabric.mod.json" : loader === "forge" ? "META-INF/mods.toml" : "META-INF/neoforge.mods.toml"
          const data = loader === "fabric" ? JSON.stringify({ id: "demo", version: "1", depends: { minecraft: ">=1.20.1" } })
            : `modLoader="javafml"\nloaderVersion="[1,)"\n[[mods]]\nmodId="demo"\nversion="1"\n[[dependencies.demo]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20.1,1.21)"\n`
          const bytes = packArchiveSync({ [name]: Buffer.from(data) })
          const file = path.join(root, "server.jar")
          await fs.writeFile(file, bytes)
          const server = await analyzeServerJar(file), content = await analyze(bytes)
          expect(server.loaderId).toBe(loader)
          expect(server.modId).toBe(content.mods.find(mod => mod.loader === loader)?.id ?? null)
          expect(server.minecraftVersion).toBe("1.20.1")
          expect(content.mods.find(mod => mod.loader === loader)?.minecraftVersions?.some(value => value.includes("1.20.1"))).toBe(true)
        } finally { await fs.rm(root, { recursive: true, force: true }) }
      })
    }

    test("нестроковый Fabric modId не превращается в валидную серверную идентичность", async () => {
      const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-invalid-metadata-"))
      try {
        const bytes = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":42,"version":"1"}') })
        const file = path.join(root, "server.jar")
        await fs.writeFile(file, bytes)
        const content = await analyze(bytes), server = await analyzeServerJar(file)
        expect(server.modId).toBe(content.mods[0]?.id ?? null)
      } finally { await fs.rm(root, { recursive: true, force: true }) }
    })
  })
}
