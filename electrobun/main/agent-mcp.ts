import { app, rpcRegistry, safeStorage } from "../platform/desktop"
import { registerShutdownTask, SHUTDOWN_PRIORITY } from "../platform/shutdown"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { AgentMcpServerConfig, AgentMcpServerState, AgentMcpToolInfo } from "@xnlc/types"
import { dbHelpers } from "../db"
import { redactAgentText } from "./agent-protocol"
import { sendToRenderer } from "./runtime"

const SETTING_KEY = "agent.mcpServers"
const ENCRYPTED_PREFIX = "encrypted:"
const MAX_SERVERS = 24
const MAX_TOOLS_PER_SERVER = 64
const MAX_TOOLS_TOTAL = 64
const MAX_TOOL_SCHEMA_BYTES = 4000
const CONNECT_TIMEOUT_MS = 15_000
type McpConnection = {
  client: Client; transport: Transport; config: AgentMcpServerConfig; fingerprint: string
  tools: AgentMcpToolInfo[]; ready: boolean; abort: AbortController
  pending?: Promise<McpConnection>; closing?: Promise<void>; error?: string
}
const clients = new Map<string, McpConnection>()
const configured = new Map<string, AgentMcpServerConfig>()
const closing = new Set<Promise<void>>()
const closingByName = new Map<string, Set<Promise<void>>>()
let stopping = false
let shuttingDown = false
let notificationPending = false
let operationQueue: Promise<void> = Promise.resolve()
let configCache: { raw: string; configs: AgentMcpServerConfig[] } | undefined

// Только локальное чтение/изменение конфигурации. Сеть и вызовы инструментов — вне очереди.
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
  if (!raw) { configCache = undefined; rememberConfigs([]); return [] }
  if (configCache?.raw === raw) {
    const configs = structuredClone(configCache.configs)
    rememberConfigs(configs)
    return configs
  }
  const configs = normalizeConfigs(decodeStored(raw))
  if (!raw.startsWith(ENCRYPTED_PREFIX)) await writeConfigs(configs)
  else { rememberConfigs(configs); configCache = { raw, configs: structuredClone(configs) } }
  return configs
}

async function writeConfigs(configs: AgentMcpServerConfig[]): Promise<void> {
  const value = JSON.stringify(configs)
  const raw = encodeStored(value)
  await dbHelpers.setSetting(SETTING_KEY, raw)
  configCache = { raw, configs: structuredClone(configs) }
  rememberConfigs(configs)
}

function rememberConfigs(configs: AgentMcpServerConfig[]): void {
  configured.clear()
  for (const config of configs) configured.set(config.name, config)
}

function fingerprint(config: AgentMcpServerConfig): string {
  return JSON.stringify({ ...config,
    env: Object.entries(config.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    headers: Object.entries(config.headers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  })
}

function notifyMcpUpdated(): void {
  if (stopping || notificationPending) return
  notificationPending = true
  queueMicrotask(() => {
    notificationPending = false
    if (!stopping) { try { sendToRenderer("ai:mcp-updated", {}) } catch { /* Окно уже закрыто. */ } }
  })
}

function dispose(connection: McpConnection): Promise<void> {
  if (connection.closing) return connection.closing
  connection.abort.abort(new Error("Подключение MCP отменено"))
  const job = Promise.resolve().then(() => connection.transport.close())
  connection.closing = job
  closing.add(job)
  const named = closingByName.get(connection.config.name) ?? new Set<Promise<void>>()
  named.add(job)
  closingByName.set(connection.config.name, named)
  const finished = () => {
    closing.delete(job); named.delete(job)
    if (named.size === 0 && closingByName.get(connection.config.name) === named) closingByName.delete(connection.config.name)
  }
  // Обработка отказа обязательна и для фонового удаления; strict-stop проверяет сам job.
  void job.then(finished, finished)
  return job
}

function close(name: string): Promise<void> {
  const connection = clients.get(name)
  clients.delete(name)
  if (!connection) return Promise.resolve()
  notifyMcpUpdated()
  return dispose(connection)
}

function stillCurrent(connection: McpConnection): boolean {
  const current = configured.get(connection.config.name)
  return !stopping && !connection.abort.signal.aborted && clients.get(connection.config.name) === connection
    && current?.enabled === true && fingerprint(current) === connection.fingerprint
}

function scrubSecrets(text: string, config: AgentMcpServerConfig): string {
  let result = redactAgentText(text)
  for (const value of Object.values(config.env ?? {})) if (value.length >= 3) result = result.replaceAll(value, "[REDACTED]")
  for (const value of Object.values(config.headers ?? {})) if (value.length >= 3) result = result.replaceAll(value, "[REDACTED]")
  return result
}

async function connect(config: AgentMcpServerConfig) {
  const current = configured.get(config.name)
  if (stopping || !current?.enabled || fingerprint(current) !== fingerprint(config)) throw new Error(`MCP-сервер «${config.name}» выключен или изменён`)
  const existing = clients.get(config.name)
  if (existing && existing.fingerprint === fingerprint(config)) {
    if (existing.ready) return existing
    if (existing.pending) return existing.pending
    if (existing.error) throw new Error(existing.error)
  }
  if (existing) void close(config.name)
  // Новый локальный процесс запускается только после завершения старого с тем же именем.
  const previousClosures = [...(closingByName.get(config.name) ?? [])]
  const abort = new AbortController()
  let transport: Transport
  if (config.command) {
    transport = new StdioClientTransport({ command: config.command, args: config.args, env: config.env, stderr: "ignore" })
  } else if (config.url) {
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers, redirect: "error" },
      fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal }),
    })
  } else throw new Error(`У MCP-сервера «${config.name}» не задан транспорт`)
  const client = new Client({ name: "xneon-launcher", version: app.getVersion() })
  const connection: McpConnection = { client, transport, config, fingerprint: fingerprint(config), tools: [], ready: false, abort }
  clients.set(config.name, connection)
  client.onclose = () => {
    if (clients.get(config.name) !== connection || abort.signal.aborted) return
    connection.ready = false
    connection.tools = []
    connection.error = connection.error ?? "Соединение MCP закрыто"
    notifyMcpUpdated()
  }
  connection.pending = (async () => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      if (previousClosures.length) await Promise.allSettled(previousClosures)
      if (!stillCurrent(connection)) throw new Error("Подключение MCP отменено")
      const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => {
        const error = new Error("Истекло время подключения к MCP-серверу (15 сек.)")
        abort.abort(error)
        reject(error)
      }, CONNECT_TIMEOUT_MS) })
      const listed = await Promise.race([(async () => {
        await client.connect(transport, { signal: abort.signal, timeout: CONNECT_TIMEOUT_MS })
        return client.listTools(undefined, { signal: abort.signal, timeout: CONNECT_TIMEOUT_MS })
      })(), timeout])
      if (!stillCurrent(connection)) throw new Error("Подключение MCP отменено")
      if (listed.tools.length > MAX_TOOLS_PER_SERVER) throw new Error(`Сервер вернул слишком много инструментов (лимит ${MAX_TOOLS_PER_SERVER})`)
      connection.tools = listed.tools.filter(tool => typeof tool.name === "string" && tool.name.length > 0 && tool.name.length <= 200 && !/[\0-\x1f]/.test(tool.name) && Buffer.byteLength(JSON.stringify(tool.inputSchema ?? {})) <= MAX_TOOL_SCHEMA_BYTES).map(tool => ({
        server: config.name,
        name: tool.name,
        description: scrubSecrets(tool.description || "", config).slice(0, 1500),
        inputSchema: JSON.parse(scrubSecrets(JSON.stringify(tool.inputSchema ?? {}), config)) as Record<string, unknown>,
      }))
      connection.ready = true
      connection.error = undefined
      return connection
    } catch (error) {
      connection.ready = false
      connection.tools = []
      connection.error = scrubSecrets(error instanceof Error ? error.message : String(error), config)
      void dispose(connection)
      throw new Error(connection.error)
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      connection.pending = undefined
      notifyMcpUpdated()
    }
  })()
  notifyMcpUpdated()
  return connection.pending
}

export async function stopMcpConnections(strict = false): Promise<void> {
  stopping = true
  try {
    await operationQueue
    const pending = [...clients.values()].flatMap(connection => connection.pending ? [connection.pending] : [])
    const jobs = [...closing, ...[...clients.keys()].map(name => close(name))]
    const results = await Promise.allSettled(jobs)
    await Promise.allSettled(pending)
    // Handshake, прерванный закрытием, мог добавить cleanup после первого снимка.
    const remaining = await Promise.allSettled([...closing])
    if (strict) for (const result of [...results, ...remaining]) if (result.status === "rejected") throw result.reason
  } finally { if (!shuttingDown) stopping = false }
}

function states(configs: AgentMcpServerConfig[]): AgentMcpServerState[] {
  return configs.map(config => {
    const connection = clients.get(config.name)
    const matching = connection?.fingerprint === fingerprint(config) ? connection : undefined
    return { ...config, connected: matching?.ready === true, ...(matching?.pending ? { connecting: true } : {}),
      tools: matching?.ready ? matching.tools.map(tool => tool.name) : [], ...(matching?.error ? { error: matching.error } : {}) }
  })
}

function connectInBackground(configs: AgentMcpServerConfig[]): void {
  if (stopping) return
  for (const config of configs) {
    if (config.enabled && !clients.has(config.name)) void connect(config).catch(() => {})
  }
}

function reconcileConnections(next: AgentMcpServerConfig[]): void {
  const nextByName = new Map(next.map(config => [config.name, config]))
  for (const [name, connection] of clients) {
    const config = nextByName.get(name)
    if (!config?.enabled || fingerprint(config) !== connection.fingerprint) void close(name)
  }
  connectInBackground(next)
  notifyMcpUpdated()
}

async function listTools(): Promise<AgentMcpToolInfo[]> {
  const configs = await queue(readConfigs)
  const result: AgentMcpToolInfo[] = []
  const connections = await Promise.all(configs.filter(config => config.enabled).map(config => connect(config).catch(() => null)))
  for (const connection of connections) {
    const remaining = MAX_TOOLS_TOTAL - result.length
    if (remaining <= 0) break
    if (connection && stillCurrent(connection) && connection.ready) result.push(...connection.tools.slice(0, remaining))
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
  const config = (await queue(readConfigs)).find(item => item.name === serverName)
  if (!config) throw new Error(`MCP-сервер «${serverName}» не найден`)
  const connection = await connect(config)
  if (!stillCurrent(connection) || !connection.ready) throw new Error("MCP-сервер выключен или удалён")
  if (!connection.tools.some(tool => tool.name === toolName)) throw new Error(`Инструмент «${toolName}» не найден на сервере «${serverName}»`)
  try {
    const result = await connection.client.callTool({ name: toolName, arguments: args }, undefined, { timeout: 60_000, signal: connection.abort.signal })
    const output = scrubSecrets(boundedJson(result), config)
    if (result.isError) throw new Error(output)
    return output
  } catch (error) {
    throw new Error(scrubSecrets(error instanceof Error ? error.message : String(error), config))
  }
}

export function registerAgentMcpHandlers(): void {
  rpcRegistry.handle("ai:mcp-list", () => queue(async () => {
    const configs = await readConfigs()
    connectInBackground(configs)
    return states(configs)
  }))
  rpcRegistry.handle("ai:mcp-save", (_event, input: unknown) => queue(async () => {
    const next = normalizeConfigs(input)
    await writeConfigs(next)
    reconcileConnections(next)
    return states(next)
  }))
  rpcRegistry.handle("ai:mcp-connect", (_event, name: string) => queue(async () => {
    if (typeof name !== "string") throw new Error("Некорректное имя MCP-сервера")
    const configs = await readConfigs()
    const index = configs.findIndex(config => config.name === name)
    if (index < 0) throw new Error("MCP-сервер не найден")
    configs[index] = { ...configs[index], enabled: true }
    await writeConfigs(configs)
    // Явное включение повторяет ошибку, но не блокирует удаление до конца handshake.
    const existing = clients.get(name)
    if (existing?.error) void close(name)
    void connect(configs[index]).catch(() => {})
    notifyMcpUpdated()
    return states(configs).find(item => item.name === name)!
  }))
  rpcRegistry.handle("ai:mcp-disconnect", (_event, name: string) => queue(async () => {
    if (typeof name !== "string") throw new Error("Некорректное имя MCP-сервера")
    const configs = await readConfigs()
    const index = configs.findIndex(config => config.name === name)
    if (index < 0) throw new Error("MCP-сервер не найден")
    configs[index] = { ...configs[index], enabled: false }
    await writeConfigs(configs)
    void close(name)
    notifyMcpUpdated()
    return { ...configs[index], connected: false, tools: [] }
  }))
  rpcRegistry.handle("agent:mcp-tools", () => listTools())
  rpcRegistry.handle("agent:mcp-call", (_event, server: string, tool: string, args: Record<string, unknown>) => callTool(server, tool, args))
  rpcRegistry.handle("agent:mcp-install", async (_event, configJson: string) => {
    const next = await queue(async () => {
      if (typeof configJson !== "string" || Buffer.byteLength(configJson) > 64_000) throw new Error("Некорректная MCP-конфигурация")
      const incoming = normalizeConfigs(configJson).map(config => ({ ...config, enabled: true }))
      const current = await readConfigs()
      const merged = new Map(current.map(config => [config.name.toLocaleLowerCase(), config]))
      for (const config of incoming) merged.set(config.name.toLocaleLowerCase(), config)
      const configs = [...merged.values()]
      if (configs.length > MAX_SERVERS) throw new Error(`Можно подключить не больше ${MAX_SERVERS} MCP-серверов`)
      await writeConfigs(configs)
      reconcileConnections(configs)
      return configs
    })
    // Установка агентом по-прежнему возвращает итог подключения, но не блокирует настройки.
    await Promise.allSettled(next.filter(config => config.enabled).map(config => connect(config)))
    return queue(async () => states(await readConfigs()).map(({ name, url, connected, tools, error }) => ({ name, transport: url ? "http" as const : "stdio" as const, connected, tools, ...(error ? { error } : {}) })))
  })
  registerShutdownTask("mcp-connections", () => { shuttingDown = true; return stopMcpConnections() }, { priority: SHUTDOWN_PRIORITY.network, timeoutMs: 2500 })
}
