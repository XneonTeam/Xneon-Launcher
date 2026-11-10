import { app, rpcRegistry, safeStorage } from "../platform/desktop"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { AgentMcpServerConfig, AgentMcpServerState, AgentMcpToolInfo } from "@xnlc/types"
import { dbHelpers } from "../db"
import { redactAgentText } from "./agent-protocol"

const SETTING_KEY = "agent.mcpServers"
const ENCRYPTED_PREFIX = "encrypted:"
const MAX_SERVERS = 24
const MAX_TOOLS_PER_SERVER = 64
const MAX_TOOLS_TOTAL = 64
const MAX_TOOL_SCHEMA_BYTES = 4000
const clients = new Map<string, { client: Client; transport: Transport; tools: AgentMcpToolInfo[]; error?: string }>()
let operationQueue: Promise<void> = Promise.resolve()

function queue<T>(operation: () => Promise<T>): Promise<T> {
  const current = operationQueue.then(operation)
  operationQueue = current.then(() => {}, () => {})
  return current
}

function decodeStored(raw: string): string {
  if (!raw.startsWith(ENCRYPTED_PREFIX)) return raw
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище недоступно для чтения конфигурации MCP")
  try { return safeStorage.decryptString(Buffer.from(raw.slice(ENCRYPTED_PREFIX.length), "base64")) }
  catch { throw new Error("Не удалось расшифровать конфигурацию MCP") }
}

function encodeStored(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище ОС недоступно. Переменные MCP не были сохранены.")
  return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(value).toString("base64")}`
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Каждый сервер MCP должен быть объектом")
  return value as Record<string, unknown>
}

function stringMap(value: unknown, label: string, maxItems = 100): Record<string, string> | undefined {
  if (value === undefined) return undefined
  const source = record(value)
  const entries = Object.entries(source)
  if (entries.length > maxItems) throw new Error(`Слишком много значений в ${label}`)
  const result: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [key, item] of entries) {
    const validKey = label === "env" ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "__proto__", "constructor", "prototype"].includes(key) : /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key)
    if (!validKey || typeof item !== "string" || item.length > 12_000 || /[\r\n\0]/.test(item)) throw new Error(`Некорректное значение ${label}: ${key}`)
    result[key] = item
  }
  return result
}

function normalizeServer(value: unknown, fallbackName?: string): AgentMcpServerConfig {
  const input = record(value)
  const name = typeof input.name === "string" ? input.name.trim() : fallbackName?.trim()
  if (!name || name.length > 80 || !/^[\p{L}\p{N}_. -]+$/u.test(name)) throw new Error("Укажите короткое имя MCP-сервера")
  const command = typeof input.command === "string" ? input.command.trim() : ""
  const url = typeof input.url === "string" ? input.url.trim() : ""
  if (!!command === !!url) throw new Error(`Для «${name}» укажите ровно одно: command или url`)
  if (command.length > 2048 || /[\0\r\n]/.test(command)) throw new Error(`Некорректная команда сервера «${name}»`)
  let normalizedUrl: string | undefined
  if (url) {
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new Error(`Некорректный URL сервера «${name}»`) }
    const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    if (parsed.username || parsed.password || !["https:", "http:"].includes(parsed.protocol) || parsed.protocol === "http:" && !localHttp) throw new Error(`Для удалённого MCP-сервера используйте HTTPS: ${name}`)
    normalizedUrl = parsed.toString()
  }
  const args = input.args === undefined ? undefined : input.args
  if (args !== undefined && (!Array.isArray(args) || args.length > 100 || args.some(arg => typeof arg !== "string" || arg.length > 4096 || /[\0\r\n]/.test(arg)))) throw new Error(`Некорректные аргументы команды сервера «${name}»`)
  if (url && (args !== undefined || input.env !== undefined) || command && input.headers !== undefined) throw new Error(`Параметры транспорта сервера «${name}» не соответствуют URL или команде`)
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error(`Некорректный флаг enabled у сервера «${name}»`)
  return {
    name,
    ...(command ? { command } : { url: normalizedUrl }),
    ...(args ? { args: args as string[] } : {}),
    ...(input.env !== undefined ? { env: stringMap(input.env, "env") } : {}),
    ...(input.headers !== undefined ? { headers: stringMap(input.headers, "headers") } : {}),
    enabled: input.enabled === true,
  }
}

function normalizeConfigs(value: unknown): AgentMcpServerConfig[] {
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > 1_000_000) throw new Error("JSON MCP-конфигурации слишком большой")
    try { value = JSON.parse(value) } catch { throw new Error("Некорректный JSON MCP-конфигурации") }
  }
  let entries: Array<[string | undefined, unknown]>
  if (Array.isArray(value)) entries = value.map(item => [undefined, item])
  else {
    const source = record(value)
    const servers = source.mcpServers ?? source.servers
    if (servers !== undefined) {
      const map = record(servers)
      entries = Object.entries(map)
    } else entries = [[undefined, source]]
  }
  if (entries.length > MAX_SERVERS) throw new Error(`Можно подключить не больше ${MAX_SERVERS} MCP-серверов`)
  const normalized = entries.map(([name, config]) => normalizeServer(config, name))
  const names = new Set<string>()
  for (const server of normalized) {
    const key = server.name.toLocaleLowerCase()
    if (names.has(key)) throw new Error(`Имя MCP-сервера повторяется: ${server.name}`)
    names.add(key)
  }
  return normalized
}

async function readConfigs(): Promise<AgentMcpServerConfig[]> {
  const raw = await dbHelpers.getSetting(SETTING_KEY)
  if (!raw) return []
  const configs = normalizeConfigs(decodeStored(raw))
  if (!raw.startsWith(ENCRYPTED_PREFIX)) await writeConfigs(configs)
  return configs
}

async function writeConfigs(configs: AgentMcpServerConfig[]): Promise<void> {
  const value = JSON.stringify(configs)
  await dbHelpers.setSetting(SETTING_KEY, encodeStored(value))
}

function scrubSecrets(text: string, config: AgentMcpServerConfig): string {
  let result = redactAgentText(text)
  for (const value of Object.values(config.env ?? {})) if (value.length >= 3) result = result.replaceAll(value, "[REDACTED]")
  for (const value of Object.values(config.headers ?? {})) if (value.length >= 3) result = result.replaceAll(value, "[REDACTED]")
  return result
}

async function connect(config: AgentMcpServerConfig) {
  const existing = clients.get(config.name)
  if (existing) return existing
  if (!config.enabled) throw new Error(`MCP-сервер «${config.name}» выключен. Сначала подключите его в настройках AI.`)
  let transport: Transport
  if (config.command) {
    transport = new StdioClientTransport({ command: config.command, args: config.args, env: config.env, stderr: "ignore" })
  } else if (config.url) {
    transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers, redirect: "error" } })
  } else throw new Error(`У MCP-сервера «${config.name}» не задан транспорт`)
  const client = new Client({ name: "xneon-launcher", version: app.getVersion() })
  const connection = { client, transport, tools: [] as AgentMcpToolInfo[] }
  clients.set(config.name, connection)
  try {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error("Истекло время подключения к MCP-серверу (15 сек.)")), 15_000) })
      await Promise.race([client.connect(transport), timeout])
    } finally { if (timeoutHandle) clearTimeout(timeoutHandle) }
    const listed = await client.listTools(undefined, { timeout: 15_000 })
    if (listed.tools.length > MAX_TOOLS_PER_SERVER) throw new Error(`Сервер вернул слишком много инструментов (лимит ${MAX_TOOLS_PER_SERVER})`)
    connection.tools = listed.tools.filter(tool => typeof tool.name === "string" && tool.name.length > 0 && tool.name.length <= 200 && !/[\0-\x1f]/.test(tool.name) && Buffer.byteLength(JSON.stringify(tool.inputSchema ?? {})) <= MAX_TOOL_SCHEMA_BYTES).map(tool => ({
      server: config.name,
      name: tool.name,
      description: scrubSecrets(tool.description || "", config).slice(0, 1500),
      inputSchema: JSON.parse(scrubSecrets(JSON.stringify(tool.inputSchema ?? {}), config)) as Record<string, unknown>,
    }))
    return connection
  } catch (error) {
    clients.delete(config.name)
    await client.close().catch(() => {})
    throw new Error(scrubSecrets(error instanceof Error ? error.message : String(error), config))
  }
}

async function close(name: string, strict = false) {
  const connection = clients.get(name)
  clients.delete(name)
  if (connection) {
    try { await connection.client.close() }
    catch (error) { if (strict) throw error }
  }
}

export async function stopMcpConnections(strict = false): Promise<void> {
  await operationQueue
  const results = await Promise.allSettled([...clients.keys()].map(name => close(name, strict)))
  for (const result of results) if (result.status === "rejected") throw result.reason
}

async function states(connectEnabled = false): Promise<AgentMcpServerState[]> {
  const configs = await readConfigs()
  return Promise.all(configs.map(async config => {
    let error = clients.get(config.name)?.error
    if (connectEnabled && config.enabled && !clients.has(config.name)) {
      try { await connect(config) } catch (value) { error = value instanceof Error ? value.message : String(value) }
    }
    const connection = clients.get(config.name)
    return { ...config, connected: !!connection, tools: connection?.tools.map(tool => tool.name) ?? [], ...(error ? { error } : {}) }
  }))
}

async function listTools(): Promise<AgentMcpToolInfo[]> {
  const configs = await readConfigs()
  const result: AgentMcpToolInfo[] = []
  for (const config of configs) {
    if (!config.enabled) continue
    try {
      const remaining = MAX_TOOLS_TOTAL - result.length
      if (remaining <= 0) break
      result.push(...(await connect(config)).tools.slice(0, remaining))
    }
    catch { /* The read-only listing reports only servers that connected successfully. */ }
  }
  return result
}

function boundedJson(value: unknown): string {
  const json = JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && item.type === "image") return { type: "image", mimeType: item.mimeType, data: "[image omitted]" }
    return item
  })
  if (Buffer.byteLength(json) > 128_000) return `${json.slice(0, 128_000)}…[truncated]`
  return json
}

async function callTool(serverName: string, toolName: string, args: Record<string, unknown>) {
  if (typeof serverName !== "string" || typeof toolName !== "string" || !serverName || !toolName || Buffer.byteLength(JSON.stringify(args)) > 128_000) throw new Error("Некорректный вызов MCP-инструмента")
  const config = (await readConfigs()).find(item => item.name === serverName)
  if (!config) throw new Error(`MCP-сервер «${serverName}» не найден`)
  const connection = await connect(config)
  if (!connection.tools.some(tool => tool.name === toolName)) throw new Error(`Инструмент «${toolName}» не найден на сервере «${serverName}»`)
  try {
    const result = await connection.client.callTool({ name: toolName, arguments: args }, undefined, { timeout: 60_000 })
    const output = scrubSecrets(boundedJson(result), config)
    if (result.isError) throw new Error(output)
    return output
  } catch (error) {
    throw new Error(scrubSecrets(error instanceof Error ? error.message : String(error), config))
  }
}

export function registerAgentMcpHandlers(): void {
  rpcRegistry.handle("ai:mcp-list", () => queue(() => states(true)))
  rpcRegistry.handle("ai:mcp-save", (_event, input: unknown) => queue(async () => {
    const next = normalizeConfigs(input)
    const previous = await readConfigs()
    await writeConfigs(next)
    for (const config of previous) await close(config.name)
    return states(true)
  }))
  rpcRegistry.handle("ai:mcp-connect", (_event, name: string) => queue(async () => {
    if (typeof name !== "string") throw new Error("Некорректное имя MCP-сервера")
    const configs = await readConfigs()
    const index = configs.findIndex(config => config.name === name)
    if (index < 0) throw new Error("MCP-сервер не найден")
    configs[index] = { ...configs[index], enabled: true }
    await writeConfigs(configs)
    try { await connect(configs[index]) }
    catch (error) { return { ...configs[index], connected: false, tools: [], error: error instanceof Error ? error.message : String(error) } }
    return (await states()).find(config => config.name === name)!
  }))
  rpcRegistry.handle("ai:mcp-disconnect", (_event, name: string) => queue(async () => {
    if (typeof name !== "string") throw new Error("Некорректное имя MCP-сервера")
    const configs = await readConfigs()
    const index = configs.findIndex(config => config.name === name)
    if (index < 0) throw new Error("MCP-сервер не найден")
    await close(name)
    configs[index] = { ...configs[index], enabled: false }
    await writeConfigs(configs)
    return { ...configs[index], connected: false, tools: [] }
  }))
  rpcRegistry.handle("agent:mcp-tools", () => queue(() => listTools()))
  rpcRegistry.handle("agent:mcp-call", (_event, server: string, tool: string, args: Record<string, unknown>) => queue(() => callTool(server, tool, args)))
  rpcRegistry.handle("agent:mcp-install", (_event, configJson: string) => queue(async () => {
    if (typeof configJson !== "string" || Buffer.byteLength(configJson) > 64_000) throw new Error("Некорректная MCP-конфигурация")
    const incoming = normalizeConfigs(configJson).map(config => ({ ...config, enabled: true }))
    const current = await readConfigs()
    const merged = new Map(current.map(config => [config.name.toLocaleLowerCase(), config]))
    for (const config of incoming) merged.set(config.name.toLocaleLowerCase(), config)
    const next = [...merged.values()]
    if (next.length > MAX_SERVERS) throw new Error(`Можно подключить не больше ${MAX_SERVERS} MCP-серверов`)
    await writeConfigs(next)
    for (const config of incoming) {
      const replaced = current.find(item => item.name.toLocaleLowerCase() === config.name.toLocaleLowerCase())
      if (replaced) await close(replaced.name)
    }
    return (await states(true)).map(({ name, url, connected, tools, error }) => ({ name, transport: url ? "http" as const : "stdio" as const, connected, tools, ...(error ? { error } : {}) }))
  }))
  let quittingForMcp = false
  app.on("before-quit", event => {
    if (quittingForMcp || clients.size === 0) return
    event.preventDefault()
    quittingForMcp = true
    void stopMcpConnections().finally(() => app.quit())
  })
}
