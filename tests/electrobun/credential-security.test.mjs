import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import { Database } from "bun:sqlite"
import { test } from "bun:test"
import { safeStorage } from "../../electrobun/platform/windows-native.ts"
import * as errors from "../../electrobun/main/ai-errors.ts"
import * as credentials from "../../electrobun/main/ai-credentials.ts"
import * as providers from "../../packages/xnlc-agent/src/providers.ts"
import * as models from "../../packages/xnlc-agent/src/model-config.ts"

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
