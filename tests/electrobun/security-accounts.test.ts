// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import { Database } from "bun:sqlite"
import { safeStorage } from "../../electrobun/platform/windows-native.ts"
import * as errors from "../../electrobun/main/ai-errors.ts"
import * as credentials from "../../electrobun/main/ai-credentials.ts"
import * as providers from "../../packages/xnlc-agent/src/providers.ts"
import * as models from "../../packages/xnlc-agent/src/model-config.ts"
import { test as nodeTest } from "node:test"
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

{
  const setup = `
  import { mock } from "bun:test"
  import assert from "node:assert/strict"
  import { Database } from "bun:sqlite"
  const db = new Database(":memory:")
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
  db.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY, type TEXT, username TEXT, isActive INTEGER, uuid TEXT, accessToken TEXT, refreshToken TEXT, clientId TEXT, skinUrl TEXT, sortOrder INTEGER, serverId TEXT, serverUrl TEXT, serverName TEXT, yggClientToken TEXT, expiresAt INTEGER, profiles TEXT)")
  mock.module("./electrobun/db/core.ts", () => ({
    queryAll: (sql, args = []) => db.query(sql).all(...args),
    run: (sql, args = []) => db.query(sql).run(...args),
    prepare: sql => db.query(sql), transactionImmediate: callback => db.transaction(callback).immediate(),
    isDbAvailable: () => true, inMemoryAccounts: new Map(), requireTestDatabaseStorage() { throw new Error("disabled") },
  }))
  const accounts = await import("./electrobun/db/accounts.ts")
  mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: accounts }))
  const service = await import("./electrobun/main/account-service.ts")
  const secrets = await import("./electrobun/db/account-secrets.ts")
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from("sealed:" + value),
    decryptString: value => { const text = value.toString(); if (!text.startsWith("sealed:")) throw new Error("invalid"); return text.slice(7) },
  }
  const original = { id: "one", type: "microsoft", username: "Player", isActive: true, uuid: "uuid", accessToken: "old-access", refreshToken: "old-refresh", yggClientToken: "old-client" }
`
  function scenario(code: string) {
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", setup + code], { stdout: "pipe", stderr: "pipe" })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  }
  describe("account-boundary", () => {
    test("публичный снимок не включает ни существующие, ни новые секретные поля", () => scenario(`
  const result = await service.saveAuthenticatedAccount("microsoft", { ...original, futureSecret: "hidden" })
  assert.equal(result.id, "one")
  for (const key of ["accessToken", "refreshToken", "yggClientToken", "clientId", "profiles", "futureSecret"]) assert.equal(key in result, false)
  const stored = (await accounts.loadAccounts())[0]
  assert.equal(stored.accessToken, "old-access")
`))

    test("первый offline account становится активным независимо от временного UI placeholder", () => scenario(`
  await service.saveAccountDisplay({ id: "first", type: "offline", username: "First", isActive: false })
  await service.saveAccountDisplay({ id: "second", type: "offline", username: "Second", isActive: false })
  const loaded = await accounts.loadAccounts()
  assert.equal(loaded.find(account => account.id === "first").isActive, true)
  assert.equal(loaded.find(account => account.id === "second").isActive, false)
`))

    test("неизвестный тип старого аккаунта не удаляется из БД и не ломает список поддерживаемых", () => scenario(`
  await accounts.saveAccount(original)
  db.query("INSERT INTO accounts(id,type,username,isActive) VALUES (?,?,?,?)").run("future", "future-provider", "Future", 0)
  assert.deepEqual((await service.loadPublicAccounts()).map(account => account.id), ["one"])
  assert.equal(db.query("SELECT username FROM accounts WHERE id='future'").get().username, "Future")
`))

    test("выбор, порядок и старый UI-снимок не перезаписывают свежую сессию", () => scenario(`
  await accounts.saveAccount(original)
  const stale = service.publicAccount(original)
  await accounts.saveAccount({ ...original, accessToken: "new-access", refreshToken: "new-refresh" })
  await service.saveAccountDisplay(stale)
  await accounts.setActiveAccount("one")
  await accounts.reorderAccounts(["one"])
  await service.importLegacyAccounts([original])
  await assert.rejects(service.saveAccountDisplay(original), /Session fields/)
  const stored = (await accounts.loadAccounts())[0]
  assert.equal(stored.accessToken, "new-access")
  assert.equal(stored.refreshToken, "new-refresh")
`))

    test("миграция legacy аккаунтов атомарна, выбирает только один active и не перезаписывает существующий профиль", () => scenario(`
  db.exec("CREATE TRIGGER reject_second BEFORE INSERT ON accounts WHEN NEW.id='two' BEGIN SELECT RAISE(ABORT,'disk full'); END")
  await assert.rejects(service.importLegacyAccounts([original, { ...original, id: "two" }]), /disk full/)
  assert.equal((await accounts.loadAccounts()).length, 0)
  db.exec("DROP TRIGGER reject_second")
  await service.importLegacyAccounts([original, { ...original, id: "two" }])
  assert.equal((await accounts.loadAccounts()).filter(account => account.isActive).length, 1)
  await accounts.saveAccount({ ...original, accessToken: "fresh" })
  await service.importLegacyAccounts([original])
  assert.equal((await accounts.loadAccounts()).find(account => account.id === "one").accessToken, "fresh")
`))

    test("миграция plaintext обратима, повторный запуск не шифрует токен дважды", () => scenario(`
  await accounts.saveAccount(original)
  secrets.configureAccountSecrets(storage)
  assert.equal((await accounts.loadAccounts())[0].accessToken, "old-access")
  const encoded = db.query("SELECT accessToken FROM accounts").get().accessToken
  assert.ok(encoded.startsWith("xnlc-secret:v1:"))
  assert.equal((await accounts.loadAccounts())[0].refreshToken, "old-refresh")
  assert.equal(db.query("SELECT accessToken FROM accounts").get().accessToken, encoded)
  await accounts.saveAccount({ ...original, accessToken: "new" })
  assert.equal((await accounts.loadAccounts())[0].accessToken, "new")
`))

    test("облачная метазапись не меняет существующую сессию, новые метаданные сохраняет main", () => scenario(`
  await accounts.saveAccount(original)
  const restored = await service.restoreAccountMetadata({ ...original, accessToken: "stale", username: "Stale" })
  assert.equal(restored.username, "Player")
  assert.equal("accessToken" in restored, false)
  assert.equal((await accounts.loadAccounts())[0].accessToken, "old-access")
  await service.restoreAccountMetadata({ id: "two", type: "microsoft", username: "New" })
  assert.equal((await accounts.loadAccounts()).length, 2)
`))

    test("одноразовая legacy migration дополняет существующий профиль, не меняя его session/active", () => scenario(`
  await accounts.saveAccount({ ...original, accessToken: "fresh" })
  await service.importLegacyAccounts([original, { ...original, id: "legacy", isActive: true }])
  let loaded = await accounts.loadAccounts()
  assert.equal(loaded.find(account => account.id === "one").accessToken, "fresh")
  assert.equal(loaded.find(account => account.id === "one").isActive, true)
  assert.equal(loaded.find(account => account.id === "legacy").isActive, false)
  await service.importLegacyAccounts([{ ...original, id: "second-migration" }])
  loaded = await accounts.loadAccounts()
  assert.equal(loaded.some(account => account.id === "second-migration"), false)
`))

    test("отказ keyring при миграции не теряет исходный токен, зашифрованный токен не выдаётся как plaintext", () => scenario(`
  await accounts.saveAccount(original)
  secrets.configureAccountSecrets({ ...storage, encryptString() { throw new Error("keyring unavailable") } })
  assert.equal((await accounts.loadAccounts())[0].accessToken, "old-access")
  assert.equal(db.query("SELECT accessToken FROM accounts").get().accessToken, "old-access")
  secrets.configureAccountSecrets(storage)
  await accounts.loadAccounts()
  secrets.configureAccountSecrets({ ...storage, isEncryptionAvailable: () => false })
  await assert.rejects(accounts.loadAccounts(), /secret storage is unavailable/)
  assert.ok(db.query("SELECT accessToken FROM accounts").get().accessToken.startsWith("xnlc-secret:v1:"))
`))

    test("необратимый результат safeStorage не заменяет старое значение в БД", () => scenario(`
  await accounts.saveAccount(original)
  secrets.configureAccountSecrets({ ...storage, decryptString: () => "wrong-value" })
  assert.equal((await accounts.loadAccounts())[0].accessToken, "old-access")
  assert.equal(db.query("SELECT accessToken FROM accounts").get().accessToken, "old-access")
`))
  })
}

{
  describe("accounts-hydration", () => {
    for (const mode of ["corrupt", "mixed", "declined", "failed"]) test(`гидратация аккаунтов сохраняет рабочую БД и неизвестные legacy записи (${mode})`, () => {
      const code = `
    import assert from "node:assert/strict"
    import { fetchAccounts } from "./src/AccountsContext.tsx"
    const mode = ${JSON.stringify(mode)}
    const data = new Map(), migrated = []
    const current = [{ id: "fresh", type: "microsoft", username: "Fresh", isActive: true }]
    globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
    globalThis.window = { electrobunAPI: { loadAccounts: async () => current, importLegacyAccounts: async accounts => {
      migrated.push(accounts)
      if (mode === "failed") throw new Error("disk full")
      if (mode === "declined") return
      for (const account of accounts) if (!current.some(item => item.id === account.id)) current.push({ id: account.id, type: account.type, username: account.username, isActive: false })
    } } }
    const key = "xneon-launcher:accounts"
    data.set(key, mode === "corrupt" ? "not-json" : JSON.stringify([{ id: "old", type: "microsoft", username: "Old", accessToken: "stale-secret" }, { id: "unknown", type: "future-provider", username: "Future", custom: "retained" }]))
    assert.deepEqual(await fetchAccounts(), current)
    if (mode === "corrupt") { assert.equal(migrated.length, 0); assert.equal(data.get(key), "not-json") }
    else if (mode === "mixed") {
      assert.equal(migrated[0][0].id, "old")
      assert.deepEqual(JSON.parse(data.get(key)), [{ id: "unknown", type: "future-provider", username: "Future", custom: "retained" }])
      assert.equal(data.get(key).includes("stale-secret"), false)
    }
    else assert.equal(JSON.parse(data.get(key)).some(account => account.id === "old"), true, "Не принятые main записи не теряются")
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    })
  })
}

{
  describe("auth-public-results", () => {
    for (const provider of ["elyby", "xnskins", "microsoft"]) for (const flow of ["oauth", "device"]) {
      test(`${provider}/${flow}: main сохраняет секреты, UI получает только публичный результат`, () => {
        const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import { EventEmitter } from "node:events"
      const provider = ${JSON.stringify(provider)}, flow = ${JSON.stringify(flow)}
      const handlers = new Map(), saved = []
      const identity = { id: "account", username: "Player", uuid: "123456781234123412341234567890ab" }
      class AuthWindow extends EventEmitter {
        viewSession = new EventEmitter()
        show() {} focus() {} close() {} isDestroyed() { return false }
        loadURL(input) {
          let url = new URL(input)
          if (url.searchParams.has("next")) url = new URL(url.searchParams.get("next"))
          const state = url.searchParams.get("state") || ""
          const redirect = provider === "elyby" ? "http://localhost:51234/elyby/callback" : provider === "xnskins" ? "http://localhost:5123/xneon/callback" : "http://localhost:51235/ms/callback"
          queueMicrotask(() => this.viewSession.emit("did-navigate", {}, redirect + "?code=approved&state=" + state))
        }
      }
      mock.module("./electrobun/platform/desktop.ts", () => ({ DesktopWindow: AuthWindow, rpcRegistry: { handle: (channel, handler) => handlers.set(channel, handler) } }))
      mock.module("./electrobun/main/runtime.ts", () => ({ getMainWindow() {}, ensureRuntimeTempDir: async () => {} }))
      mock.module("./electrobun/main/config.ts", () => ({ getMicrosoftClientId: async () => "client", getMicrosoftDeviceClientId: async () => "client", getElyClientId: async () => "client", getElyDeviceClientId: async () => "client", getElyClientSecret: async () => "fixture-client-secret" }))
      mock.module("./electrobun/main/account-service.ts", () => ({ saveAuthenticatedAccount: async (type, account) => { saved.push({ type, account }); return { ...identity, type, isActive: true } } }))
      mock.module("@xnlc/core/retry", () => ({ fetchWithRetry: (...args) => fetch(...args) }))
      mock.module("@xnlc/core/microsoft", () => ({ getMicrosoftRedirectUri: () => "http://localhost:51235/ms/callback", createMicrosoftAuthUrl: () => "https://login.invalid/?state=fixture", exchangeMicrosoftCode: async () => ({ ...identity, accessToken: "oauth-session-secret", refreshToken: "refresh-secret" }) }))
      globalThis.fetch = async input => {
        const url = String(input)
        if (url.includes("/devicecode")) return Response.json({ device_code: "device", user_code: "CODE", verification_uri: "https://login.invalid", expires_in: 900, interval: 1 })
        if (url.includes("/token")) return Response.json({ access_token: "oauth-session-secret", refresh_token: "refresh-secret" })
        if (url.includes("xboxlive.com")) return Response.json({ Token: "xbox-session-secret", DisplayClaims: { xui: [{ uhs: "uhs" }] } })
        if (url.includes("/launcher/login")) return Response.json({ access_token: "minecraft-session-secret", username: "Player" })
        if (url.includes("/minecraft/profile")) return Response.json({ id: identity.uuid, name: "Player", skins: [] })
        if (url.includes("/account/v1/info")) return Response.json({ ...identity })
        throw new Error("Unexpected request: " + url)
      }
      // Проверяем callback policy окна без открытия GUI и без захвата системных портов.
      Bun.serve = () => ({ stop() {} })
      await import("./electrobun/main/auth.ts")
      let result
      if (flow === "oauth") result = await handlers.get("auth:" + provider + "-login")()
      else {
        await handlers.get("auth:" + provider + "-device-start")()
        result = await handlers.get("auth:" + provider + "-device-poll")(null, "device")
        assert.equal(result.status, "complete")
        result = result.account
      }
      assert.equal(saved.length, 1)
      assert.equal(saved[0].type, provider)
      assert.ok(saved[0].account.accessToken)
      assert.ok(saved[0].account.refreshToken)
      assert.equal(result.username, "Player")
      for (const key of ["accessToken", "refreshToken", "clientToken", "yggClientToken"]) assert.equal(key in result, false)
      assert.equal(JSON.stringify(result).includes("secret"), false)
    `
        const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
        expect(result.exitCode, result.stderr.toString()).toBe(0)
      })
    }

    test("Authlib multi-profile login не отдаёт сессию при выборе и сохраняет её в main после выбора", () => {
      const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    const profiles = [{ id: "123456781234123412341234567890ab", name: "Player" }, { id: "223456781234123412341234567890ab", name: "Other" }]
    const saved = []
    mock.module("./electrobun/db/index.ts", () => ({ dbHelpers: { getAuthServer: () => ({ id: "server", name: "Fixture", url: "https://fixture.invalid/" }), saveAccount: async account => saved.push(account) } }))
    mock.module("./electrobun/main/authlib/server.ts", () => ({ fetchMetadata: async () => ({ meta: { serverName: "Fixture" } }) }))
    mock.module("./electrobun/main/authlib/yggdrasil.ts", () => ({ YggdrasilClient: class {
      async authenticate() { return { accessToken: "access-secret", clientToken: "client-secret", availableProfiles: profiles } }
      async fetchProfile(id) { return profiles.find(profile => profile.id === id) }
    } }))
    const { loginToServer } = await import("./electrobun/main/authlib/service.ts")
    const selection = await loginToServer("server", "login", "password")
    assert.equal(selection.requiresProfileSelection, true)
    assert.equal(saved.length, 0)
    assert.equal(JSON.stringify(selection).includes("secret"), false)
    const result = await loginToServer("server", "login", "password", profiles[0].id)
    assert.equal(result.requiresProfileSelection, false)
    assert.equal(saved.length, 1)
    assert.equal(saved[0].accessToken, "access-secret")
    assert.equal(saved[0].yggClientToken, "client-secret")
    assert.equal(JSON.stringify(result).includes("secret"), false)
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    })
  })
}

{
  const compiled = path => readFile(new URL("../../dist-electrobun-tests/" + path, import.meta.url), "utf8")
  const [cloudDbCode, tokenCode, aiCode] = await Promise.all([compiled("db/cloud.js"), compiled("main/cloud/token-store.js"), compiled("main/ai-agent.js")])
  function load(code, dependencies, globals = {}) {
    const module = { exports: {} }
    vm.runInNewContext(code, {
      module, Buffer, URL, AbortSignal, Error, JSON,
      require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name] },
      ...globals,
    })
    return module.exports
  }
  function cloudFixture(storage = safeStorage) {
    const db = new Database(":memory:")
    db.run("CREATE TABLE cloud_configs (provider TEXT PRIMARY KEY, data TEXT NOT NULL)")
    const cloud = load(cloudDbCode, { "./core": {
      queryAll: (sql, params) => db.query(sql).all(...params),
      run: (sql, params) => db.query(sql).run(...params),
      isDbAvailable: () => true,
    } })
    const tokens = load(tokenCode, { "../../db": { dbHelpers: cloud }, "../../db/cloud": cloud, "../../platform/windows-native": { safeStorage: storage } })
    return { db, cloud, tokens }
  }
  describe("credential-security", () => {
    test.skipIf(process.platform !== "win32")("cloud credentials migrate, refresh and sign out using DPAPI", async () => {
      const { db, cloud, tokens } = cloudFixture()
      try {
        const legacy = { access_token: "synthetic-access-A", refresh_token: "synthetic-refresh-A" }
        await cloud.setCloudConfig("google-drive", JSON.stringify(legacy))
        const previous = await tokens.readCloudToken("google-drive")
        assert.deepEqual(previous, legacy)
        const protectedValue = await cloud.getCloudConfig("google-drive")
        assert.match(protectedValue, /^dpapi:v1:/)
        assert.ok(!protectedValue.includes(legacy.refresh_token))

        const refreshed = { ...legacy, access_token: "synthetic-refreshed-A" }
        await tokens.replaceCloudToken("google-drive", previous, refreshed)
        assert.deepEqual(await tokens.readCloudToken("google-drive"), refreshed)

        const replacement = { access_token: "synthetic-access-B" }
        await tokens.writeCloudToken("google-drive", replacement)
        await assert.rejects(tokens.replaceCloudToken("google-drive", refreshed, legacy), /changed during refresh/)
        assert.deepEqual(await tokens.readCloudToken("google-drive"), replacement)

        const current = await tokens.readCloudToken("google-drive")
        await tokens.clearCloudToken("google-drive")
        await assert.rejects(tokens.replaceCloudToken("google-drive", current, refreshed), /changed during refresh/)
        assert.equal(await cloud.getCloudConfig("google-drive"), null)
        assert.equal(await tokens.readCloudToken("google-drive"), null)
      } finally { db.close() }
    }, 20_000)

    test("interrupted credential migration preserves the original row for retry", async () => {
      const { db, cloud, tokens } = cloudFixture({
        isEncryptionAvailable: () => true,
        encryptString: () => { throw new Error("synthetic storage failure") },
      })
      try {
        const original = JSON.stringify({ password: "synthetic-webdav-password" })
        await cloud.setCloudConfig("webdav", original)
        assert.equal(await tokens.readCloudToken("webdav"), null)
        await assert.rejects(tokens.writeCloudToken("webdav", { password: "synthetic-replacement" }), /storage failure/)
        assert.equal(await cloud.getCloudConfig("webdav"), original)
      } finally { db.close() }
    })

    function aiFixture(fetch) {
      const settings = new Map([["aiApiKey", "synthetic-initial-key"]])
      const handlers = new Map()
      const events = []
      const module = load(aiCode, {
        "../platform/desktop": { safeStorage, rpcRegistry: { handle: (name, handler) => handlers.set(name, handler) } },
        "../db": { dbHelpers: { getSetting: async key => settings.get(key) } },
        "../db/settings": { setSettings: values => Object.entries(values).forEach(([key, value]) => settings.set(key, value)) },
        "./ai-credentials": credentials,
        "./ai-errors": errors,
        "./runtime": { sendToRenderer: (name, value) => events.push([name, value]) },
        "./agent-workspace": { registerAgentWorkspace() {} },
        "./agent-mcp": { registerAgentMcpHandlers() {} },
        "./ai-providers": providers,
        "./ai-model-config": models,
      }, { fetch })
      module.registerAiAgent()
      return { rpc: (name, ...args) => handlers.get(name)(null, ...args), settings, events }
    }

    test("AI settings RPC keeps the saved key in main and binds discovery to its provider", async () => {
      const requests = []
      const { rpc, settings } = aiFixture((url, init) => {
        requests.push([String(url), init.headers, init.redirect])
        return Response.json({ data: [{ id: "gpt-4o-mini" }] })
      })
      const status = await rpc("ai:get-config")
      assert.equal(status.hasApiKey, true)
      assert.equal(Object.hasOwn(status, "apiKey"), false)
      assert.equal(JSON.stringify(status).includes("synthetic-initial-key"), false)

      await rpc("ai:save-config", status)
      assert.equal((await rpc("ai:list-models")).success, true)
      assert.equal(requests[0][1].Authorization, "Bearer synthetic-initial-key")
      assert.equal(requests[0][2], "manual")
      assert.equal((await rpc("ai:list-models", { protocol: "gemini", endpoint: status.endpoint })).success, false)
      assert.equal((await rpc("ai:list-models", { endpoint: "https://example.invalid/v1" })).success, false)
      assert.equal(requests.length, 1)
      assert.equal((await rpc("ai:list-models", { protocol: "gemini", endpoint: "https://example.invalid/v1", apiKey: "synthetic-new-key" })).success, true)
      assert.equal(requests[1][1]["x-goog-api-key"], "synthetic-new-key")

      await rpc("ai:save-config", { ...status, endpoint: "https://example.invalid/v1" })
      assert.equal(settings.get("aiApiKey"), "")
      assert.equal((await rpc("ai:get-config")).hasApiKey, false)
      settings.set("aiApiKey", "synthetic-next-key")
      await rpc("ai:save-config", { ...status, endpoint: "https://example.invalid/v1", apiKey: "" })
      assert.equal(settings.get("aiApiKey"), "")
    })

    test("AI discovery and streaming crash errors exclude provider response details", async () => {
      const echoed = "Authorization: Bearer synthetic-initial-key; Cookie: synthetic-cookie"
      const { rpc, events } = aiFixture(() => new Response(echoed, { status: 401 }))
      const models = await rpc("ai:list-models")
      const analysis = await rpc("ai:analyze-crash-stream", "fixture", "synthetic log")
      assert.equal(models.success, false)
      assert.equal(analysis.success, false)
      assert.match(models.error, /authentication/)
      assert.match(analysis.error, /authentication/)
      assert.ok(!JSON.stringify({ models, analysis, events }).includes("synthetic-"))
    })

    test("AI provider failures use safe categories", async () => {
      for (const [status, code] of [[302, "redirect"], [400, "request"], [401, "authentication"], [402, "quota"], [404, "model"], [408, "timeout"], [413, "context"], [429, "rate-limit"], [503, "outage"]]) {
        await assert.rejects(errors.assertAiResponse(new Response("synthetic-key-and-cookie", { status })), error => error.code === code && !error.message.includes("synthetic"))
      }
      assert.equal(errors.aiFailure(new SyntaxError("synthetic-response")).code, "response")
      assert.equal(errors.aiFailure(new DOMException("synthetic-timeout", "TimeoutError")).code, "timeout")
      assert.equal(errors.aiFailure(new TypeError("synthetic-endpoint")).code, "connection")
    })

    test("WebDAV recreates a cached client when only the password changes", async () => {
      let config = { url: "https://webdav.example.invalid", username: "fixture", password: "synthetic-first" }
      const connections = []
      const { WebDavProvider } = load(await compiled("main/cloud/providers/webdav.js"), {
        "../../errors": {},
        "fs/promises": {},
        "path": {},
        "webdav": { createClient: (url, options) => {
          connections.push({ url, ...options })
          return { getDirectoryContents: async () => [] }
        } },
        "../token-store": { readCloudToken: async () => ({ ...config }) },
      })
      const provider = new WebDavProvider()
      assert.equal((await provider.listFiles()).success, true)
      assert.equal((await provider.listFiles()).success, true)
      assert.equal(connections.length, 1)
      config = { ...config, password: "synthetic-second" }
      assert.equal((await provider.listFiles()).success, true)
      assert.equal(connections.length, 2)
      assert.equal(connections[1].password, "synthetic-second")
    })
  })
}

{
  const test = nodeTest
  const require = createRequire(import.meta.url)
  const source = fs.readFileSync(new URL("../../packages/xnlc-core/src/launch-utils.ts", import.meta.url), "utf8")
  const code = transformSync(source + "\nexport { ensureDownloadedFile };", { loader: "ts", format: "cjs" }).code
  const releaseUrl = "https://github.com/MAINER4IK/RetroAuth-injector/releases/download/1.0.4/retroauth-injector-1.0.4.jar"
  const releaseHash = "8653b24cf088b11630184e574d2258b6ca1d7c4ab89914a636d6785403fad4b0"
  const jar = Buffer.alloc(2048, 1)
  jar.write("PK\x03\x04", 0, "binary")
  const oldJar = Buffer.from(jar)
  oldJar[100] = 2
  const hash = createHash("sha256").update(jar).digest("hex")

  function fixture(t, respond = () => new Response(jar)) {
    const directory = path.resolve(".tmp")
    fs.mkdirSync(directory, { recursive: true })
    const root = fs.mkdtempSync(path.join(directory, "retroauth-download-test-"))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const calls = []
    const module = { exports: {} }
    vm.runInNewContext(code, {
      module, exports: module.exports, Buffer, URL, AbortController, setTimeout, clearTimeout, process,
      require(name) {
        if (name === "./auth/auth-manager.js") return { AuthManager: {} }
        if (name === "./config.js") return { getAuthlibInjectorAllowedHosts: () => [] }
        if (name === "./constants/urls.js") return { URLS: { official: {} } }
        return require(name)
      },
      fetch: async (url, options) => {
        calls.push({ url, options })
        if (options.signal?.aborted) throw new Error("Aborted")
        return respond(url, options)
      },
    })
    const file = path.join(root, "retroauth-injector.jar")
    const download = signal => module.exports.ensureDownloadedFile(file, releaseUrl, "retroauth-injector", signal, hash)
    return { root, file, calls, download, ensureRetroAuthInjector: module.exports.ensureRetroAuthInjector }
  }
  describe("retroauth-injector", () => {
    test("RetroAuth: старый кэш не мешает переходу на релиз 1.0.4", async t => {
      const f = fixture(t)
      fs.writeFileSync(f.file, oldJar)
      // Контрольная сумма синтетического JAR отличается: ожидаем отказ, но не запуск старого агента.
      await assert.rejects(f.ensureRetroAuthInjector(f.root), /SHA-256/)
      assert.equal(f.calls[0].url, releaseUrl)
      assert.deepEqual(fs.readFileSync(f.file), oldJar)
      assert.ok(source.includes(releaseHash), "Должен быть закреплён SHA-256 опубликованного JAR")
    })

    test("RetroAuth: скачанный JAR проверяется и повторно используется без сети", async t => {
      const f = fixture(t)
      assert.equal(await f.download(), f.file)
      assert.deepEqual(fs.readFileSync(f.file), jar)
      assert.equal(await f.download(), f.file)
      assert.equal(f.calls.length, 1)
      assert.equal(fs.existsSync(f.file + ".part"), false)
    })

    test("RetroAuth: старый JAR атомарно заменяется проверенным", async t => {
      const f = fixture(t)
      fs.writeFileSync(f.file, oldJar)
      assert.equal(await f.download(), f.file)
      assert.equal(f.calls.length, 1)
      assert.deepEqual(fs.readFileSync(f.file), jar)
    })

    test("RetroAuth: несовпадение SHA-256 не заменяет существующий файл", async t => {
      const f = fixture(t, () => new Response(oldJar))
      fs.writeFileSync(f.file, oldJar)
      await assert.rejects(f.download(), /SHA-256/)
      assert.deepEqual(fs.readFileSync(f.file), oldJar)
      assert.equal(fs.existsSync(f.file + ".part"), false)
    })

    test("RetroAuth: ошибка HTTP сохраняет предыдущий файл и не выдаёт его как актуальный", async t => {
      const f = fixture(t, () => new Response("Unavailable", { status: 503 }))
      fs.writeFileSync(f.file, oldJar)
      await assert.rejects(f.download(), /503/)
      assert.deepEqual(fs.readFileSync(f.file), oldJar)
    })

    test("RetroAuth: вместо JAR нельзя сохранить HTML", async t => {
      const f = fixture(t, () => new Response("<html>" + "error".repeat(500)))
      await assert.rejects(f.download(), /invalid archive/)
      assert.equal(fs.existsSync(f.file), false)
      assert.equal(fs.existsSync(f.file + ".part"), false)
    })

    test("RetroAuth: отменённое обновление не портит старый JAR", async t => {
      const f = fixture(t)
      fs.writeFileSync(f.file, oldJar)
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(f.download(controller.signal), /Aborted/)
      assert.deepEqual(fs.readFileSync(f.file), oldJar)
    })
  })
}

{
  const test = nodeTest
  const require = createRequire(import.meta.url)
  const original = fs.readFileSync(new URL("../../components/launcher/skins-page.tsx", import.meta.url), "utf8")

  function render(accounts, tab) {
    // Проверяем оба состояния переключателя с настоящим React, без подмены hooks.
    const source = original.replace('useState<SkinsTab>("favorites")', `useState<SkinsTab>("${tab}")`)
    const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
    const module = { exports: {} }
    const mounted = []
    vm.runInNewContext(code, { module, exports: module.exports, require(name) {
      if (name === "@/src/AccountsContext") return { useAccounts: () => ({ accounts }) }
      if (name === "react-i18next") return { useTranslation: () => ({ t: key => key }) }
      if (name === "./content-motion") return { CONTENT_ENTER_DELAYED: "" }
      if (name === "./skins") return {
        FavoritesTab: () => { mounted.push("favorites"); return React.createElement("div", { "data-test": "favorites" }) },
        EmptySkinsState: () => React.createElement("div", { "data-test": "unavailable" }),
      }
      if (name === "./laby") return { LabyLibraryTab: () => { mounted.push("library"); return React.createElement("div", { "data-test": "library" }) } }
      return require(name)
    } })
    return { html: renderToStaticMarkup(React.createElement(module.exports.SkinsPage)), mounted }
  }
  describe("skins-account-access", () => {
    for (const tab of ["favorites", "library"]) {
      for (const types of [[], ["offline"], ["elyby"], ["offline", "elyby"]]) {
        test(`Скины: ${tab} недоступна без подходящего аккаунта (${types.join(",") || "пусто"})`, () => {
          const f = render(types.map(type => ({ type })), tab)
          assert.ok(f.html.includes('data-test="unavailable"'))
          assert.deepEqual(f.mounted, [], "Закрытая вкладка не должна монтироваться и запускать загрузку каталога")
        })
      }
      for (const type of ["microsoft", "xnskins", "authlib-injector"]) {
        test(`Скины: ${tab} доступна с ${type}, даже если активен Ely.by`, () => {
          const f = render([{ type: "elyby", isActive: true }, { type, isActive: false }], tab)
          assert.ok(!f.html.includes('data-test="unavailable"'))
          assert.deepEqual(f.mounted, [tab])
        })
      }
    }
  })
}
