import { ipcMain, safeStorage } from "electron"
import { dbHelpers } from "../db"
import { sendToRenderer, getMainWindow } from "./runtime"

export type AiAnalysisResult = {
  success: boolean
  analysis?: string
  error?: string
}

export type AiConfig = { apiKey: string; endpoint: string; model: string }

const AI_KEY_PREFIX = "encrypted:"

function decryptApiKey(value: string | undefined): string {
  if (!value) return ""
  if (!value.startsWith(AI_KEY_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(AI_KEY_PREFIX.length), "base64"))
  } catch {
    return ""
  }
}

function encryptApiKey(value: string): string {
  if (!value) return ""
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Безопасное хранилище операционной системы недоступно")
  }
  return `${AI_KEY_PREFIX}${safeStorage.encryptString(value).toString("base64")}`
}

const LANG_MAP: Record<string, string> = {
  ru: "Russian", en: "English", uk: "Ukrainian", de: "German", fr: "French",
  es: "Spanish", pt: "Portuguese", zh: "Chinese", ja: "Japanese", ko: "Korean",
  tr: "Turkish", it: "Italian", pl: "Polish", nl: "Dutch", ar: "Arabic",
}

const SYSTEM_PROMPT = `You are Xneon AI — a helpful assistant built into the Xneon Minecraft launcher. You help players with:
- Minecraft modding, troubleshooting, and gameplay questions
- Mod recommendations and compatibility advice
- Launcher features and usage tips
- General gaming questions

Rules:
1. Always respond in the same language as the user's message.
2. Be concise and helpful — prefer short, actionable answers.
3. For crash/log analysis: identify root cause, name specific mods if involved, suggest fixes.
4. You can discuss any topic, not just Minecraft — you are a general-purpose assistant.
5. Keep responses under 1000 characters when possible.
6. Use markdown formatting for code blocks and lists when appropriate.`

const CRASH_ANALYSIS_PROMPT = `You are a Minecraft crash/log analysis expert. Analyze the provided game log and give a concise, actionable diagnosis.

Rules:
1. Identify the root cause of the crash/error.
2. If it's a mod conflict or incompatibility, name the specific mod(s).
3. If it's an OutOfMemoryError, suggest increasing RAM allocation.
4. If it's a missing dependency, name the required mod/library.
5. If it's a version mismatch (mod loaded for wrong MC version), identify it.
6. Provide a brief fix recommendation in 1-3 sentences.
7. Respond in the same language as the log content.
8. Keep the response under 500 characters.

Log content:
`

function truncateLog(content: string, maxChars = 8000): string {
  if (content.length <= maxChars) return content
  const lines = content.split("\n")
  const errLines: string[] = []
  const tailLines: string[] = []
  let collecting = false

  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes("error") || lower.includes("exception") || lower.includes("crash") || lower.includes("fatal") || lower.includes("caused by")) {
      collecting = true
    }
    if (collecting) errLines.push(line)
  }

  const tailStart = Math.max(0, lines.length - 200)
  for (let i = tailStart; i < lines.length; i++) tailLines.push(lines[i])

  const combined = [...errLines.slice(-200), "---", ...tailLines.slice(-100)]
  const result = combined.join("\n")
  return result.length > maxChars ? result.slice(-maxChars) : result
}

async function getApiConfig() {
  const storedApiKey = await dbHelpers.getSetting("aiApiKey")
  const apiKey = decryptApiKey(storedApiKey)
  const endpoint = await dbHelpers.getSetting("aiEndpoint")
  const model = await dbHelpers.getSetting("aiModel")
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: (endpoint || "https://api.openai.com/v1").replace(/\/+$/, ""),
    modelId: model || "gpt-4o-mini",
  }
}

function buildSystemPrompt(language?: string) {
  const langHint = language ? LANG_MAP[language] : undefined
  return langHint ? `${SYSTEM_PROMPT}\n\nIMPORTANT: Respond in ${langHint} language.` : SYSTEM_PROMPT
}

export type AiModelsResult = { success: boolean; models?: string[]; error?: string }

/**
 * Список моделей провайдера через OpenAI-совместимый `GET /models`.
 *
 * Формат ответа у разных провайдеров/прокси отличается (`data[].id`,
 * `models[].id`, `models[].name`), поэтому разбираем все известные варианты
 * и дополнительно умеем вытаскивать идентификаторы из плоского массива строк.
 */
export async function fetchAiModels(apiKey: string, endpoint: string): Promise<AiModelsResult> {
  const baseUrl = endpoint.replace(/\/+$/, "")
  if (!baseUrl) return { success: false, error: "Endpoint is empty" }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { success: false, error: `API error ${res.status}: ${body.slice(0, 300)}` }
    }

    const payload = await res.json() as unknown
    const ids = collectModelIds(payload)
    if (ids.length === 0) {
      return { success: false, error: "No models returned by the endpoint" }
    }
    return { success: true, models: ids }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Failed to fetch models: ${message}` }
  }
}

function collectModelIds(payload: unknown): string[] {
  const found = new Set<string>()

  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) found.add(value.trim())
  }

  const visitEntry = (entry: unknown) => {
    if (typeof entry === "string") {
      push(entry)
      return
    }
    if (!entry || typeof entry !== "object") return
    const record = entry as Record<string, unknown>
    // `id` — OpenAI/Ollama, `name`/`model`/`slug` — прочие совместимые прокси.
    push(record.id ?? record.name ?? record.model ?? record.slug)
  }

  if (Array.isArray(payload)) {
    payload.forEach(visitEntry)
    return [...found].sort((a, b) => a.localeCompare(b))
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    for (const key of ["data", "models", "result", "items"]) {
      const value = record[key]
      if (Array.isArray(value)) value.forEach(visitEntry)
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b))
}

// Non-streaming API call
async function callAiApi(
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens?: number; temperature?: number; language?: string } = {},
): Promise<{ success: boolean; analysis?: string; error?: string }> {
  const config = await getApiConfig()
  if (!config) return { success: false, error: "AI API key not configured. Go to Settings → AI." }

  const fullMessages = [
    { role: "system", content: buildSystemPrompt(opts.language) },
    ...messages,
  ]

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.modelId,
        messages: fullMessages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { success: false, error: `API error ${res.status}: ${body.slice(0, 300)}` }
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const analysis = data.choices?.[0]?.message?.content?.trim()
    if (!analysis) return { success: false, error: "Empty response from AI model." }
    return { success: true, analysis }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `AI request failed: ${message}` }
  }
}

// ── Streaming API call (SSE) ────────────────────────────────
// Sends chunks to renderer via ai:stream-chunk / ai:stream-done / ai:stream-error.
// Returns the accumulated full text for storage.
async function callAiApiStream(
  requestId: string,
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens?: number; temperature?: number; language?: string } = {},
): Promise<{ success: boolean; fullText?: string; error?: string }> {
  const config = await getApiConfig()
  if (!config) return { success: false, error: "AI API key not configured. Go to Settings → AI." }

  const fullMessages = [
    { role: "system", content: buildSystemPrompt(opts.language) },
    ...messages,
  ]

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.modelId,
        messages: fullMessages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        stream: true,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      const error = `API error ${res.status}: ${body.slice(0, 300)}`
      sendToRenderer("ai:stream-error", { requestId, error })
      return { success: false, error }
    }

    if (!res.body) {
      const error = "Response body is null — streaming not supported by this endpoint."
      sendToRenderer("ai:stream-error", { requestId, error })
      return { success: false, error }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let fullText = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith("data:")) continue
        const data = trimmed.slice(5).trim()
        if (data === "[DONE]") {
          sendToRenderer("ai:stream-done", { requestId, fullText })
          return { success: true, fullText }
        }
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            sendToRenderer("ai:stream-chunk", { requestId, content: delta })
          }
        } catch {
          // ignore unparseable SSE lines
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim().startsWith("data:")) {
      const data = buffer.trim().slice(5).trim()
      if (data === "[DONE]") {
        sendToRenderer("ai:stream-done", { requestId, fullText })
        return { success: true, fullText }
      }
    }

    sendToRenderer("ai:stream-done", { requestId, fullText })
    return { success: true, fullText }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `AI request failed: ${message}`
    sendToRenderer("ai:stream-error", { requestId, error })
    return { success: false, error }
  }
}

export function registerAiAgent(): void {
  ipcMain.handle("ai:get-config", async (): Promise<AiConfig> => ({
    apiKey: decryptApiKey(await dbHelpers.getSetting("aiApiKey")),
    endpoint: await dbHelpers.getSetting("aiEndpoint") || "https://api.openai.com/v1",
    model: await dbHelpers.getSetting("aiModel") || "gpt-4o-mini",
  }))

  ipcMain.handle("ai:save-config", async (_event, config: AiConfig): Promise<void> => {
    await dbHelpers.setSetting("aiApiKey", encryptApiKey(config.apiKey.trim()))
    await dbHelpers.setSetting("aiEndpoint", config.endpoint.trim())
    await dbHelpers.setSetting("aiModel", config.model.trim())
  })

  // ── Model discovery ─────────────────────────────────────
  // Значения из формы имеют приоритет над сохранёнными: список моделей нужно
  // получать для того endpoint/ключа, которые пользователь ввёл прямо сейчас.
  ipcMain.handle("ai:list-models", async (_event, override?: { apiKey?: string; endpoint?: string }): Promise<AiModelsResult> => {
    const stored = await getApiConfig()
    const apiKey = override?.apiKey?.trim() || stored?.apiKey || ""
    const endpoint = (override?.endpoint?.trim() || stored?.baseUrl || "https://api.openai.com/v1")

    if (!apiKey) {
      return { success: false, error: "AI API key not configured. Go to Settings → AI." }
    }

    return fetchAiModels(apiKey, endpoint)
  })

  // ── Crash Analysis ───────────────────────────────────────
  ipcMain.handle("ai:analyze-crash", async (_event, logContent: string, _requestedSessionId?: string): Promise<AiAnalysisResult> => {
    const truncated = truncateLog(logContent)
    const prompt = CRASH_ANALYSIS_PROMPT + truncated
    const language = await dbHelpers.getSetting("language") || "ru"

    return callAiApi([{ role: "user", content: prompt }], { maxTokens: 512, temperature: 0.3, language })
  })

  // ── Crash Analysis (streaming) ──────────────────────────
  ipcMain.handle("ai:analyze-crash-stream", async (_event, requestId: string, logContent: string): Promise<AiAnalysisResult> => {
    const truncated = truncateLog(logContent)
    const prompt = CRASH_ANALYSIS_PROMPT + truncated
    const language = await dbHelpers.getSetting("language") || "ru"

    return callAiApiStream(requestId, [{ role: "user", content: prompt }], { maxTokens: 512, temperature: 0.3, language })
  })

  // ── Chat Send Message ───────────────────────────────────
  ipcMain.handle("ai:chat-send", async (_event, sessionId: string, userMessage: string): Promise<AiAnalysisResult> => {
    try {
      const userMsgId = crypto.randomUUID()
      await dbHelpers.aiAddMessage(userMsgId, sessionId, "user", userMessage)

      const history = await dbHelpers.aiListMessages(sessionId)
      const chatMessages = history.map((m) => ({ role: m.role, content: m.content }))

      const language = await dbHelpers.getSetting("language") || "ru"
      const result = await callAiApi(chatMessages, { language })

      if (result.success && result.analysis) {
        const assistantMsgId = crypto.randomUUID()
        await dbHelpers.aiAddMessage(assistantMsgId, sessionId, "assistant", result.analysis)
        return { success: true, analysis: result.analysis }
      }

      return { success: false, error: result.error }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Chat error: ${message}` }
    }
  })

  // ── Chat Send Message (streaming) ──────────────────────
  ipcMain.handle("ai:chat-send-stream", async (_event, requestId: string, sessionId: string, userMessage: string): Promise<AiAnalysisResult> => {
    try {
      const userMsgId = crypto.randomUUID()
      await dbHelpers.aiAddMessage(userMsgId, sessionId, "user", userMessage)

      const history = await dbHelpers.aiListMessages(sessionId)
      const chatMessages = history.map((m) => ({ role: m.role, content: m.content }))

      const language = await dbHelpers.getSetting("language") || "ru"
      const result = await callAiApiStream(requestId, chatMessages, { language })

      if (result.success && result.fullText) {
        const assistantMsgId = crypto.randomUUID()
        await dbHelpers.aiAddMessage(assistantMsgId, sessionId, "assistant", result.fullText)
        return { success: true, analysis: result.fullText }
      }

      return { success: false, error: result.error }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Chat error: ${message}` }
    }
  })

  // ── Sessions CRUD ───────────────────────────────────────
  ipcMain.handle("ai:sessions-list", async () => dbHelpers.aiListSessions())
  ipcMain.handle("ai:sessions-create", async (_event, id: string, title: string) => dbHelpers.aiCreateSession(id, title))
  ipcMain.handle("ai:sessions-rename", async (_event, id: string, title: string) => dbHelpers.aiRenameSession(id, title))
  ipcMain.handle("ai:sessions-delete", async (_event, id: string) => dbHelpers.aiDeleteSession(id))
  ipcMain.handle("ai:messages-list", async (_event, sessionId: string) => dbHelpers.aiListMessages(sessionId))
}
