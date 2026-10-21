import { ipcMain, app, screen } from "electron"
import os from "node:os"
import fs from "node:fs/promises"
import path from "node:path"
import type { AgentBuildFileRequest, AgentChat, AgentChatSummary, AgentTurnRequest, AgentTurnResult } from "@xnlc/types" with { "resolution-mode": "import" }
import { queryAll, run, isDbAvailable } from "../db/core"
import { dbHelpers } from "../db"
import { getBuildIntentPath } from "./builds/helpers"
import { readAgentStream, redactAgentText } from "./agent-protocol"

import { providerHeaders, providerRequest, providerResult, validateProviderKey, type ProviderConfig } from "./ai-providers"
import { agentSystemPrompt, agentCompactionPrompt } from "@xnlc/agent/prompt"
import type { AiModelConfig } from "@xnlc/types"
type ApiConfig = ProviderConfig & { models?: AiModelConfig[] }
const active = new Map<string, { controller: AbortController; owner: number }>()
const fallbackChats = new Map<string, AgentChat>()

function agentApiError(status: number, body: string, language: string, apiKey: string) {
  const ru = language.toLowerCase().startsWith("ru")
  const redactedBody = body.replaceAll(apiKey || "__NO_API_KEY__", "[REDACTED]")
  if (status === 401 || status === 403 || /invalid.{0,30}(api.?key|key)|(?:api.?key|key).{0,30}invalid|unauthorized|invalid_api_key/i.test(redactedBody)) return ru ? "Провайдер отклонил API-ключ. Проверьте ключ и протокол в Настройки → AI." : "The AI provider rejected the API key. Check the key and protocol in Settings → AI."
  if (status === 404) return ru ? "Модель или адрес API не найдены. Проверьте endpoint и выбранную модель в настройках AI." : "The model or API endpoint was not found. Check the endpoint and selected model in AI settings."
  if (status === 429) return ru ? "Слишком много запросов к AI-провайдеру. Повторите попытку чуть позже." : "The AI provider is rate limiting requests. Please try again shortly."
  if (status >= 500) return ru ? `Сбой на стороне AI-провайдера (${status}). Выполнено до 5 попыток; попробуйте позже.` : `The AI provider failed (${status}). Up to 5 attempts were made; please try again later.`
  let detail = body.replaceAll(apiKey || "__NO_API_KEY__", "[REDACTED]").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240)
  try {
    const parsed = JSON.parse(body)
    detail = String(parsed?.error?.message || parsed?.error?.type || parsed?.message || detail).replaceAll(apiKey || "__NO_API_KEY__", "[REDACTED]").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240)
  } catch {}
  return detail ? (ru ? `AI-провайдер вернул ошибку ${status}: ${detail}` : `The AI provider returned error ${status}: ${detail}`) : (ru ? `AI-провайдер вернул ошибку ${status}. Проверьте настройки модели.` : `The AI provider returned error ${status}. Check the model settings.`)
}

async function fetchAgentResponse(url: string, init: RequestInit, language: string, apiKey: string): Promise<Response> {
  const retryDelay = [400, 900, 1800, 3600]
  for (let attempt = 0; attempt < 5; attempt++) {
    let response: Response
    try { response = await fetch(url, init) }
    catch (error) {
      if (init.signal?.aborted || attempt === 4) {
        if (init.signal?.aborted) throw error
        const ru = language.toLowerCase().startsWith("ru")
        throw new Error(ru ? "Не удалось связаться с AI-провайдером после 5 попыток. Проверьте интернет и адрес API." : "Could not reach the AI provider after 5 attempts. Check your connection and API endpoint.")
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay[attempt]))
      continue
    }
    if (response.ok) return response
    const transient = [408, 425, 429].includes(response.status) || response.status >= 500
    if (transient && attempt < 4) {
      await response.body?.cancel().catch(() => {})
      await new Promise(resolve => setTimeout(resolve, retryDelay[attempt]))
      continue
    }
    throw new Error(agentApiError(response.status, await response.text().catch(() => ""), language, apiKey))
  }
  throw new Error("AI request failed")
}


function chatId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[\w-]{1,100}$/.test(value)) throw new Error("Invalid chat ID")
}

async function buildFile(request: AgentBuildFileRequest) {
  if (!request || typeof request.buildId !== "string" || typeof request.path !== "string" || !["list", "read", "write"].includes(request.operation)) throw new Error("Invalid file request")
  const build = await dbHelpers.findBuildById(request.buildId)
  if (!build) throw new Error("Build not found")
  const relative = request.path.replace(/\\/g, "/")
  if (relative.includes(":") || relative.startsWith("/") || relative.split("/").some(part => part === ".." || part.startsWith("."))) throw new Error("Invalid relative path")
  const readable = /^(config(?:\/|$)|logs(?:\/|$)|crash-reports(?:\/|$)|options\.txt$)/.test(relative)
  const writable = /^(config\/.+\.(?:json|json5|toml|cfg|conf|properties|txt|yaml|yml)|options\.txt)$/.test(relative)
  if (!readable || (request.operation === "write" && !writable)) throw new Error("Only build logs and text configuration files are accessible")
  let root: string
  try { root = await fs.realpath(getBuildIntentPath(build.name)) }
  catch (error) {
    if (request.operation === "list" && (error as NodeJS.ErrnoException).code === "ENOENT") return { success: true, entries: [] }
    throw error
  }
  const target = path.resolve(root, relative)
  const inside = (candidate: string) => { const rel = path.relative(root, candidate); return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) }
  // Проверяем realpath и родителя: junction/symlink не должен выводить за сборку.
  const parent = await fs.realpath(path.dirname(target))
  if (!inside(parent)) throw new Error("Path escapes the build directory")
  let resolved = target
  try { resolved = await fs.realpath(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && request.operation === "list") return { success: true, entries: [] }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || request.operation !== "write") throw error
  }
  if (!inside(resolved)) throw new Error("Path escapes the build directory")
  if (request.operation === "list") {
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return { success: true, entries: entries.filter(entry => !entry.isSymbolicLink()).slice(0, 500).map(entry => entry.name + (entry.isDirectory() ? "/" : "")) }
  }
  if (request.operation === "read") {
    const file = await fs.open(resolved, "r")
    try {
      const bytes = Buffer.alloc(128_000)
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error("Not a regular file")
      if (stat.size > bytes.length && !/^(logs|crash-reports)\//.test(relative)) throw new Error("Configuration file is too large to edit safely")
      const { bytesRead } = await file.read(bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length))
      const content = bytes.subarray(0, bytesRead).toString("utf8")
      if (content.includes("\0")) throw new Error("Binary files are not supported")
      return { success: true, content: redactAgentText(content) }
    } finally { await file.close() }
  }
  if (typeof request.content !== "string" || Buffer.byteLength(request.content) > 128_000 || request.content.includes("\0")) throw new Error("Invalid file content")
  if (request.content.includes("[REDACTED]") || request.content.includes("<USER_HOME>")) throw new Error("Cannot overwrite configuration with redacted placeholders")
  // Копия перед заменой конфигурации позволяет откатить изменение вручную.
  try { await fs.copyFile(resolved, `${resolved}.agent-backup-${Date.now()}`, 1) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  await fs.writeFile(resolved, request.content, "utf8")
  return { success: true }
}

export function registerAgentWorkspace(getConfig: () => Promise<ApiConfig | null>): void {
  ipcMain.handle("agent:hardware", async (): Promise<import("@xnlc/types").AgentHardware> => {
    const cpus = os.cpus()
    const gpuInfo = await app.getGPUInfo("complete").catch(() => app.getGPUInfo("basic")).catch(() => ({})) as { auxiliaryAttributes?: { glRenderer?: string }; gpuDevice?: Array<{ deviceString?: string; vendorString?: string; vendorId?: number; deviceId?: number; active?: boolean }> }
    const disk = await fs.statfs(app.getPath("userData")).catch(() => null)
    const primary = screen.getPrimaryDisplay().id
    return { os: { platform: os.platform(), arch: os.arch(), release: os.release(), version: os.version() }, cpu: { model: cpus[0]?.model || "Unknown", logicalCores: cpus.length, speedMHz: cpus[0]?.speed || 0 }, memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() }, gpu: (gpuInfo.gpuDevice || []).map(device => ({ name: device.deviceString || (device.active !== false ? gpuInfo.auxiliaryAttributes?.glRenderer : undefined) || device.vendorString || "Unknown", vendorId: device.vendorId, deviceId: device.deviceId, active: device.active })), displays: screen.getAllDisplays().map(display => ({ width: display.size.width, height: display.size.height, scaleFactor: display.scaleFactor, refreshRate: display.displayFrequency, primary: display.id === primary })), storage: disk ? { availableBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize } : null, launcherVersion: app.getVersion() }
  })

  ipcMain.handle("agent:list-chats", (): AgentChatSummary[] => {
    if (!isDbAvailable()) return [...fallbackChats.values()].map(({ id, title, updatedAt, archived }) => ({ id, title, updatedAt, archived: !!archived })).sort((a, b) => b.updatedAt - a.updatedAt)
    return queryAll<AgentChatSummary>("SELECT id, title, updatedAt, archived FROM agent_chats ORDER BY updatedAt DESC").map(chat => ({ ...chat, archived: !!chat.archived }))
  })
  ipcMain.handle("agent:get-chat", (_event, id: string): AgentChat | null => {
    chatId(id)
    if (!isDbAvailable()) return fallbackChats.get(id) ?? null
    const row = queryAll<{ data: string }>("SELECT data FROM agent_chats WHERE id = ?", [id])[0]
    return row ? JSON.parse(row.data) as AgentChat : null
  })
  ipcMain.handle("agent:save-chat", (_event, chat: AgentChat) => {
    chatId(chat?.id)
    if (chat.archived !== undefined && typeof chat.archived !== "boolean") throw new Error("Invalid archived state")
    if (typeof chat.title !== "string" || !Number.isFinite(chat.updatedAt) || !Array.isArray(chat.messages) || !Array.isArray(chat.timeline) || !Array.isArray(chat.attachments) || typeof chat.draft !== "string" || !["confirm", "auto"].includes(chat.mode)) throw new Error("Invalid chat")
    const data = JSON.stringify(chat)
    if (Buffer.byteLength(data) > 64_000_000) throw new Error("Chat is too large. Start a new chat.")
    if (!isDbAvailable()) { fallbackChats.set(chat.id, structuredClone(chat)); return }
    run("INSERT INTO agent_chats (id, title, updatedAt, data, archived) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updatedAt = excluded.updatedAt, data = excluded.data, archived = excluded.archived", [chat.id, chat.title.slice(0, 160), chat.updatedAt, data, chat.archived ? 1 : 0])
  })
  ipcMain.handle("agent:set-archived", (_event, id: string, archived: boolean) => {
    chatId(id)
    if (typeof archived !== "boolean") throw new Error("Invalid archived state")
    if (!isDbAvailable()) {
      const chat = fallbackChats.get(id)
      if (!chat) throw new Error("Chat not found")
      fallbackChats.set(id, { ...chat, archived })
      return
    }
    const result = run("UPDATE agent_chats SET archived = ?, data = json_set(data, '$.archived', json(?)) WHERE id = ?", [archived ? 1 : 0, JSON.stringify(archived), id])
    if (!result.changes) throw new Error("Chat not found")
  })
  ipcMain.handle("agent:delete-chat", (_event, id: string) => { chatId(id); fallbackChats.delete(id); if (isDbAvailable()) run("DELETE FROM agent_chats WHERE id = ?", [id]) })
  ipcMain.handle("agent:build-file", (_event, request: AgentBuildFileRequest) => buildFile(request))
  ipcMain.handle("agent:build-destination", async (_event, name: string, excludeBuildId?: string) => {
    if (typeof name !== "string" || !name.trim() || name.length > 150 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /^\./.test(name.trim())) throw new Error("Invalid build name")
    const destination = getBuildIntentPath(name)
    const existing = await dbHelpers.loadBuildsLight()
    const same = (left: string, right: string) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
    if (existing.some(build => build.id !== excludeBuildId && same(getBuildIntentPath(build.name), destination))) return { path: destination, available: false }
    const excluded = existing.find(build => build.id === excludeBuildId)
    if (excluded && same(getBuildIntentPath(excluded.name), destination)) return { path: destination, available: true }
    try { await fs.lstat(destination); return { path: destination, available: false } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    return { path: destination, available: true }
  })
  ipcMain.handle("agent:cancel", (event, id: string) => { const request = active.get(id); if (request?.owner === event.sender.id) request.controller.abort() })
  ipcMain.handle("agent:complete", async (event, request: AgentTurnRequest): Promise<AgentTurnResult> => {
    chatId(request?.requestId)
    if (request.purpose !== undefined && request.purpose !== "compact" || request.purpose === "compact" && request.tools?.length !== 0) throw new Error("Invalid agent request purpose")
    if (!Array.isArray(request.messages) || request.messages.length > 500 || !Array.isArray(request.tools) || request.tools.length > 128 || JSON.stringify(request).length > 32_000_000) throw new Error("Agent context is too large. Start a new chat.")
    if (active.has(request.requestId) || [...active.values()].some(value => value.owner === event.sender.id)) throw new Error("An agent request is already running")
    const config = await getConfig()
    if (!config) throw new Error("AI API key not configured. Go to Settings → AI.")
    try { validateProviderKey(config) }
    catch { throw new Error(request.language.toLowerCase().startsWith("ru") ? "API-ключ содержит недопустимые символы. Введите ключ заново в Настройки → AI." : "The API key contains unsupported characters. Re-enter it in Settings → AI.") }
    const url = new URL(config.baseUrl)
    if (!["https:", "http:"].includes(url.protocol) || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Use HTTPS for remote AI providers")
    const controller = new AbortController()
    if ([...active.values()].some(value => value.owner === event.sender.id)) throw new Error("An agent request is already running")
    active.set(request.requestId, { controller, owner: event.sender.id })
    const timer = setTimeout(() => controller.abort(), 180_000)
    const destroyed = () => controller.abort()
    event.sender.once("destroyed", destroyed)
    try {
      const messages = request.messages.filter(message => message.role !== "system").map(message => {
        if (!["user", "assistant", "tool"].includes(message.role) || (message.content !== null && typeof message.content !== "string")) throw new Error("Invalid agent message")
        if (message.images !== undefined && (message.role !== "user" || !Array.isArray(message.images) || message.images.length > 8 || message.images.some(url => typeof url !== "string" || url.length > 2_800_000 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)))) throw new Error("Invalid image attachment")
        return { ...message, content: message.content ? redactAgentText(message.content) : null }
      })
      const selected = config.models?.find(model => model.id === config.modelId)
      if (config.models?.length && !selected) throw new Error("Select an enabled model in AI settings")
      if (messages.some(message => message.images?.length) && !selected?.supportsImages) throw new Error("This model does not support images. Select a model with image support.")
      const language = String(request.language || "ru").slice(0, 20)
      const system = request.purpose === "compact" ? agentCompactionPrompt(language) : agentSystemPrompt(language, request.tools.map(tool => tool.function.name))
      const maxOutputTokens = Math.min(4096, Math.floor((selected?.contextWindow || 256_000) / 4))
      const prepared = providerRequest(config, system, messages, request.tools, { cache: request.purpose !== "compact", maxOutputTokens })
      const response = await fetchAgentResponse(prepared.url, {
        method: "POST", signal: controller.signal,
        headers: providerHeaders(config),
        body: JSON.stringify(prepared.body),
      }, request.language, config.apiKey)
      if (!response.body) throw new Error("AI provider returned an empty body")
      if (config.protocol && config.protocol !== "openai" || response.headers.get("content-type")?.includes("application/json")) {
        const result = providerResult(config.protocol, await response.json())
        if (!result.text.trim() && !result.calls.length) throw new Error(request.language.toLowerCase().startsWith("ru") ? "Модель вернула пустой ответ. Проверьте выбранную модель и повторите запрос." : "The model returned an empty answer. Check the selected model and try again.")
        return result
      }
      return await readAgentStream(response.body, text => { if (!event.sender.isDestroyed()) event.sender.send("agent:delta", { requestId: request.requestId, text }) })
    } finally { clearTimeout(timer); event.sender.removeListener("destroyed", destroyed); active.delete(request.requestId) }
  })
}
