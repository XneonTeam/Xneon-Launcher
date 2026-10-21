import { getAgentHost } from "./host.js"
import type { AiConfig, AiProtocol, AgentAttachment, AgentChat, AgentChatSummary, AgentTimelineItem, AgentWireMessage, AgentTurnResult } from "@xnlc/types"
const i18n = { get language() { return getAgentHost().language() }, t: (key: string, values?: Record<string, unknown>) => getAgentHost().translate(key, values) }
import { AGENT_TOOLS, parseToolInput, getAgentTurnTools, getEnabledToolGroups } from "./tools.js"
import { AGENT_CORE_PROMPT, AGENT_SYSTEM_PROMPT, agentSystemPrompt, agentCompactionPrompt } from "./prompt.js"
import { prepareAgentCompaction, agentCompactionThreshold, isAgentContextOverflow } from "./compaction.js"
export { prepareAgentCompaction } from "./compaction.js"

interface AgentState {
  progress?: { itemId: string; percent: number | null; message: string; fileName?: string; current: number; total: number; bytes: boolean }
  config?: AiConfig
  chats: AgentChatSummary[]
  chat: AgentChat | null
  loading: boolean
  running: boolean
  stopping: boolean
  error: string
  requestId: string | null
  questionId: string | null
  pendingId: string | null
  usage: AgentTurnResult["usage"]
}
let state: AgentState = { chats: [], chat: null, loading: true, running: false, stopping: false, error: "", requestId: null, pendingId: null, questionId: null, usage: undefined }
const listeners = new Set<() => void>()
let initializing: Promise<void> | undefined
let questionAnswer: ((answer: string | null) => void) | undefined
let approval: ((allowed: boolean) => void) | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveQueue: Promise<void> = Promise.resolve()
const id = () => crypto.randomUUID()
const translate = (key: string) => String(i18n.t(`agent.${key}`))
const api = () => getAgentHost().api()
function projectReadKey(toolName: string, input: Record<string, unknown>) {
  const source = String(input.source || "").trim().toLocaleLowerCase()
  const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ")
  if (toolName === "search_projects") return JSON.stringify([toolName, source, normalize(input.query), normalize(input.type), normalize(input.version), normalize(input.loader), normalize(input.page)])
  if (toolName === "get_project") return JSON.stringify([toolName, source, normalize(input.projectId)])
  if (toolName === "get_project_versions") return JSON.stringify([toolName, source, normalize(input.projectId), normalize(input.buildId), normalize(input.version), normalize(input.loader), normalize(input.type)])
  return null
}
function requiresBuildPlan(text: string) {
  const normalized = text.normalize("NFKC").toLocaleLowerCase()
  const buildTopic = /сборк|модпак|mod\s*pack|modpack/.test(normalized)
  const creationIntent = /созда|собер|сдела|подбер|состав|оптимиз|улучш|добав|установ|хочу|помоги|надо|нужно/.test(normalized)
  return buildTopic && creationIntent
}
function buildConfirmationQuestion(text: string) {
  const matches = text.match(/[^?？\n]*[?？]/g) ?? []
  const question = matches.at(-1)?.replace(/[*_`#]/g, "").trim()
  if (!question || !/подтверж|созда|установ|продолж|одобр|соглас/i.test(question)) return null
  return question
}
function splitVersionLoaderQuestion(input: Record<string, unknown>) {
  const question = String(input.question || "")
  const options = Array.isArray(input.options) ? input.options.filter((value): value is string => typeof value === "string") : []
  if (!/minecraft/i.test(question) || !/верс|version/i.test(question) || !/загрузчик|loader/i.test(question) || options.length < 2) return null
  const loaderNames: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", vanilla: "Vanilla" }
  const pairs = options.map(option => {
    const match = option.match(/^\s*(v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)\s*[([]\s*(fabric|forge|neoforge|quilt|vanilla)\s*[)\]]\s*$/i)
    return match ? { version: match[1], loader: loaderNames[match[2].toLowerCase()] } : null
  })
  if (pairs.some(pair => !pair)) return null
  const parsed = pairs as Array<{ version: string; loader: string }>
  const versions = [...new Set(parsed.map(pair => pair.version))]
  const loadersByVersion = Object.fromEntries(versions.map(version => [version, [...new Set(parsed.filter(pair => pair.version === version).map(pair => pair.loader))]]))
  if (versions.length < 2 || !Object.values(loadersByVersion).some(loaders => loaders.length > 1)) return null
  return { versions, loadersByVersion }
}
export async function refreshAgentConfig() {
  const config = await api().getAiConfig?.()
  if (config) patch({ config })
  return config
}
/** Подписка живёт только во время выполнения установки, а не во время подтверждения. */
export function trackAgentInstallation(toolName: string, itemId: string) {
  if (!["install_modpack", "install_content"].includes(toolName)) return () => {}
  let active = true
  patch({ progress: { itemId, percent: null, message: translate("progress.preparing"), current: 0, total: 0, bytes: toolName === "install_content" } })
  const update = (current: number, total: number, message: string, fileName?: string) => {
    if (!active || state.progress?.itemId !== itemId || !Number.isFinite(current) || !Number.isFinite(total)) return
    patch({ progress: { ...state.progress, current: Math.max(0, current), total: Math.max(0, total), percent: total > 0 ? Math.min(100, Math.max(0, Math.round(current / total * 100))) : null, message, fileName: fileName || state.progress.fileName } })
  }
  const offImport = toolName === "install_modpack" ? api().onImportProgress?.(value => update(value.current, value.total, value.message, value.itemName)) : undefined
  const offContent = api().onContentDownloadProgress?.(value => {
    if (!active || state.progress?.itemId !== itemId) return
    if (toolName === "install_content") update(value.current, value.total, translate("progress.downloading"), value.fileName)
    else if (value.fileName) patch({ progress: { ...state.progress, fileName: value.fileName } })
  })
  return () => { active = false; offImport?.(); offContent?.(); if (state.progress?.itemId === itemId) patch({ progress: undefined }) }
}
function patch(value: Partial<AgentState>) { state = { ...state, ...value }; listeners.forEach(listener => listener()) }
function edit(value: Partial<AgentChat>) { if (state.chat) patch({ chat: { ...state.chat, ...value, updatedAt: Date.now() } }) }
function push(item: AgentTimelineItem) { if (state.chat) edit({ timeline: [...state.chat.timeline, item] }) }
function updateItem(itemId: string, value: Partial<AgentTimelineItem>) { if (state.chat) edit({ timeline: state.chat.timeline.map(item => item.id === itemId ? { ...item, ...value } : item) }) }
function removeItem(itemId: string) { if (state.chat) edit({ timeline: state.chat.timeline.filter(item => item.id !== itemId) }) }
function appendMessages(...messages: AgentWireMessage[]) { if (state.chat) edit({ messages: [...state.chat.messages, ...messages] }) }
function summarize(chat: AgentChat): AgentChatSummary { return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, archived: !!chat.archived } }

async function save() {
  clearTimeout(saveTimer)
  if (!state.chat) return
  const chat = structuredClone(state.chat)
  // Последовательная запись исключает перезапись нового состояния старым debounce.
  const pending = saveQueue.then(() => api().agentSaveChat(chat))
  saveQueue = pending.catch(() => {})
  await pending
  patch({ chats: [summarize(chat), ...state.chats.filter(item => item.id !== chat.id)].sort((a, b) => b.updatedAt - a.updatedAt) })
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { void save().catch(error => patch({ error: String(error) })) }, 350) }

function blank(): AgentChat { return { id: id(), title: translate("newChat"), updatedAt: Date.now(), messages: [], timeline: [], draft: "", attachments: [], mode: "confirm" } }

function recover(chat: AgentChat) {
  chat.timeline = chat.timeline.map(item => item.status === "running" || item.status === "approval" ? { ...item, status: "denied" } : item)
  // Восстановление после закрытия во время подтверждения: провайдеру нужны
  // результаты для каждого tool_call, но повторно запускать действие нельзя.
  const answered = new Set(chat.messages.filter(item => item.role === "tool").map(item => item.tool_call_id))
  const messages: AgentWireMessage[] = []
  for (const message of chat.messages) {
    messages.push(message)
    if (message.role === "assistant") for (const call of message.tool_calls ?? []) if (!answered.has(call.id)) messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Application closed before this call completed. Inspect the current launcher state before proposing any further change." }) })
  }
  chat.messages = messages
  return chat
}

export async function initializeAgent(): Promise<void> {
  if (initializing) return initializing
  initializing = (async () => {
    try {
      const chats = await api().agentListChats()
      const latest = chats.find(item => !item.archived)
      const chat = latest ? await api().agentGetChat(latest.id) : null
      // После закрытия приложения незавершённый вызов не выполняется повторно.
      patch({ chats, chat: chat ? recover(chat) : blank(), loading: false })
    } catch (error) { patch({ loading: false, error: String(error), chat: blank() }); initializing = undefined }
  })()
  return initializing
}

export async function newAgentChat(attachments: AgentAttachment[] = [], draft = "") {
  await initializeAgent()
  if (state.running) {
    edit({ attachments: [...(state.chat?.attachments ?? []), ...attachments].slice(0, 8), draft: draft || state.chat?.draft || "" })
    scheduleSave()
    return
  }
  await save()
  patch({ chat: { ...blank(), attachments, draft }, error: "", usage: undefined })
  await save()
}

export async function selectAgentChat(chatId: string) {
  if (state.running || state.loading || state.chat?.id === chatId) return
  patch({ loading: true })
  try {
    await save()
    const chat = await api().agentGetChat(chatId)
    if (chat) patch({ chat: recover(chat), error: "", usage: undefined })
  } catch (error) { patch({ error: String(error) }) } finally { patch({ loading: false }) }
}
export async function deleteAgentChat(chatId: string) {
  if (state.running) return
  clearTimeout(saveTimer)
  await saveQueue
  await api().agentDeleteChat(chatId)
  const chats = state.chats.filter(chat => chat.id !== chatId)
  const latest = chats.find(item => !item.archived)
  const chat = state.chat?.id === chatId ? latest ? await api().agentGetChat(latest.id) : blank() : state.chat
  patch({ chats, chat, error: "" })
}
export async function archiveAgentChat(chatId: string, archived: boolean) {
  if (state.running || state.loading) return
  patch({ loading: true })
  try {
    // Сначала записываем черновик и дожидаемся debounce, чтобы старая запись
    // не сняла архивный флаг после выполнения IPC.
    await save()
    await api().agentSetArchived(chatId, archived)
    const chats = state.chats.map(item => item.id === chatId ? { ...item, archived } : item)
    let chat = state.chat
    if (chat?.id === chatId) {
      if (archived) {
        const next = chats.find(item => !item.archived)
        const loaded = next ? await api().agentGetChat(next.id) : null
        chat = loaded ? recover(loaded) : blank()
      } else chat = { ...chat, archived: false }
    }
    patch({ chats, chat, error: "", usage: undefined })
  } finally { patch({ loading: false }) }
}
export function setAgentDraft(draft: string) { edit({ draft }); scheduleSave() }
export function setAgentMode(mode: AgentChat["mode"]) { if (!state.running) { edit({ mode }); scheduleSave() } }
export function attachToAgent(attachment: AgentAttachment) {
  if (state.chat?.archived) { patch({ error: translate("archive.restoreFirst") }); return }
  if (!state.chat || state.chat.attachments.some(item => item.id === attachment.id)) return
  if (state.chat.attachments.length >= 8) { patch({ error: translate("attachmentLimit") }); return }
  edit({ attachments: [...state.chat.attachments, attachment] }); scheduleSave()
}
export function removeAgentAttachment(attachmentId: string) { if (state.chat) { edit({ attachments: state.chat.attachments.filter(item => item.id !== attachmentId) }); scheduleSave() } }
export function answerAgentApproval(allowed: boolean) { const resolve = approval; approval = undefined; patch({ pendingId: null }); resolve?.(allowed) }
export function answerAgentQuestion(itemId: string, answer: string) {
  if (state.questionId !== itemId || !answer.trim() || answer.length > 6000 || state.stopping) return
  const resolve = questionAnswer
  questionAnswer = undefined
  patch({ questionId: null })
  resolve?.(answer.trim())
}
export async function stopAgent() {
  if (!state.running) return
  patch({ stopping: true })
  const resolveQuestion = questionAnswer
  questionAnswer = undefined
  patch({ questionId: null })
  resolveQuestion?.(null)
  answerAgentApproval(false)
  if (state.requestId) await api().agentCancel(state.requestId)
  if (state.chat?.timeline.some(item => item.toolName === "install_modpack" && item.status === "running")) await api().cancelImportModpack()
}

/** Обрезаем только по границам пользовательских ходов, сохраняя пары tool_call/result. */
export const AGENT_CONTEXT_TOKENS = 256_000
export const AGENT_CONTEXT_MESSAGES = 450
export function estimateContextTokens(messages: AgentWireMessage[], protocol: AiProtocol = state.config?.protocol || "openai") {
  // Gemini хранит те же текст и вызовы в providerParts: считаем только одну форму.
  return messages.reduce((total, message) => total + Math.ceil(JSON.stringify(protocol === "gemini" && message.providerParts?.length ? { role: message.role, parts: message.providerParts } : { ...message, images: undefined, providerParts: undefined }).length / 4) + (message.images?.length || 0) * 1600 + 4, 0)
}
function contextHash(value: unknown) {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return `${text.length}:${hash >>> 0}`
}
function contextScope(config = state.config) {
  return contextHash([config?.endpoint, config?.protocol || "openai", config?.model, i18n.language || "ru", AGENT_CORE_PROMPT, AGENT_SYSTEM_PROMPT])
}
function contextOverhead(messages: AgentWireMessage[], groups: string[] = []) {
  const tools = getAgentTurnTools(messages, groups)
  return { instructions: Math.ceil(agentSystemPrompt(i18n.language || "ru", tools.map(tool => tool.name)).length / 4), tools: Math.ceil(JSON.stringify(tools.map(tool => tool.spec)).length / 4) }
}
/** Замер относится только к конкретному префиксу истории и провайдеру. Старые сохранённые поправки не переносим. */
export function measureAgentContext(messages: AgentWireMessage[], tokens: number, config = state.config, overheadTokens = Object.values(contextOverhead(messages)).reduce((sum, value) => sum + value, 0)): NonNullable<AgentChat["contextUsage"]> {
  return { model: config?.model || "", tokens, scope: contextScope(config), messageCount: messages.length, prefixHash: contextHash(messages), overheadTokens }
}
function contextSize(messages: AgentWireMessage[], overhead: number, measured?: AgentChat["contextUsage"], config = state.config) {
  const count = measured?.messageCount ?? 0
  const previousOverhead = measured?.overheadTokens
  if (measured && Number.isFinite(measured.tokens) && measured.tokens > 0 && measured.scope === contextScope(config) && Number.isInteger(count) && count > 0 && count <= messages.length && typeof previousOverhead === "number" && Number.isFinite(previousOverhead) && previousOverhead >= 0 && measured.prefixHash === contextHash(messages.slice(0, count))) {
    const delta = overhead - previousOverhead
    const known = Math.max(0, measured.tokens + Math.min(0, delta))
    const estimated = estimateContextTokens(messages.slice(count), config?.protocol) + Math.max(0, delta)
    return { tokens: known + estimated, estimated, approximate: delta !== 0 || count < messages.length }
  }
  const estimated = estimateContextTokens(messages, config?.protocol) + overhead
  return { tokens: estimated, estimated, approximate: true }
}
export function agentContext(messages: AgentWireMessage[], maxTokens = AGENT_CONTEXT_TOKENS, reserveTokens = 0, measured?: AgentChat["contextUsage"], config = state.config): AgentWireMessage[] {
  let start = 0
  while (true) {
    const size = contextSize(messages.slice(start), reserveTokens, start === 0 ? measured : undefined, config)
    // Запас на ответ — отдельно от заполнения; погрешность добавляем только к оценённой части.
    if (messages.length - start <= AGENT_CONTEXT_MESSAGES && size.tokens + Math.ceil(size.estimated * 0.15) <= maxTokens - Math.min(4096, Math.floor(maxTokens / 4))) break
    const next = messages.findIndex((message, index) => index > start && message.role === "user")
    if (next < 0) throw new Error(translate("contextFull"))
    start = next
  }
  return messages.slice(start)
}

function userContent(text: string, attachments: AgentAttachment[]) {
  const limit = Math.min(28_000, Math.floor(80_000 / Math.max(1, attachments.length)))
  return [text, ...attachments.map(item => `<attachment name=${JSON.stringify(item.name)} kind=${JSON.stringify(item.kind)}>\n${item.content.length > limit ? `[${translate("attachmentTruncated")}]\n${item.content.slice(-limit)}` : item.content}\n</attachment>`)].join("\n\n")
}

/** Считаем тот же контекст, который уйдёт провайдеру, включая черновик и усечённые вложения. */
export function agentContextUsage(messages: AgentWireMessage[], draft = "", attachments: AgentAttachment[] = [], contextWindow = AGENT_CONTEXT_TOKENS, measured?: AgentChat["contextUsage"], config = state.config, groups: string[] = []) {
  // До появления содержимого запроса контекст ещё не сформирован.
  // Не показываем служебный резерв как расход пустого чата.
  if (!messages.length && !draft.trim() && !attachments.length) {
    return { tokens: 0, contextWindow, percent: 0, trimmed: false, full: false, approximate: false, breakdown: ["instructions", "tools", "messages", "attachments", "draft"].map(key => ({ key, tokens: 0 })) }
  }
  const pending: AgentWireMessage[] = draft.trim() || attachments.length ? [{ role: "user", content: userContent(draft.trim() || translate("inspectAttachments"), attachments), ...(attachments.some(item => item.imageUrl) ? { images: attachments.flatMap(item => item.imageUrl ? [item.imageUrl] : []) } : {}) }] : []
  const all = [...messages, ...pending]
  let trimmed = false, full = false
  const overhead = contextOverhead(messages, groups)
  const reserve = overhead.instructions + overhead.tools
  try { trimmed = agentContext(all, contextWindow, reserve, measured, config).length < all.length } catch { full = true }
  // Показываем текущее заполнение, а не размер после ещё не выполненной обрезки.
  const { tokens, approximate } = contextSize(all, reserve, measured, config)
  if (tokens > agentCompactionThreshold(contextWindow) && prepareAgentCompaction(all, contextWindow, items => estimateContextTokens(items, config?.protocol))) { trimmed = true; full = false }
  const categories = { ...overhead, messages: 0, attachments: 0, draft: 0 }
  for (const message of all) {
    const total = estimateContextTokens([message], config?.protocol)
    if (message.role === "tool") { categories.tools += total; continue }
    const text = { ...message, tool_calls: undefined, providerParts: undefined }
    const textTokens = estimateContextTokens([text], config?.protocol)
    categories.tools += Math.max(0, total - textTokens)
    const attachmentStart = message.role === "user" ? (message.content || "").indexOf("\n\n<attachment name=") : -1
    const plain = { ...text, images: undefined, content: attachmentStart >= 0 ? message.content!.slice(0, attachmentStart) : message.content }
    const plainTokens = estimateContextTokens([plain], config?.protocol)
    categories.attachments += textTokens - plainTokens
    categories[pending.includes(message) ? "draft" : "messages"] += plainTokens
  }
  // Провайдер сообщает общий расход, поэтому категории оцениваем пропорционально;
  // накопительное округление сохраняет точную сумму и нулевые категории.
  const estimatedTotal = Object.values(categories).reduce((sum, value) => sum + value, 0)
  let cumulative = 0, allocated = 0
  const breakdown = Object.entries(categories).map(([key, value]) => {
    cumulative += value
    const next = Math.round(cumulative / estimatedTotal * tokens)
    const count = next - allocated
    allocated = next
    return { key, tokens: count }
  })
  return { tokens, contextWindow, percent: Math.min(100, Math.round(tokens / contextWindow * 100)), trimmed, full, approximate, breakdown }
}
export function toolResult(value: unknown, forContext = false) {
  // Картинки в base64 не нужны модели и быстро переполняют контекст.
  const serialized = JSON.stringify(value ?? { success: true }, (key, item: unknown) => typeof item === "string" && item.startsWith("data:") ? undefined : item)
  if (forContext) {
    const compact = toolContextResult(serialized)
    if (compact.length <= 24_000) return compact
  }
  if (serialized.length <= 24_000) return serialized
  const parsed = JSON.parse(serialized)
  const card = (project: Record<string, unknown>) => Object.fromEntries(["id", "projectId", "modId", "source", "slug", "name", "summary", "iconUrl", "downloadCount", "downloads", "categories", "contentType"].filter(key => project[key] !== undefined).map(key => [key, typeof project[key] === "string" ? project[key].slice(0, key === "iconUrl" ? 1000 : 300) : Array.isArray(project[key]) ? project[key].slice(0, 8).map(String).map((item: string) => item.slice(0, 80)) : project[key]]))
  const metadata = parsed && typeof parsed === "object" ? (Array.isArray(parsed.results) ? { results: parsed.results.slice(0, 4).filter((item: unknown) => item && typeof item === "object").map(card) } : card(parsed)) : {}
  return JSON.stringify({ ...metadata, truncated: true, data: serialized.slice(0, 8000) })
}

/** Длинные описания и галереи остаются в карточке UI; модели нужны идентификаторы и рабочие поля. */
export function toolContextResult(serialized: string) {
  if (serialized.length <= 6000) return serialized
  let parsed: unknown
  try { parsed = JSON.parse(serialized) } catch { return serialized }
  const omitted: string[] = []
  const project = (value: unknown, path = "", key = ""): unknown => {
    if (typeof value === "string") {
      const limit = /^(description|body|changelog|summary)$/.test(key) ? 1500 : key === "content" ? 6000 : undefined
      if (limit && value.length > limit) { omitted.push(path); return key === "content" ? `[Начало исключено; показан хвост]\n${value.slice(-limit)}` : `${value.slice(0, limit)}\n[Описание сокращено; запроси подробности при необходимости]` }
      return value
    }
    if (Array.isArray(value)) {
      const limit = key === "results" ? 12 : key === "gallery" || key === "screenshots" ? 1 : undefined
      if (limit && value.length > limit) omitted.push(path)
      return (limit ? value.slice(0, limit) : value).map((item, index) => project(item, `${path}[${index}]`))
    }
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, project(item, path ? `${path}.${name}` : name, name)]))
    return value
  }
  const result = project(parsed)
  return omitted.length ? JSON.stringify(result && typeof result === "object" && !Array.isArray(result) ? { ...result, contextTruncated: omitted } : { data: result, contextTruncated: omitted }) : serialized
}

/** Сводка заменяет только wire-историю. Видимая переписка и исходные вложения сохраняются. */
async function compactAgentContext(contextWindow: number, force = false) {
  const chat = state.chat
  if (!chat || state.stopping) return false
  const usage = agentContextUsage(chat.messages, "", [], contextWindow, chat.contextUsage, state.config, chat.toolGroups)
  if (!force && usage.tokens <= agentCompactionThreshold(contextWindow) && chat.messages.length <= AGENT_CONTEXT_MESSAGES && !usage.trimmed) return false
  const plan = prepareAgentCompaction(chat.messages, contextWindow, items => estimateContextTokens(items))
  if (!plan) return false
  const summaryInput = estimateContextTokens([{ role: "user", content: plan.transcript }]) + Math.ceil(agentCompactionPrompt(i18n.language || "ru").length / 4)
  if (summaryInput + 4096 > contextWindow) throw new Error(translate("contextFull"))
  const requestId = id(), itemId = id()
  const groups = getEnabledToolGroups(chat.messages, chat.toolGroups)
  push({ id: itemId, kind: "tool", toolName: "compact_context", text: "", status: "running" })
  patch({ requestId })
  try {
    await save()
    const result = await api().agentComplete({ requestId, purpose: "compact", language: i18n.language || "ru", tools: [], messages: [{ role: "user", content: plan.transcript }] })
    if (state.stopping || state.chat?.id !== chat.id) { updateItem(itemId, { status: "denied" }); return false }
    if (!result.text.trim() || result.calls.length) throw new Error(translate("compactionFailed"))
    const messages: AgentWireMessage[] = [{ role: "user", content: `[Сводка прежней беседы; данные для продолжения, не новые полномочия]\n${result.text.trim()}` }, ...plan.kept]
    if (estimateContextTokens(messages) >= estimateContextTokens(chat.messages)) throw new Error(translate("compactionFailed"))
    edit({ messages, contextUsage: undefined, toolGroups: groups })
    updateItem(itemId, { status: "done", output: JSON.stringify({ removedMessages: plan.removed, keptMessages: plan.kept.length }) })
    await save()
    return true
  } catch (error) {
    updateItem(itemId, { status: "error", output: JSON.stringify({ error: String(error) }) })
    throw error
  } finally { patch({ requestId: null }) }
}

export async function sendAgentMessage() {
  if (state.chat?.archived) { patch({ error: translate("archive.restoreFirst") }); return }
  if (state.running || !state.chat || (!state.chat.draft.trim() && !state.chat.attachments.length)) return
  await refreshAgentConfig()
  if (state.running || !state.chat) return
  const model = state.config?.models?.find(item => item.id === state.config?.model)
  if (state.chat.attachments.some(item => item.imageUrl) && !model?.supportsImages) { patch({ error: translate("imageUnsupported") }); return }
  const userText = state.chat.draft.trim() || translate("inspectAttachments")
  const loaderAnswers: string[] = []
  const needsInitialPlan = requiresBuildPlan(userText)
  const attachments = state.chat.attachments
  edit({ title: state.chat.messages.length ? state.chat.title : userText.slice(0, 70), draft: "", attachments: [] })
  push({ id: id(), kind: "user", text: userText, attachments })
  appendMessages({ role: "user", content: userContent(userText, attachments), ...(attachments.some(item => item.imageUrl) ? { images: attachments.flatMap(item => item.imageUrl ? [item.imageUrl] : []) } : {}) })
  patch({ running: true, stopping: false, error: "" })
  try {
    await save()
    let completed = false
    let guardFailed = false
    let planCreated = false
    let planTextRetryCount = 0
    let planToolRetryCount = 0
    let planReminder: AgentWireMessage | undefined
    const declinedUnlocks = new Set<string>()
    const projectReadCache = new Map<string, string>()
    let overflowRecovered = false
    for (let step = 0; step < 120 && !state.stopping; step++) {
      await compactAgentContext(model?.contextWindow || AGENT_CONTEXT_TOKENS)
      if (state.stopping) break
      const requestId = id(), itemId = id()
      patch({ requestId })
      push({ id: itemId, kind: "assistant", text: "", status: "running" })
      let partial = ""
      const off = api().onAgentDelta(event => { if (event.requestId === requestId) { partial += event.text; updateItem(itemId, { text: partial }) } })
      let result: AgentTurnResult
      let sentContext: AgentWireMessage[] = []
      let sentOverhead = 0
      try {
        const tools = getAgentTurnTools(state.chat!.messages, state.chat!.toolGroups).map(tool => tool.spec)
        const overhead = contextOverhead(state.chat!.messages, state.chat!.toolGroups)
        sentOverhead = overhead.instructions + overhead.tools
        sentContext = agentContext(state.chat!.messages, model?.contextWindow || AGENT_CONTEXT_TOKENS, sentOverhead + (planReminder ? estimateContextTokens([planReminder]) : 0), state.chat!.contextUsage)
        if (sentContext.length < state.chat!.messages.length) throw new Error(translate("contextFull"))
        if (planReminder) sentContext = [...sentContext, planReminder]
        result = await api().agentComplete({ requestId, messages: sentContext, tools, language: i18n.language || "ru" })
      } catch (error) {
        if (!overflowRecovered && isAgentContextOverflow(error)) {
          overflowRecovered = true
          removeItem(itemId)
          if (await compactAgentContext(model?.contextWindow || AGENT_CONTEXT_TOKENS, true)) continue
        }
        throw error
      } finally { off(); patch({ requestId: null }); updateItem(itemId, { status: "done" }) }
      if (result.usage) patch({ usage: result.usage })
      const implicitQuestion = needsInitialPlan && planCreated && !result.calls.length ? buildConfirmationQuestion(result.text) : null
      const implicitQuestionCall = implicitQuestion ? {
        id: id(),
        type: "function" as const,
        function: { name: "ask_user", arguments: JSON.stringify({ question: implicitQuestion, options: ["Да, создать сборку", "Изменить план"] }) },
      } : undefined
      const callsToProcess = result.calls.length ? result.calls : implicitQuestionCall ? [implicitQuestionCall] : []
      const planCall = needsInitialPlan && !planCreated ? callsToProcess.find(call => call.function.name === "update_plan") : undefined
      const prematureCalls = needsInitialPlan && !planCreated && callsToProcess.length > 0 && !planCall
      const prematureText = needsInitialPlan && !planCreated && !callsToProcess.length
      updateItem(itemId, { text: needsInitialPlan && (!planCreated || implicitQuestionCall) ? "" : result.text })
      if (prematureText) {
        removeItem(itemId)
        // Текстовый ответ тоже не обходим: просим модель сначала создать план.
        planTextRetryCount++
        if (planTextRetryCount > 2) {
          push({ id: id(), kind: "error", text: "Не удалось создать план сборки до начала поиска. Попробуйте отправить запрос ещё раз." })
          guardFailed = true
          break
        }
        planReminder = { role: "user", content: "First call update_plan with the complete instance plan and completedSteps=0. Until the plan exists, do not reply with text or call other tools." }
        await save()
        continue
      }
      planReminder = undefined
      if (implicitQuestionCall) removeItem(itemId)
      appendMessages({ role: "assistant", content: implicitQuestionCall ? null : result.text || null, ...(callsToProcess.length ? { tool_calls: callsToProcess } : {}), ...(!implicitQuestionCall && result.providerParts ? { providerParts: result.providerParts } : {}) })
      if (Number.isFinite(result.usage?.prompt_tokens) && result.usage!.prompt_tokens! > 0) {
        const input = result.usage!.prompt_tokens!
        const output = Number.isFinite(result.usage?.completion_tokens) ? Math.max(0, result.usage!.completion_tokens!) : 0
        const total = Math.max(input + output, Number.isFinite(result.usage?.total_tokens) ? result.usage!.total_tokens! : 0)
        const outputMeasured = Number.isFinite(result.usage?.completion_tokens) || total > input
        // Синтетический ask_user не является выводом провайдера: считаем его отдельно от замеренного входа.
        const includeOutput = !implicitQuestionCall && outputMeasured
        edit({ contextUsage: measureAgentContext(includeOutput ? [...sentContext, state.chat!.messages.at(-1)!] : sentContext, includeOutput ? total : input, state.config, sentOverhead) })
      }
      if (prematureCalls) {
        removeItem(itemId)
        // Сохраняем вызовы и ответы об отказе только в wire-контексте, без
        // timeline-карточек: поиск не должен начинаться раньше видимого плана.
        for (const call of result.calls) appendMessages({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Create a visible update_plan before any other tool call. No tool was run." }) })
        planToolRetryCount++
        await save()
        if (planToolRetryCount > 2) {
          push({ id: id(), kind: "error", text: "Агент не создал план сборки до начала поиска. Попробуйте отправить запрос ещё раз." })
          guardFailed = true
          break
        }
        continue
      }
      if (!callsToProcess.length) { completed = true; break }
      const calls = needsInitialPlan && !planCreated
        ? [...callsToProcess.filter(call => call.function.name === "update_plan"), ...callsToProcess.filter(call => call.function.name !== "update_plan")]
        : callsToProcess
      for (const call of calls) {
        if (needsInitialPlan && !planCreated && call.function.name !== "update_plan") {
          appendMessages({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "The update_plan call did not succeed. No other tool was run; create the plan before continuing." }) })
          await save()
          continue
        }
        const tool = AGENT_TOOLS.find(tool => tool.name === call.function.name)
        const toolId = id()
        push({ id: toolId, kind: "tool", text: "", toolName: call.function.name, input: call.function.arguments, status: "running" })
        let output: string
        let contextOutput: string | undefined
        try {
          if (state.stopping) throw new Error("The user stopped the agent. Do not execute this call.")
          if (!tool) throw new Error("Unknown tool")
          const input = parseToolInput(tool, call.function.arguments)
          if (tool.name === "create_server") {
            const loader = String(input.loader || "vanilla").toLowerCase()
            const aliases: Record<string, string[]> = { fabric: ["fabric", "фабрик"], forge: ["forge", "фордж"], neoforge: ["neoforge", "неофордж"], vanilla: ["vanilla", "ваниль", "ванильный"], paper: ["paper", "папер"], quilt: ["quilt", "квилт"] }
            const selected = [userText, ...loaderAnswers].some(answer => (aliases[loader] || [loader]).some(name => new RegExp(`(^|[^\\p{L}\\p{N}])${name}($|[^\\p{L}\\p{N}])`, "iu").test(answer)))
            if (!selected) {
              output = JSON.stringify({ requiresUserChoice: true, instruction: "Server was NOT created. The user has not selected this server loader. Check available server loaders for the requested Minecraft version, ask a separate interactive ask_user question, wait for the answer, then update the plan and loaderVersion before calling create_server again. Do not select Fabric merely because ViaVersion was requested." })
              updateItem(toolId, { status: "done", output })
              appendMessages({ role: "tool", tool_call_id: call.id, content: output })
              await save()
              continue
            }
          }
          const cacheKey = tool.risk === "read" ? projectReadKey(tool.name, input) : null
          const cachedOutput = cacheKey ? projectReadCache.get(cacheKey) : undefined
          if (cachedOutput !== undefined) {
            output = cachedOutput
            updateItem(toolId, { status: "done", output })
            appendMessages({ role: "tool", tool_call_id: call.id, content: toolContextResult(output) })
            await save()
            continue
          }
          if (tool.name === "ask_user") {
            const split = splitVersionLoaderQuestion(input)
            if (split) {
              const firstQuestion = { question: String(i18n.t("agent.question.minecraftVersion")), options: split.versions }
              updateItem(toolId, { input: JSON.stringify(firstQuestion) })
              const askInTimeline = async (questionId: string) => {
                const response = new Promise<string | null>(resolve => { questionAnswer = resolve; patch({ questionId }) })
                try { await save() } catch (error) { questionAnswer = undefined; patch({ questionId: null }); throw error }
                return response
              }
              const version = await askInTimeline(toolId)
              updateItem(toolId, { status: version === null ? "denied" : "done", output: JSON.stringify({ answer: version ?? translate("question.cancelled") }) })
              let answer: string | null = null
              if (version !== null && !state.stopping) {
                const compatibleLoaders = split.loadersByVersion[version]
                if (compatibleLoaders?.length > 1) {
                  const loaderQuestionId = id()
                  push({ id: loaderQuestionId, kind: "tool", text: "", toolName: "ask_user", input: JSON.stringify({ question: String(i18n.t("agent.question.minecraftLoader", { version })), options: compatibleLoaders }), status: "running" })
                  const loader = await askInTimeline(loaderQuestionId)
                  if (loader !== null) loaderAnswers.push(loader)
                  updateItem(loaderQuestionId, { status: loader === null ? "denied" : "done", output: JSON.stringify({ answer: loader ?? translate("question.cancelled") }) })
                  if (loader !== null) answer = `${version} (${loader})`
                } else if (compatibleLoaders?.length === 1) answer = `${version} (${compatibleLoaders[0]})`
                else answer = version
              }
              output = JSON.stringify(answer === null ? { error: "The user stopped the question. Do not assume an answer." } : { answer })
              appendMessages({ role: "tool", tool_call_id: call.id, content: output })
              await save()
              continue
            }
            const response = new Promise<string | null>(resolve => { questionAnswer = resolve; patch({ questionId: toolId }) })
            // Подписка создаётся до сохранения, чтобы быстрый ответ не потерялся.
            try { await save() } catch (error) { questionAnswer = undefined; patch({ questionId: null }); throw error }
            const answer = await response
            if (answer !== null) loaderAnswers.push(answer)
            output = JSON.stringify(answer === null ? { error: "The user stopped the question. Do not assume an answer." } : { answer })
            updateItem(toolId, { status: answer === null ? "denied" : "done", output })
            appendMessages({ role: "tool", tool_call_id: call.id, content: output })
            await save()
            continue
          }
          const needsUnlockedBuild = ["install_content", "remove_content", "toggle_content", "set_build_version", "write_build_config", "remove_world_datapack"].includes(tool.name) || tool.group === "build_options" && tool.risk !== "read"
          if (tool.name === "unlock_build" || needsUnlockedBuild) {
            if (declinedUnlocks.has(String(input.buildId))) throw new Error("The user declined unlocking this build. Do not ask again in this turn.")
            const target = (await api().loadBuildsLight()).find(build => build.id === input.buildId)
            if (!target) throw new Error("Build not found")
            const locked = target.locked === true || ["modrinth", "curseforge"].includes(target.source) && target.locked !== false
            if (locked) {
              const questionId = id()
              const yes = translate("unlock.accept"), no = translate("unlock.reject")
              const question = String(i18n.t("agent.unlock.question", { name: target.name }))
              push({ id: questionId, kind: "tool", toolName: "ask_user", text: "", status: "running", input: JSON.stringify({ question, options: [yes, no] }) })
              const response = new Promise<string | null>(resolve => { questionAnswer = resolve; patch({ questionId }) })
              try { await save() } catch (error) { questionAnswer = undefined; patch({ questionId: null }); throw error }
              const answer = await response
              const accepted = answer !== null && [yes.toLocaleLowerCase(), "да", "yes", "так", "ja", "sí", "si"].includes(answer.trim().toLocaleLowerCase().replace(/[.!]+$/, ""))
              updateItem(questionId, { status: answer === null ? "denied" : "done", output: JSON.stringify({ answer: answer || translate("question.cancelled") }) })
              if (!accepted || state.stopping) { declinedUnlocks.add(String(input.buildId)); throw new Error("The user declined or stopped unlocking this build. Keep it locked and do not retry.") }
              if (tool.name !== "unlock_build") {
                await api().updateBuildFields(target.id, { locked: false })
                push({ id: id(), kind: "tool", toolName: "unlock_build", text: "", status: "done", input: JSON.stringify({ buildId: target.id }), output: JSON.stringify({ success: true, locked: false }) })
                getAgentHost().emit("launcher:agent-updated")
              }
            }
          }
          if (tool.name !== "unlock_build" && (tool.risk === "delete" || tool.risk === "sensitive" || tool.risk === "write" && state.chat?.mode !== "auto")) {
            updateItem(toolId, { status: "approval" })
            // Обработчик ставится до уведомления React о появлении кнопок.
            const decision = new Promise<boolean>(resolve => { approval = resolve; patch({ pendingId: toolId }) })
            await save()
            const allowed = await decision
            if (!allowed || state.stopping) {
              output = JSON.stringify({ error: "The user declined or stopped this action. Do not retry it." })
              updateItem(toolId, { status: "denied", output })
              appendMessages({ role: "tool", tool_call_id: call.id, content: output })
              continue
            }
            updateItem(toolId, { status: "running" })
          }
          if (state.stopping) throw new Error("The user stopped the agent")
          const stopProgress = trackAgentInstallation(tool.name, toolId)
          let value: unknown
          try { value = await tool.run(api(), input) } finally { stopProgress() }
          output = toolResult(value)
          contextOutput = toolResult(value, true)
          const failed = value !== null && typeof value === "object" && "success" in value && value.success === false
          if (tool.name === "update_plan" && !failed && value !== null && typeof value === "object" && Array.isArray((value as { steps?: unknown }).steps)) planCreated = true
          updateItem(toolId, { status: failed ? "error" : "done", output })
          if (cacheKey && !failed) projectReadCache.set(cacheKey, output)
          if (tool.risk !== "read") getAgentHost().emit("launcher:agent-updated")
        } catch (error) {
          output = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
          updateItem(toolId, { status: error instanceof Error && error.message.startsWith("The user declined") ? "denied" : "error", output })
        }
        appendMessages({ role: "tool", tool_call_id: call.id, content: contextOutput ?? toolContextResult(output) })
        await save()
      }
    }
    if (!completed && !guardFailed && !state.stopping) push({ id: id(), kind: "error", text: translate("stepLimit") })
  } catch (error) {
    if (!state.stopping) { const message = error instanceof Error ? error.message : String(error); patch({ error: message }); push({ id: id(), kind: "error", text: message }) }
  } finally {
    if (state.stopping) push({ id: id(), kind: "stopped", text: translate("stopped") })
    answerAgentApproval(false)
    questionAnswer = undefined
    patch({ running: false, stopping: false, requestId: null, questionId: null })
    await save().catch(error => patch({ error: String(error) }))
  }
}

export async function openAgent(attachments: AgentAttachment[] = [], draft = "") {
  getAgentHost().emit("launcher:open-agent")
  if (attachments.length || draft) await newAgentChat(attachments, draft)
  else await initializeAgent()
}
export function openAgentWithLog(content: string, name = "latest.log") {
  return openAgent([{ id: id(), kind: "file", name, content }], translate("analyzeLogPrompt"))
}
export function getAgentState() { return state }
export function subscribeAgentState(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
