import { getGpuAdapters } from "../platform/windows-native"
import { readClipboardFiles } from "./clipboard-files"
import { rpcRegistry, app, screen } from "../platform/desktop"
import os from "node:os"
import fs from "node:fs/promises"
import path from "node:path"
import type { AgentBuildFileRequest, AgentChat, AgentChatSummary, AgentTurnRequest, AgentTurnResult } from "@xnlc/types" with { "resolution-mode": "import" }
import { queryAll, run, isDbAvailable } from "../db/core"
import { dbHelpers } from "../db"
import { getBuildIntentPath } from "./builds/helpers"
import { aiFailure, assertAiResponse } from "./ai-errors"
import { readAgentStream, redactAgentText } from "./agent-protocol"

import { providerHeaders, providerRequest, providerResult, validateProviderKey, type ProviderConfig } from "./ai-providers"
import { agentSystemPrompt, agentCompactionPrompt } from "@xnlc/agent/prompt"
import { AGENT_TOOLS } from "@xnlc/agent/tools"
import type { AiModelConfig } from "@xnlc/types"
type ApiConfig = ProviderConfig & { models?: AiModelConfig[] }
const active = new Map<string, { controller: AbortController; owner: number }>()
const fallbackChats = new Map<string, AgentChat>()

async function fetchAgentResponse(url: string, init: RequestInit): Promise<Response> {
  const retryDelay = [400, 900, 1800, 3600]
  for (let attempt = 0; attempt < 5; attempt++) {
    let response: Response
    try { response = await fetch(url, { ...init, redirect: "manual" }) }
    catch (error) {
      if (init.signal?.aborted || attempt === 4) throw aiFailure(error)
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
    await assertAiResponse(response)
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
  rpcRegistry.handle("agent:clipboard-files", () => readClipboardFiles())
  rpcRegistry.handle("agent:hardware", async (): Promise<import("@xnlc/types").AgentHardware> => {
    const cpus = os.cpus()
    const [gpu, disk] = await Promise.all([getGpuAdapters(), fs.statfs(app.getPath("userData")).catch(() => null)])
    const primary = screen.getPrimaryDisplay().id
    return { os: { platform: os.platform(), arch: os.arch(), release: os.release(), version: os.version() }, cpu: { model: cpus[0]?.model || "Unknown", logicalCores: cpus.length, speedMHz: cpus[0]?.speed || 0 }, memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() }, gpu, displays: screen.getAllDisplays().map(display => ({ width: display.size.width, height: display.size.height, scaleFactor: display.scaleFactor, refreshRate: display.displayFrequency, primary: display.id === primary })), storage: disk ? { availableBytes: disk.bavail * disk.bsize, totalBytes: disk.blocks * disk.bsize } : null, launcherVersion: app.getVersion() }
  })

  rpcRegistry.handle("agent:list-chats", (): AgentChatSummary[] => {
    if (!isDbAvailable()) return [...fallbackChats.values()].map(({ id, title, updatedAt, archived }) => ({ id, title, updatedAt, archived: !!archived })).sort((a, b) => b.updatedAt - a.updatedAt)
    return queryAll<AgentChatSummary>("SELECT id, title, updatedAt, archived FROM agent_chats ORDER BY updatedAt DESC").map(chat => ({ ...chat, archived: !!chat.archived }))
  })
  rpcRegistry.handle("agent:get-chat", (_event, id: string): AgentChat | null => {
    chatId(id)
    if (!isDbAvailable()) return fallbackChats.get(id) ?? null
    const row = queryAll<{ data: string }>("SELECT data FROM agent_chats WHERE id = ?", [id])[0]
    return row ? JSON.parse(row.data) as AgentChat : null
  })
  rpcRegistry.handle("agent:save-chat", (_event, chat: AgentChat) => {
    chatId(chat?.id)
    if (chat.archived !== undefined && typeof chat.archived !== "boolean") throw new Error("Invalid archived state")
    if (typeof chat.title !== "string" || !Number.isFinite(chat.updatedAt) || !Array.isArray(chat.messages) || !Array.isArray(chat.timeline) || !Array.isArray(chat.attachments) || typeof chat.draft !== "string" || !["questions", "confirm", "auto"].includes(chat.mode)) throw new Error("Invalid chat")
    const data = JSON.stringify(chat)
    if (Buffer.byteLength(data) > 64_000_000) throw new Error("Chat is too large. Start a new chat.")
    if (!isDbAvailable()) { fallbackChats.set(chat.id, structuredClone(chat)); return }
    run("INSERT INTO agent_chats (id, title, updatedAt, data, archived) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updatedAt = excluded.updatedAt, data = excluded.data, archived = excluded.archived", [chat.id, chat.title.slice(0, 160), chat.updatedAt, data, chat.archived ? 1 : 0])
  })
  rpcRegistry.handle("agent:set-archived", (_event, id: string, archived: boolean) => {
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
  rpcRegistry.handle("agent:delete-chat", (_event, id: string) => { chatId(id); fallbackChats.delete(id); if (isDbAvailable()) run("DELETE FROM agent_chats WHERE id = ?", [id]) })
  rpcRegistry.handle("agent:build-file", (_event, request: AgentBuildFileRequest) => buildFile(request))
  rpcRegistry.handle("agent:build-destination", async (_event, name: string, excludeBuildId?: string) => {
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
  rpcRegistry.handle("agent:cancel", (event, id: string) => { const request = active.get(id); if (request?.owner === event.sender.id) request.controller.abort() })
  rpcRegistry.handle("agent:complete", async (event, request: AgentTurnRequest): Promise<AgentTurnResult> => {
    chatId(request?.requestId)
    if (request.purpose !== undefined && request.purpose !== "compact" || request.purpose === "compact" && (request.tools?.length !== 0 || request.mode !== undefined)) throw new Error("Invalid agent request purpose")
    if (request.mode !== undefined && request.mode !== "questions") throw new Error("Invalid agent mode")
    if (!Array.isArray(request.messages) || request.messages.length > 500 || !Array.isArray(request.tools) || request.tools.length > 128 || JSON.stringify(request).length > 32_000_000) throw new Error("Agent context is too large. Start a new chat.")
    if (request.mode === "questions") {
      const allowed = new Set(AGENT_TOOLS.filter(tool => tool.risk === "read" && !["ask_user", "update_plan"].includes(tool.name)).map(tool => tool.name))
      if (request.tools.some(tool => typeof tool?.function?.name !== "string" || !allowed.has(tool.function.name))) throw new Error("Questions mode only allows read-only tools")
    }
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
      const system = request.purpose === "compact" ? agentCompactionPrompt(language) : agentSystemPrompt(language, request.tools.map(tool => tool.function.name), request.mode === "questions")
      const maxOutputTokens = Math.min(4096, Math.floor((selected?.contextWindow || 256_000) / 4))
      const prepared = providerRequest(config, system, messages, request.tools, { cache: request.purpose !== "compact", maxOutputTokens })
      const response = await fetchAgentResponse(prepared.url, {
        method: "POST", signal: controller.signal,
        headers: providerHeaders(config),
        body: JSON.stringify(prepared.body),
      })
      if (!response.body) throw new Error("AI provider returned an empty body")
      if (config.protocol && config.protocol !== "openai" || response.headers.get("content-type")?.includes("application/json")) {
        const result = providerResult(config.protocol, await response.json())
        if (!result.text.trim() && !result.calls.length) throw new Error(request.language.toLowerCase().startsWith("ru") ? "Модель вернула пустой ответ. Проверьте выбранную модель и повторите запрос." : "The model returned an empty answer. Check the selected model and try again.")
        return result
      }
      return await readAgentStream(response.body, text => { if (!event.sender.isDestroyed()) event.sender.send({ channel: "agent:delta", payload: { requestId: request.requestId, text } }) })
    } catch (error) { throw aiFailure(error) }
    finally { clearTimeout(timer); event.sender.removeListener("destroyed", destroyed); active.delete(request.requestId) }
  })
}
