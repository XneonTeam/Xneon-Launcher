// Windows updater: канал, установка SDK/NSIS, cleanup и shutdown barrier,
// а также скачивание подписанного NSIS при смене канала. Manifest и feed
// проверяются отдельно в update-manifest.test.ts / update-feed.test.ts.
import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { once } from "node:events"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { describe, test } from "bun:test"
import { appIdentifier } from "../../electrobun/main/app-identity.ts"
import { updateBaseUrls } from "../../electrobun/main/repository-identity.ts"
import { verifySignedWindowsUpdateManifest } from "../../electrobun/main/verified-update-manifest.ts"
import nodeTest from "node:test"
import vm from "node:vm"
import { OperationGate, withinDeadline } from "../../electrobun/platform/operation-gate.ts"
import { ShutdownCoordinator } from "../../electrobun/platform/shutdown.ts"

{
  const test = nodeTest
  const source = await readFile(new URL("../../dist-electrobun-tests/main/updater.js", import.meta.url), "utf8")

  function fixture(overrides = {}, cleanup = {}, installed = "1.0.8-pre2") {
    const handlers = new Map()
    const events = []
    const downloads = []
    const expectations = []
    const spawned = []
    const stableBase = updateBaseUrls.stable
    const canaryBase = updateBaseUrls.canary
    const baseUrlOf = channel => channel === "canary" ? canaryBase : stableBase
    const channel = /-(?:pre|beta)\d+$/.test(installed) ? "canary" : "stable"
    const local = { channel, version: installed, hash: "old123", baseUrl: baseUrlOf(channel) }
    const manifest = { version: "1.0.9", channel: local.channel, hash: "next123", artifact: { file: `${local.channel}-win-x64-XneonLauncher.tar.zst` } }
    let selected = local.channel
    let pending = null
    let beforeQuit
    const order = []
    const gate = new OperationGate()
    const shutdown = new ShutdownCoordinator({ log() {} })
    if (cleanup.files) shutdown.register("files", cleanup.files)
    const dependencies = {
      // SDK на Windows больше не вызывается: события нужны только для before-quit.
      "electrobun/main": { default: { events: { on(name, callback) { if (name === "before-quit") beforeQuit = callback } } }, __esModule: true },
      "../../package.json": { version: installed },
      "./windows-update-identity": { readWindowsUpdateIdentity: overrides.readWindowsUpdateIdentity ?? (async () => local) },
      "./profile-path": { isPortable: cleanup.portable ?? false },
      "../platform/desktop": {
        app: { emit() {}, getPath: () => "fixture-temp" },
        rpcRegistry: { handle: (name, handler) => handlers.set(name, handler) },
      },
      "../platform/operation-gate": { launcherOperations: gate, withinDeadline: (op, ms, message) => withinDeadline(op, cleanup.timeout ?? ms, message) },
      "../platform/shutdown": { launcherShutdown: shutdown },
      "../db/core": { closeDatabaseForUpdate: () => order.push("db-close") },
      "../db": { initDatabase: async () => order.push("db-reopen") },
      "node:child_process": { spawn: (file, args, options) => {
        spawned.push({ file, args, options })
        order.push("spawn")
        return { on() {}, once(name, callback) { if (name === "spawn") queueMicrotask(callback); return this }, unref() {} }
      } },
      "./channel-switch": { downloadChannelInstaller: cleanup.installer ?? (async (target, onProgress, expected) => {
        downloads.push(target)
        expectations.push(expected)
        onProgress?.({ percent: 25, transferred: 25, total: 100 })
        const version = target === "canary" ? "1.0.9-pre1" : "1.0.9"
        return { channel: target, version, file: `xneon-launcher-${version}-win-x64.exe`, path: `fixture-installer-${target}.exe` }
      }) },
      "./repository-identity": { expectedUpdateBaseUrl: baseUrlOf },
      "./update-state": { launcherUpdateState: {
        getChannel: async () => selected,
        selectChannel: async value => { selected = value; pending = null },
        stage: async (_local, update, file) => { pending = { kind: "installer", update, path: file, deferred: false } },
        peek: async () => pending,
        defer: async () => { if (!pending) throw new Error("No downloaded update"); pending.deferred = true },
        clearPending: cleanup.clearPending ?? (async () => { pending = null }),
      } },
      "./verified-update-feed": {
        releaseChannelOf: version => /-(?:pre|beta)\d+$/.test(version) ? "canary" : "stable",
        resolveVerifiedUpdate: async (_version, target) => ({
          manifest: target === local.channel ? manifest : { ...manifest, channel: target, version: target === "canary" ? "1.0.9-pre1" : "1.0.9" },
          archiveUrl: baseUrlOf(target) + "/" + manifest.artifact.file,
        }),
        installedPreference: value => value === "canary" ? "beta" : "stable",
      },
      "./agent-mcp": { stopMcpConnections: cleanup.mcp ?? (async () => order.push("mcp")) },
      "./xn-connect-manager": { xnConnectManager: { stopAll: cleanup.relay ?? (async () => order.push("relay")) } },
      "./minecraft-core": { isLaunchActive: () => false },
      "./runtime": { isDev: false, sendToRenderer: (_, event) => events.push(event) },
    }
    const module = { exports: {} }
    vm.runInNewContext(source, { module, require: name => dependencies[name], Error, AbortController, AbortSignal, process: { platform: "win32", arch: "x64" } })
    module.exports.registerUpdater()
    return { check: handlers.get("update:check"), install: handlers.get("update:install"),
      getChannel: handlers.get("update:get-channel"),
      download: handlers.get("update:download"), changeChannel: value => handlers.get("update:set-channel")(null, value),
      defer: handlers.get("update:defer"), state: handlers.get("update:get-state"),
      cancel: handlers.get("update:cancel-install"), events, downloads, expectations, spawned, gate, order, shutdown, beforeQuit, local, manifest }
  }

  describe("updater", () => {
    test("portable: все update actions отклоняются без identity, сети и installer handoff", async () => {
      const forbidden = () => { throw new Error("Portable must not read identity or download") }
      const app = fixture({ readWindowsUpdateIdentity: forbidden }, { portable: true, installer: forbidden })
      assert.equal((await app.check()).error, "portable-manual-update")
      assert.equal((await app.download()).error, "portable-manual-update")
      assert.equal((await app.defer()).error, "portable-manual-update")
      assert.equal((await app.changeChannel("beta")).error, "portable-manual-update")
      await app.install()
      assert.equal(app.events.at(-1).error, "portable-manual-update")
      assert.equal((await app.state()).status, "idle")
      assert.deepEqual(app.downloads, [])
      assert.deepEqual(app.spawned, [])
      assert.deepEqual(app.order, [])
    })

    test("свой канал обновляется подписанным NSIS, а не нативным ядром", async () => {
      const app = fixture({}, {}, "1.0.8")
      assert.equal((await app.state()).status, "idle")
      assert.deepEqual({ ...(await app.check()) }, { available: true, version: "1.0.9" })
      assert.equal((await app.download()).success, true)
      assert.deepEqual(app.downloads, ["stable"])
      assert.deepEqual({ ...app.expectations[0] }, { version: "1.0.9", hash: "next123" })
      assert.equal((await app.defer()).success, true)
      await app.install()
      assert.equal(app.spawned.length, 1)
      assert.equal(app.spawned[0].file, "fixture-installer-stable.exe")
      assert.deepEqual([...app.spawned[0].args], ["/S", "--force-run"])
    })

    test("выбор и скачивание другой ветки не закрывают БД и не перезапускают лаунчер", async () => {
      const app = fixture({}, {}, "1.0.8")
      const result = await app.changeChannel("beta")
      assert.equal(result.state, "selected")
      assert.equal(await app.getChannel(), "beta")
      assert.equal(app.downloads.length, 0)
      assert.equal(app.spawned.length, 0)
      assert.equal(app.order.length, 0)
      assert.equal(app.gate.blocked, false)

      await app.check()
      assert.equal((await app.download()).success, true)
      assert.deepEqual(app.downloads, ["canary"])
      assert.equal(app.spawned.length, 0)
      assert.equal(app.order.length, 0)
      assert.equal(app.events.at(-1).status, "downloaded")
    })

    test("другая ветка ставится только подписанным установщиком по отдельному действию", async () => {
      const canaryBuild = fixture()
      assert.equal(await canaryBuild.getChannel(), "beta")
      assert.deepEqual({ ...(await canaryBuild.changeChannel("beta")) }, { state: "current" })
      assert.deepEqual({ ...(await canaryBuild.changeChannel("stable")) }, { state: "selected" })
      await canaryBuild.check()
      await canaryBuild.download()
      await canaryBuild.install()
      assert.deepEqual(canaryBuild.downloads, ["stable"])
      assert.deepEqual([...canaryBuild.spawned[0].args], ["/S", "--force-run"])
      assert.equal(canaryBuild.spawned[0].options.detached, true)
      assert.deepEqual(canaryBuild.order, ["mcp", "relay", "db-close", "spawn"], "Перед установщиком выполняется cleanup и закрывается БД")

      const stableBuild = fixture({}, {}, "1.0.8")
      assert.deepEqual({ ...(await stableBuild.changeChannel("beta")) }, { state: "selected" })
      await stableBuild.check()
      await stableBuild.download()
      await stableBuild.install()
      assert.deepEqual(stableBuild.downloads, ["canary"], "stable-сборка качает canary-установщик, а не открывает сайт")
      assert.equal(stableBuild.spawned[0].file, "fixture-installer-canary.exe")
    })

    test("смена канала передаёт в UI начальный и реальный прогресс установщика", async () => {
      const app = fixture({}, {}, "1.0.8")
      await app.changeChannel("beta")
      await app.check()
      await app.download()
      const progress = app.events.filter(event => "percent" in event)
      assert.equal(progress[0]?.percent, 0)
      assert.ok(progress.some(event => event.percent === 25 && event.transferred === 25 && event.total === 100))
    })

    test("сбой загрузки установщика не блокирует лаунчер и возвращает канал", async () => {
      const app = fixture({}, { installer: async () => { throw new Error("installer download failed") } })
      await app.changeChannel("stable")
      await app.check()
      const result = await app.download()
      assert.equal(result.success, false)
      assert.match(result.error, /installer download failed/)
      assert.equal(app.gate.blocked, false)
      assert.equal(app.spawned.length, 0)
      assert.equal(app.events.at(-1).status, "error")
    })

    test("«Позже» сохраняет отложенную установку без shutdown и возвращает состояние", async () => {
      const app = fixture({}, {}, "1.0.8")
      await app.changeChannel("beta")
      await app.check()
      await app.download()
      assert.equal((await app.state()).deferred, false)
      assert.equal((await app.defer()).success, true)
      assert.equal((await app.state()).deferred, true)
      assert.equal(app.spawned.length, 0)
      assert.equal(app.order.length, 0)
      assert.equal(app.gate.blocked, false)
    })

    test("установщик ждёт общий cleanup файлов до закрытия БД", async () => {
      const files = Promise.withResolvers(), started = Promise.withResolvers()
      const app = fixture({}, { files: async () => { started.resolve(); await files.promise; app.order.push("files") } })
      await app.check()
      await app.download()
      const installing = app.install()
      await started.promise
      assert.deepEqual(app.order, ["mcp", "relay"])
      files.resolve()
      await installing
      assert.deepEqual(app.order, ["mcp", "relay", "files", "db-close", "spawn"])
      assert.equal(app.spawned.length, 1)
      assert.equal(app.shutdown.started, true)
    })

    test("update veto не блокирует обычный выход после общего cleanup", async () => {
      const app = fixture()
      app.gate.blocked = true
      const preparing = {}
      app.beforeQuit(preparing)
      assert.equal(preparing.response.allow, false)
      await app.shutdown.run("quit")
      const completed = {}
      app.beforeQuit(completed)
      assert.equal(completed.response, undefined)
    })

    test("ошибка чтения локальных метаданных и чужая identity возвращаются по RPC без похода в feed", async () => {
      const broken = fixture({ readWindowsUpdateIdentity: async () => { throw new Error("Cannot read version") } })
      assert.equal((await broken.check()).error, "Cannot read version")
      assert.equal(broken.events.at(-1).status, "error")

      for (const local of [
        { channel: "canary", version: "1.0.8-pre2", hash: "old123", baseUrl: "https://evil.example/" },
        null,
      ]) {
        const app = fixture({ readWindowsUpdateIdentity: async () => local })
        assert.equal((await app.check()).error, "unsupported-package")
      }
      // dev-сборка без Resources/version.json: состояние idle, проверка отклоняется.
      const dev = fixture({ readWindowsUpdateIdentity: async () => null })
      assert.equal((await dev.state()).status, "idle")
      assert.equal((await dev.check()).error, "unsupported-package")
    })

    test("повторные запросы не запускают вторую очистку и отмена блокирует применение", async () => {
      let drained
      const app = fixture()
      const pending = app.gate.run(() => new Promise(resolve => { drained = resolve }))
      await app.check()
      assert.equal((await app.download()).success, true)
      const first = app.install()
      await app.install()
      assert.equal(app.cancel(), true)
      drained()
      await pending
      await first
      assert.deepEqual(app.order, [])
      assert.deepEqual(app.spawned, [])
      assert.equal(app.events.at(-1).error, "restart-cancelled")
      assert.equal(app.gate.blocked, false)
    })

    test("таймаут очистки MCP сохраняет открытой БД и не запускает установщик", async () => {
      const app = fixture({}, { mcp: () => new Promise(() => {}), timeout: 20 })
      await app.check()
      assert.equal((await app.download()).success, true)
      await app.install()
      assert.deepEqual(app.order, ["relay"])
      assert.deepEqual(app.spawned, [])
      assert.match(app.events.at(-1).error, /shutdown timed out/)
    })

    test("сбой cleanup не запускает установщик и снимает блокировку", async () => {
      const app = fixture({}, { files: async () => { throw new Error("files failed") } })
      await app.check()
      assert.equal((await app.download()).success, true)
      await app.install()
      assert.deepEqual(app.order, ["mcp", "relay"])
      assert.deepEqual(app.spawned, [])
      assert.match(app.events.at(-1).error, /cleanup-failed/)
      assert.equal(app.gate.blocked, false)
    })

    test("сбой после запуска установщика переоткрывает БД и возвращает управление", async () => {
      const app = fixture({}, { clearPending: async () => { throw new Error("state write failed") } })
      await app.check()
      assert.equal((await app.download()).success, true)
      await app.install()
      assert.deepEqual(app.order, ["mcp", "relay", "db-close", "spawn", "db-reopen"])
      assert.match(app.events.at(-1).error, /state write failed/)
      assert.equal(app.gate.blocked, false)
    })
  })
}

{
  const source = await readFile(new URL("../../dist-electrobun-tests/main/channel-switch.js", import.meta.url), "utf8")
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")
  const installerName = "xneon-launcher-1.0.9-pre1-win-x64.exe"
  const installerBytes = Buffer.from("xneon installer fixture")

  function manifestBytes(installer = {}) {
    return Buffer.from(JSON.stringify({
      schemaVersion: 1, identifier: appIdentifier, channel: "canary",
      version: "1.0.9-pre1", hash: "abc12345", platform: "win", arch: "x64",
      installer: {
        file: installerName,
        size: installer.size ?? installerBytes.length,
        sha256: installer.sha256 ?? sha256(installerBytes),
      },
      artifact: {
        file: "canary-win-x64-XneonLauncher-canary.tar.zst", tarSha256: "a".repeat(64),
        tarSize: 1000, downloadSize: 500, downloadSha256: "b".repeat(64),
      },
    }))
  }

  async function serve(payload, options = {}) {
    const files = new Map()
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const name = new URL(request.url).pathname.slice(1)
        const body = files.get(name)
        if (!body) return new Response("missing", { status: 404 })
        if (options.stream && name === installerName) {
          let offset = 0
          return new Response(new ReadableStream({
            async pull(controller) {
              await Bun.sleep(5)
              if (offset >= body.length) { controller.close(); return }
              controller.enqueue(body.subarray(offset, offset + 4))
              offset += 4
            },
          }))
        }
        return new Response(body)
      },
    })
    const origin = `http://127.0.0.1:${server.port}`
    const bytes = manifestBytes(options.installer)
    files.set("canary-win-x64-update-v2.json", bytes)
    files.set("canary-win-x64-update-v2.json.sig", Buffer.from(JSON.stringify({
      keyId: "fixture", signature: sign(null, bytes, options.privateKey ?? privateKey).toString("base64"),
    })))
    files.set(installerName, payload)
    return { origin, server }
  }

  function load(origin) {
    const dependencies = {
      "node:assert/strict": assert,
      "node:crypto": { createHash },
      "node:events": { once },
      "node:fs": { createWriteStream },
      "node:fs/promises": { mkdir, rm, stat },
      "node:stream": { Readable },
      "node:stream/promises": { pipeline },
      "node:os": os,
      "node:path": path,
      "./update-public-keys": { updatePublicKeys: { fixture: publicKey.export({ type: "spki", format: "pem" }) } },
      "./verified-update-feed": {
        manifestUrls: channel => {
          const name = `${channel}-win-x64-update-v2.json`
          return { base: origin, manifestUrl: `${origin}/${name}`, signatureUrl: `${origin}/${name}.sig` }
        },
        updateFeedGet: async (url, signal, allowMissing) => {
          const response = await fetch(url, { signal })
          if (response.status === 404 && allowMissing) { await response.body?.cancel(); return null }
          return response
        },
        updateFeedReadBounded: async (response, maximum) => {
          const bytes = Buffer.from(await response.arrayBuffer())
          assert.ok(bytes.length <= maximum, "bounded read exceeded")
          return bytes
        },
      },
      "./verified-update-manifest": { verifySignedWindowsUpdateManifest },
    }
    const module = { exports: {} }
    vm.runInNewContext(source, { module, require: name => dependencies[name], Buffer, AbortSignal, Error, URL })
    return module.exports.downloadChannelInstaller
  }

  describe("channel-switch", () => {
    test("проценты идут по подписанному размеру без Content-Length, 100% только после проверки", async () => {
      const { origin, server } = await serve(installerBytes, { stream: true })
      const progress = []
      try {
        const installer = await load(origin)("canary", value => progress.push(value))
        assert.equal(progress[0]?.percent, 0)
        assert.ok(progress.some(value => value.percent > 0 && value.percent < 100))
        assert.equal(progress.at(-1)?.percent, 100)
        assert.equal(progress.at(-1)?.transferred, installerBytes.length)
        for (const [index, value] of progress.entries()) {
          assert.equal(value.total, installerBytes.length)
          assert.ok(value.percent >= 0 && value.percent <= 100)
          if (index) assert.ok(value.percent >= progress[index - 1].percent)
        }
        assert.deepEqual(await readFile(installer.path), installerBytes)
      } finally {
        server.stop(true)
        await rm(path.join(os.tmpdir(), "xneon-channel-installer"), { recursive: true, force: true })
      }
    })

    test("скачивает установщик целевого канала и сверяет его с подписанным манифестом", async () => {
      const { origin, server } = await serve(installerBytes)
      try {
        const installer = await load(origin)("canary")
        assert.equal(installer.version, "1.0.9-pre1")
        assert.equal(installer.file, installerName)
        assert.deepEqual(await readFile(installer.path), installerBytes)
        assert.equal(path.basename(installer.path), installerName)
      } finally {
        server.stop(true)
        await rm(path.join(os.tmpdir(), "xneon-channel-installer"), { recursive: true, force: true })
      }
    })

    test("подменённый установщик и неверный размер отвергаются до запуска без 100% прогресса", async () => {
      for (const [payload, installer, error] of [
        [Buffer.alloc(installerBytes.length, 0x41), { size: installerBytes.length }, /hash/],
        [installerBytes, { size: installerBytes.length + 10 }, /size/],
      ] as const) {
        const { origin, server } = await serve(payload, { installer })
        const progress = []
        try {
          await assert.rejects(load(origin)("canary", value => progress.push(value)), error)
          assert.ok(!progress.some(value => value.percent === 100))
        } finally {
          server.stop(true)
          await rm(path.join(os.tmpdir(), "xneon-channel-installer"), { recursive: true, force: true })
        }
      }
    })
  })
}