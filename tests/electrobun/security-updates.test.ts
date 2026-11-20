// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
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
import { installedPreference, isAllowedUpdateRedirect, isNewerRelease, manifestUrls, releaseChannelOf } from "../../electrobun/main/verified-update-feed.ts"
import { verifySignedWindowsUpdateManifest, verifyWindowsUpdateManifest } from "../../electrobun/main/verified-update-manifest.ts"
import { appIdentifier } from "../../electrobun/main/app-identity.ts"
import nodeTest from "node:test"
import vm from "node:vm"
import { OperationGate, withinDeadline } from "../../electrobun/platform/operation-gate.ts"
import { ShutdownCoordinator } from "../../electrobun/platform/shutdown.ts"

{
  describe("verified-update-feed", () => {
    test("канал по версии и его отображение в UI", () => {
      assert.equal(releaseChannelOf("1.0.8"), "stable")
      assert.equal(releaseChannelOf("1.0.8-pre2"), "canary")
      assert.equal(releaseChannelOf("1.0.8-beta1"), "canary")
      assert.equal(installedPreference("stable"), "stable")
      assert.equal(installedPreference("canary"), "beta")
    })

    test("манифест канала читается из плоского URL-каталога GitHub без API и фиксированного порта", () => {
      const stable = manifestUrls("stable")
      assert.equal(stable.base, "https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/latest/download")
      assert.equal(stable.manifestUrl, stable.base + "/stable-win-x64-update-v2.json")
      assert.equal(stable.signatureUrl, stable.base + "/stable-win-x64-update-v2.json.sig")
      const canary = manifestUrls("canary")
      assert.equal(canary.base, "https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/download/canary")
      assert.equal(canary.manifestUrl, canary.base + "/canary-win-x64-update-v2.json")
      assert.equal(canary.signatureUrl, canary.base + "/canary-win-x64-update-v2.json.sig")
    })

    test("равная или более старая версия — не обновление, а не ошибка", () => {
      assert.equal(isNewerRelease("1.0.11", "1.0.11"), false)
      assert.equal(isNewerRelease("1.0.11-pre1", "1.0.11"), false)
      assert.equal(isNewerRelease("1.0.10", "1.0.11"), false)
      assert.equal(isNewerRelease("1.0.12", "1.0.11"), true)
      assert.equal(isNewerRelease("1.0.11-pre2", "1.0.11-pre1"), true)
      assert.throws(() => isNewerRelease("1.0", "1.0.11"), /Invalid update version/)
    })

    test("редирект latest/download через канонический тег разрешён, посторонние хосты — нет", () => {
      assert.equal(isAllowedUpdateRedirect(new URL("https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/download/v1.0.10/stable-win-x64-update-v2.json")), true)
      assert.equal(isAllowedUpdateRedirect(new URL("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r")), true)
      assert.equal(isAllowedUpdateRedirect(new URL("https://objects.githubusercontent.com/x")), true)
      assert.equal(isAllowedUpdateRedirect(new URL("https://github.com/other/repo/releases/download/v1/x.json")), false)
      assert.equal(isAllowedUpdateRedirect(new URL("https://evil.example/x.json")), false)
      assert.equal(isAllowedUpdateRedirect(new URL("http://github.com/MAINER4IK/Xneon-Launcher-bun/releases/download/v1/x.json")), false)
      assert.equal(isAllowedUpdateRedirect(new URL("https://github.com:8443/MAINER4IK/Xneon-Launcher-bun/releases/download/v1/x.json")), false)
    })
  })
}

{
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const manifest = {
    schemaVersion: 1, identifier: appIdentifier, channel: "stable",
    version: "1.0.8", hash: "abc123", platform: "win", arch: "x64",
    artifact: { file: "stable-win-x64-XneonLauncher.tar.zst", tarSha256: "a".repeat(64), tarSize: 1000, downloadSha256: "b".repeat(64), downloadSize: 500 },
  }

  function verifyManifest(patch = {}, installed = "1.0.8-pre2", preference = "stable") {
    const bytes = Buffer.from(JSON.stringify({ ...manifest, ...patch }))
    return verifyWindowsUpdateManifest(bytes, sign(null, bytes, privateKey), publicKey, installed, "stable", preference)
  }
  describe("verified-update-manifest", () => {
    test("stable and beta apply version policy without changing the installed channel", () => {
      assert.equal(verifyManifest().version, "1.0.8")
      assert.equal(verifyManifest({ version: "1.0.8-pre3" }, "1.0.8-pre2", "canary").version, "1.0.8-pre3")
      assert.throws(() => verifyManifest({ version: "1.0.8-pre3" }), /stable version/)
      assert.throws(() => verifyManifest({ version: "1.0.8-pre1" }), /newer/)
      assert.throws(() => verifyManifest({}, "1.0.8"), /newer/)
      assert.throws(() => verifyManifest({ channel: "canary" }), /installed package/)
    })

    test("legacy identifier is rejected", () => {
      assert.throws(() => verifyManifest({ identifier: "com.xneonlauncher.app" }), /installed package/)
    })

    test("signature and archive integrity fields are required", () => {
      const original = Buffer.from(JSON.stringify(manifest))
      const changed = Buffer.from(JSON.stringify({ ...manifest, version: "1.0.9" }))
      assert.throws(() => verifyWindowsUpdateManifest(changed, sign(null, original, privateKey), publicKey, "1.0.8", "stable", "stable"), /signature/)
      assert.throws(() => verifyManifest({ artifact: { file: manifest.artifact.file } }), /artifact metadata/)
    })

    test("only a trusted key ID with its own valid signature is accepted", () => {
      const bytes = Buffer.from(JSON.stringify(manifest))
      const other = generateKeyPairSync("ed25519")
      const trusted = { current: publicKey.export({ type: "spki", format: "pem" }) }
      const envelope = (keyId, key) => Buffer.from(JSON.stringify({ keyId, signature: sign(null, bytes, key).toString("base64") }))
      const check = value => verifySignedWindowsUpdateManifest(bytes, value, trusted, "1.0.8-pre2", "stable", "stable")
      assert.equal(check(envelope("current", privateKey)).version, "1.0.8")
      assert.throws(() => check(envelope("unknown", privateKey)), /Unknown update signing key/)
      assert.throws(() => check(envelope("current", other.privateKey)), /manifest signature/)
    })
  })
}

{
  const test = nodeTest
  const source = await readFile(new URL("../../dist-electrobun-tests/main/updater.js", import.meta.url), "utf8")

  function fixture(overrides = {}, cleanup = {}, installed = "1.0.8-pre2") {
    const handlers = new Map()
    const events = []
    const downloads = []
    const spawned = []
    const local = {
      channel: /-(?:pre|beta)\d+$/.test(installed) ? "canary" : "stable",
      version: installed, hash: "old123",
      baseUrl: /-(?:pre|beta)\d+$/.test(installed)
        ? "https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/download/canary"
        : "https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/latest/download",
    }
    const manifest = { version: "1.0.9", channel: local.channel, hash: "next123", artifact: { file: `${local.channel}-win-x64-XneonLauncher.tar.zst` } }
    const info = { updateAvailable: true, updateReady: true, version: manifest.version, hash: manifest.hash, error: "" }
    let selected = local.channel
    let pending = null
    let emit
    const order = []
    const gate = new OperationGate()
    const shutdown = new ShutdownCoordinator({ log() {} })
    if (cleanup.files) shutdown.register("files", cleanup.files)
    let beforeQuit
    const Updater = {
      onStatusChange: callback => { emit = callback },
      getLocalInfo: async () => local,
      appDataFolder: async () => "fixture-root",
      downloadUpdate: async () => {},
      checkForUpdate: async () => info,
      updateInfo: () => info,
      applyUpdate: async () => { order.push("apply") },
      ...overrides,
    }
    const dependencies = {
      "electrobun/main": { Updater, default: { events: { on(name, callback) { if (name === "before-quit") beforeQuit = callback } } }, __esModule: true },
      "../../package.json": { version: installed },
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
        return { on() {}, once(name, callback) { if (name === "spawn") queueMicrotask(callback); return this }, unref() {} }
      } },
      "./channel-switch": { downloadChannelInstaller: cleanup.installer ?? (async (channel, onProgress) => {
        downloads.push(channel)
        onProgress?.({ percent: 25, transferred: 25, total: 100 })
        const version = channel === "canary" ? "1.0.9-pre1" : "1.0.9"
        return { channel, version, file: `xneon-launcher-${version}-win-x64.exe`, path: `fixture-installer-${channel}.exe` }
      }) },
      "./update-public-keys": { expectedUpdateBaseUrl: channel => channel === local.channel ? local.baseUrl : "http://wrong" },
      "./update-state": { launcherUpdateState: {
        getChannel: async () => selected,
        selectChannel: async channel => { selected = channel; pending = null },
        stage: async (kind, _local, update, file) => { pending = { kind, update, path: file, deferred: false } },
        peek: async () => pending,
        defer: async () => { if (!pending) throw new Error("No downloaded update"); pending.deferred = true },
        clearPending: async () => { pending = null },
      } },
      "./verified-update-feed": {
        resolveVerifiedUpdate: async (_version, channel) => ({
          manifest: channel === local.channel ? manifest : { ...manifest, channel, version: channel === "canary" ? "1.0.9-pre1" : "1.0.9" },
          archiveUrl: local.baseUrl + "/" + manifest.artifact.file,
        }),
        installedPreference: channel => channel === "canary" ? "beta" : "stable",
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
      cancel: handlers.get("update:cancel-install"), events, downloads, spawned, info, emit, gate, order, shutdown, beforeQuit }
  }

  describe("updater", () => {
    test("portable: все update actions отклоняются без SDK, сети и installer handoff", async () => {
      const forbidden = () => { throw new Error("Portable must not invoke SDK") }
      const app = fixture({ getLocalInfo: forbidden, appDataFolder: forbidden, checkForUpdate: forbidden,
        downloadUpdate: forbidden, applyUpdate: forbidden, onStatusChange: forbidden }, { portable: true })
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
    test("состояние без обновления и NSIS другого канала не требуют SDK update directory", async () => {
      const app = fixture({ appDataFolder: async () => { throw new Error("outside its managed update directory") } }, {}, "1.0.8")
      assert.equal((await app.state()).status, "idle")
      await app.changeChannel("beta")
      await app.check()
      assert.equal((await app.download()).success, true)
      assert.equal((await app.defer()).success, true)
      await app.install()
      assert.equal(app.spawned.length, 1)
    })

    test("выбор другой ветки не скачивает обновление, не закрывает БД и не запускает установщик", async () => {
      const app = fixture({}, {}, "1.0.8")
      const result = await app.changeChannel("beta")
      assert.equal(result.state, "selected")
      assert.equal(await app.getChannel(), "beta")
      assert.equal(app.downloads.length, 0)
      assert.equal(app.spawned.length, 0)
      assert.equal(app.order.length, 0)
      assert.equal(app.gate.blocked, false)
    })

    test("скачивание другой ветки само по себе не перезапускает лаунчер", async () => {
      const app = fixture({}, {}, "1.0.8")
      await app.changeChannel("beta")
      await app.check()
      assert.equal((await app.download()).success, true)
      assert.equal(app.spawned.length, 0)
      assert.equal(app.order.length, 0)
      assert.equal(app.events.at(-1).status, "downloaded")
    })

    test("другая ветка ставится подписанным установщиком только по отдельному действию", async () => {
      const app = fixture()
      assert.equal(await app.getChannel(), "beta")
      assert.deepEqual({ ...(await app.changeChannel("beta")) }, { state: "current" })
      assert.deepEqual({ ...(await app.changeChannel("stable")) }, { state: "selected" })
      await app.check()
      await app.download()
      await app.install()
      assert.deepEqual(app.downloads, ["stable"])
      assert.equal(app.spawned.length, 1)
      assert.equal(app.spawned[0].file, "fixture-installer-stable.exe")
      assert.deepEqual([...app.spawned[0].args], ["/S", "--force-run"])
      assert.equal(app.spawned[0].options.detached, true)
      assert.deepEqual(app.order, ["mcp", "relay", "db-close"], "Перед установщиком выполняется cleanup и закрывается БД")
    })

    test("stable-сборка на 'Beta' качает canary-установщик, а не открывает сайт", async () => {
      const app = fixture({}, {}, "1.0.8")
      assert.equal(await app.getChannel(), "stable")
      assert.deepEqual({ ...(await app.changeChannel("beta")) }, { state: "selected" })
      await app.check()
      await app.download()
      await app.install()
      assert.deepEqual(app.downloads, ["canary"])
      assert.equal(app.spawned[0].file, "fixture-installer-canary.exe")
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

    test("Позже сохраняет отложенную установку без shutdown и возвращает состояние при повторном открытии", async () => {
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

    test("SDK update ждёт общий cleanup файлов до закрытия БД", async () => {
      const files = Promise.withResolvers(), started = Promise.withResolvers()
      const app = fixture({}, { files: async () => { started.resolve(); await files.promise; app.order.push("files") } })
      await app.check()
      await app.download()
      const installing = app.install()
      await started.promise
      assert.deepEqual(app.order, ["mcp", "relay"])
      files.resolve()
      await installing
      assert.deepEqual(app.order, ["mcp", "relay", "files", "db-close", "apply", "db-reopen"])
      assert.equal(app.shutdown.started, false, "Отказ SDK сбрасывает подготовленный барьер")
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

    test("ошибка чтения локальных метаданных возвращается по RPC", async () => {
      const app = fixture({ getLocalInfo: async () => { throw new Error("Cannot read version") } })
      assert.equal((await app.check()).error, "Cannot read version")
      assert.equal(app.events.at(-1).status, "error")
    })

    test("проверка требует канал и address identity пакета, иначе не ходит в feed", async () => {
      const app = fixture({ getLocalInfo: async () => ({ channel: "dev", version: "1.0.8-pre2", baseUrl: "http://localhost" }),
        checkForUpdate: async () => { throw new Error("unexpected feed access") } })
      assert.equal((await app.check()).error, "unsupported-package")
      const wrong = fixture({ getLocalInfo: async () => ({ channel: "canary", version: "1.0.8-pre2", baseUrl: "https://evil.example/" }) })
      assert.equal((await wrong.check()).error, "unsupported-package")
    })

    test("ошибка нативной установки отображается, даже если SDK разрешил Promise", async () => {
      const app = fixture({ applyUpdate: async () => {
        app.emit({ status: "launching-new-version" })
        app.info.error = "Native helper failed"
        app.emit({ status: "error" })
      } })
      await app.check()
      assert.equal((await app.download()).success, true)
      await app.install()
      assert.equal(app.events.at(-1).status, "error")
      assert.equal(app.events.at(-1).error, "Native helper failed")
      assert.deepEqual(app.order, ["mcp", "relay", "db-close", "db-reopen"])
      assert.equal(app.gate.blocked, false)
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
      assert.equal(app.events.at(-1).error, "restart-cancelled")
      assert.equal(app.gate.blocked, false)
    })

    test("таймаут очистки MCP сохраняет открытой БД и не вызывает updater", async () => {
      const app = fixture({}, { mcp: () => new Promise(() => {}), timeout: 20 })
      await app.check()
      assert.equal((await app.download()).success, true)
      await app.install()
      assert.deepEqual(app.order, ["relay"])
      assert.match(app.events.at(-1).error, /shutdown timed out/)
    })

    test("отказ SDK без handoff восстанавливает доступ к хранилищу", async () => {
      const app = fixture()
      await app.check()
      assert.equal((await app.download()).success, true)
      await app.install()
      assert.deepEqual(app.order, ["mcp", "relay", "db-close", "apply", "db-reopen"])
      assert.match(app.events.at(-1).error, /restart did not start/)
    })

    test("прогресс транслируется из SDK download-progress", async () => {
      const app = fixture({ downloadUpdate: async () => { app.emit({ status: "download-progress", details: { progress: 25 } }) } })
      await app.check()
      assert.equal((await app.download()).success, true)
      assert.ok(app.events.some(event => "percent" in event && event.percent === 25))
    })

    test("скачивание не растягивается когда SDK уже приготовил обновление", async () => {
      const app = fixture()
      await app.check()
      assert.equal((await app.download()).success, true)
      assert.equal(app.events.at(-1).status, "downloaded")
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

    test("подменённый установщик отвергается по хешу из подписи", async () => {
      const { origin, server } = await serve(Buffer.alloc(installerBytes.length, 0x41), { installer: { size: installerBytes.length } })
      try {
        const progress = []
        await assert.rejects(load(origin)("canary", value => progress.push(value)), /hash/)
        assert.ok(!progress.some(value => value.percent === 100))
      } finally {
        server.stop(true)
        await rm(path.join(os.tmpdir(), "xneon-channel-installer"), { recursive: true, force: true })
      }
    })

    test("несовпадение размера отвергается до запуска установщика", async () => {
      const { origin, server } = await serve(installerBytes, { installer: { size: installerBytes.length + 10 } })
      try {
        await assert.rejects(load(origin)("canary"), /size/)
      } finally {
        server.stop(true)
        await rm(path.join(os.tmpdir(), "xneon-channel-installer"), { recursive: true, force: true })
      }
    })
  })
}
