import { ipcMain, safeStorage } from "electron"
import { dbHelpers } from "../db"

export type AiAnalysisResult = {
  success: boolean
  analysis?: string
  error?: string
}

export type AiStreamChunk = { sessionId: string; delta?: string; done?: boolean }
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

// Non-streaming API call
async function callAiApi(
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens?: number; temperature?: number; language?: string } = {},
): Promise<{ success: boolean; content?: string; error?: string }> {
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
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return { success: false, error: "Empty response from AI model." }
    return { success: true, content }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `AI request failed: ${message}` }
  }
}

// Streaming API call — sends chunks via IPC events
async function streamAiApi(
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  webContents: Electron.WebContents,
  opts: { maxTokens?: number; temperature?: number; language?: string } = {},
): Promise<{ success: boolean; content?: string; error?: string }> {
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
      webContents.send("ai:stream-chunk", { sessionId, delta: `⚠️ ${error}`, done: true })
      return { success: false, error }
    }

    const reader = res.body?.getReader()
    if (!reader) return { success: false, error: "No response body" }

    const decoder = new TextDecoder()
    let buffer = ""
    let fullContent = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith("data: ")) continue
        const data = trimmed.slice(6)
        if (data === "[DONE]") continue

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullContent += delta
            webContents.send("ai:stream-chunk", { sessionId, delta })
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    webContents.send("ai:stream-chunk", { sessionId, done: true })
    return { success: true, content: fullContent }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const error = `AI request failed: ${message}`
    webContents.send("ai:stream-chunk", { sessionId, delta: `⚠️ ${error}`, done: true })
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

  // ── Crash Analysis (streaming) ──────────────────────────
  ipcMain.handle("ai:analyze-crash", async (event, logContent: string, requestedSessionId?: string): Promise<AiAnalysisResult> => {
    const truncated = truncateLog(logContent)
    const prompt = CRASH_ANALYSIS_PROMPT + truncated
    const sessionId = requestedSessionId || crypto.randomUUID()
    const language = await dbHelpers.getSetting("language") || "ru"

    return streamAiApi(
      sessionId,
      [{ role: "user", content: prompt }],
      event.sender,
      { maxTokens: 512, temperature: 0.3, language },
    )
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

      if (result.success && result.content) {
        const assistantMsgId = crypto.randomUUID()
        await dbHelpers.aiAddMessage(assistantMsgId, sessionId, "assistant", result.content)
        return { success: true, analysis: result.content }
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
