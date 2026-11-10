import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"
import { createRequire } from "node:module"
import { AGENT_TOOLS } from "../../packages/xnlc-agent/lib/tools.js"

const moduleUrl = new URL("../../dist-electrobun-tests/main/agent-mcp.js", import.meta.url)
const code = await fs.readFile(moduleUrl, "utf8")
const require = createRequire(moduleUrl)

function mcpApi() {
  const handlers = new Map()
  const settings = new Map()
  const calls = []
  class Transport { constructor(options) { this.options = options } }
  class Client {
    async connect(transport) { calls.push({ action: "connect", options: transport.options }) }
    async listTools() { return { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }] } }
    async callTool(request) { calls.push({ action: "call", request }); return { content: [{ type: "text", text: JSON.stringify(request.arguments) }] } }
    async close() { calls.push({ action: "close" }) }
  }
  const module = { exports: {} }
  const mocks = {
    "../platform/desktop": {
      app: { getVersion: () => "1.0.0", on() {} },
      rpcRegistry: { handle: (name, handler) => handlers.set(name, handler) },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    },
    "@modelcontextprotocol/sdk/client/index.js": { Client },
    "@modelcontextprotocol/sdk/client/stdio.js": { StdioClientTransport: Transport },
    "@modelcontextprotocol/sdk/client/streamableHttp.js": { StreamableHTTPClientTransport: class extends Transport { constructor(url, options) { super({ url: url.toString(), ...options }) } } },
    "../db": { dbHelpers: { getSetting: async key => settings.get(key), setSetting: async (key, value) => { settings.set(key, value) } } },
    "./agent-protocol": { redactAgentText: value => value },
  }
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, URL, setTimeout, clearTimeout, require: name => mocks[name] ?? require(name) })
  module.exports.registerAgentMcpHandlers()
  return { settings, calls, invoke: (name, ...args) => handlers.get(name)({}, ...args) }
}

test("MCP: импорт JSON сохраняет имя, аргументы, переменные и HTTP-заголовки", async () => {
  const api = mcpApi()
  const servers = await api.invoke("ai:mcp-save", JSON.stringify({ mcpServers: {
    local: { command: "npx", args: ["-y", "example-mcp"], env: { API_KEY: "test-secret" } },
    remote: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer test" } },
  } }))
  assert.equal(servers.length, 2)
  assert.equal(servers[0].name, "local")
  assert.deepEqual(Array.from(servers[0].args), ["-y", "example-mcp"])
  assert.equal(servers[0].env.API_KEY, "test-secret")
  assert.equal(servers[1].headers.Authorization, "Bearer test")
  assert.ok(api.settings.get("agent.mcpServers").startsWith("encrypted:"))
  assert.equal(api.calls.length, 0)
})

test("MCP: старая область доступа игнорируется, сервер доступен агенту в любом контексте", async () => {
  const api = mcpApi()
  await api.invoke("ai:mcp-save", [{ name: "global", command: "npx", enabled: true, scope: "old-project" }])
  const first = await api.invoke("agent:mcp-tools", "another-project")
  const second = await api.invoke("agent:mcp-tools")
  assert.equal(first[0].server, "global")
  assert.equal(second[0].name, "echo")
  const states = await api.invoke("ai:mcp-list")
  assert.equal(Object.hasOwn(states[0], "scope"), false)
  const result = await api.invoke("agent:mcp-call", "global", "echo", { message: "hello" })
  assert.match(result, /hello/)
  assert.equal(api.calls.filter(call => call.action === "connect").length, 1)
})

test("MCP: агент устанавливает сервер, получает инструменты и может отключить его", async () => {
  const api = mcpApi()
  const installed = await api.invoke("agent:mcp-install", JSON.stringify({ mcpServers: { remote: { url: "https://mcp.example.com/mcp" } } }))
  assert.equal(installed[0].connected, true)
  assert.equal(installed[0].transport, "http")
  assert.deepEqual(Array.from(installed[0].tools), ["echo"])
  await api.invoke("ai:mcp-disconnect", "remote")
  assert.equal((await api.invoke("agent:mcp-tools")).length, 0)
  await assert.rejects(api.invoke("agent:mcp-call", "remote", "echo", {}), /выключен/)
})

test("MCP: инструменты агента вызывают IPC без области доступа", async () => {
  const list = AGENT_TOOLS.find(tool => tool.name === "list_mcp_tools")
  const call = AGENT_TOOLS.find(tool => tool.name === "call_mcp_tool")
  const install = AGENT_TOOLS.find(tool => tool.name === "install_mcp_server")
  const requests = []
  const api = {
    agentMcpListTools: async (...args) => { requests.push(args); return [] },
    agentMcpCallTool: async (...args) => { requests.push(args); return "ok" },
    agentMcpInstall: async (...args) => { requests.push(args); return [] },
  }
  await list.run(api, {})
  await call.run(api, { server: "remote", tool: "echo", argumentsJson: '{"value":1}' })
  await install.run(api, { configJson: '{"name":"remote","url":"https://mcp.example.com/mcp"}' })
  assert.deepEqual(requests[0], [])
  assert.deepEqual(requests[1], ["remote", "echo", { value: 1 }])
  assert.equal(requests[2].length, 1)
  await assert.rejects(call.run(api, { server: "remote", tool: "echo", argumentsJson: "[]" }), /JSON-объектом/)
  assert.equal(requests.length, 3)
})

