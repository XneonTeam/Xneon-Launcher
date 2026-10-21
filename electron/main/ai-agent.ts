import { ipcMain, safeStorage } from "electron"
import { dbHelpers } from "../db"
import { sendToRenderer } from "./runtime"
import { registerAgentWorkspace } from "./agent-workspace"

export type AiAnalysisResult = {
  success: boolean
  analysis?: string
  error?: string
}

import type { AiConfig, AiProtocol, AiModelDiscovery } from "@xnlc/types"
import { providerHeaders, providerRequest, providerResult, validateProviderKey } from "./ai-providers"
import { validateModelConfigs, readModelConfigs } from "./ai-model-config"
export type { AiConfig } from "@xnlc/types"

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

const SYSTEM_PROMPT = `You are Xneon AI — a helpful assistant built into the Xneon Launcher (Xneon Team). You help players with:
- Minecraft modding, troubleshooting, and gameplay questions
- Mod recommendations and compatibility advice
- Xneon Launcher features and usage tips
- General gaming questions

Rules:
1. Always respond in the same language as the user's message.
2. Be concise and helpful — prefer short, actionable answers.
3. You always speak in the context of Xneon Launcher: the user launches the game, builds and servers through it. Give advice in terms of its UI (builds → mods/resourcepacks/shaders tabs, build settings → Java/memory/launch commands, launcher settings → game/Java/themes, servers section, logs page with crash analysis).
4. Never recommend installing, switching to or using another launcher (Prism, MultiMC/PolyMC, CurseForge App, Modrinth App, ATLauncher, GDLauncher, Technic, HMCL and any others). If a problem is on the launcher's side, say it is a Xneon Launcher issue and how to report it — do not offer a different launcher as a workaround.
5. If the cause is in Xneon Launcher itself (launch failure, missing library, wrong Java, loader profile, import bug), say so directly and ask the user to open an issue: https://github.com/XneonTeam/Xneon-Launcher/issues — attaching the log from the "Logs" page, the build name, Minecraft version and loader version.
6. Do not invent launcher features or menu items. If you are not sure how something works in the launcher, say so honestly and suggest checking the "Logs" page or asking the team.
7. For crash/log analysis: identify root cause, name specific mods if involved, suggest fixes in the launcher's terms.
8. You can discuss any topic, not just Minecraft — you are a general-purpose assistant.
9. Keep responses under 1000 characters when possible.
10. Use markdown formatting for code blocks and lists when appropriate.`

const ISSUES_URL = "https://github.com/XneonTeam/Xneon-Launcher/issues"

const CRASH_ANALYSIS_PROMPT = `You are a Minecraft crash/log analysis expert working inside the Xneon Launcher. Analyze the provided game log and give a concise, actionable diagnosis.

Context: the player runs this game through Xneon Launcher (Xneon Team). The launcher installs the loader, Java runtime, libraries and content by itself.

Rules:
1. Identify the root cause of the crash/error.
2. If it's a mod conflict or incompatibility, name the specific mod(s).
3. If it's an OutOfMemoryError, suggest increasing RAM in the build settings of Xneon Launcher.
4. If it's a missing dependency, name the required mod/library.
5. If it's a version mismatch (mod loaded for wrong MC version, wrong Java version), identify it and say which version is needed.
6. Never suggest installing or switching to another launcher (Prism, MultiMC/PolyMC, CurseForge App, Modrinth App, ATLauncher, GDLauncher, Technic, HMCL and others) — not as a fix and not as a workaround.
7. If the failure is the launcher's fault (missing library in the launch classpath, broken loader profile, wrong Java selected, failed import), say plainly that it looks like a Xneon Launcher issue and ask the user to report it at ${ISSUES_URL} with the log from the "Logs" page, the build name, Minecraft version and loader version.
8. If the crash is caused by the modpack itself (broken pack, mod bug, pack requires a different loader version), say that it is not a launcher problem.
9. Give a brief fix recommendation in 1-3 sentences.
10. Respond in the same language as the log content.
11. Keep the response under 500 characters.

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

export async function getApiConfig() {
  const storedApiKey = await dbHelpers.getSetting("aiApiKey")
  const apiKey = decryptApiKey(storedApiKey)
  const endpoint = await dbHelpers.getSetting("aiEndpoint")
  const model = await dbHelpers.getSetting("aiModel")
  const protocol = (await dbHelpers.getSetting("aiProtocol") || "openai") as AiProtocol
  if (!apiKey && protocol !== "ollama" && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(endpoint || "")) return null
  return {
    apiKey,
    baseUrl: (endpoint || "https://api.openai.com/v1").replace(/\/+$/, ""),
    modelId: model || "gpt-4o-mini",
    protocol,
    models: readModelConfigs(await dbHelpers.getSetting("aiModels"), model || "gpt-4o-mini"),
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
export async function fetchAiModels(apiKey: string, endpoint: string, protocol: AiProtocol = "openai"): Promise<AiModelsResult> {
  const baseUrl = endpoint.replace(/\/+$/, "")
  if (!baseUrl) return { success: false, error: "Endpoint is empty" }

  try {
    const base = new URL(baseUrl)
    if (!["http:", "https:"].includes(base.protocol) || (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Use HTTPS for remote AI providers")
    const found = new Set<string>()
    let cursor = ""
    for (let page = 0; page < 30; page++) {
      const url = new URL(baseUrl + "/" + (protocol === "ollama" ? "api/tags" : "models"))
      if (protocol === "gemini") { url.searchParams.set("pageSize", "100"); if (cursor) url.searchParams.set("pageToken", cursor) }
      if (protocol === "anthropic") { url.searchParams.set("limit", "100"); if (cursor) url.searchParams.set("after_id", cursor) }
      const response = await fetch(url, { headers: providerHeaders({ apiKey, baseUrl, modelId: "", protocol }), signal: AbortSignal.timeout(20_000) })
      if (!response.ok) return { success: false, error: "API error " + response.status + ": " + (await response.text()).replaceAll(apiKey || "__NO_API_KEY__", "[REDACTED]").slice(0, 300) }
      const payload = await response.json() as Record<string, unknown>
      collectModelIds(payload).forEach(id => found.add(id))
      const next = protocol === "gemini" ? payload.nextPageToken : protocol === "anthropic" && payload.has_more ? payload.last_id : undefined
      if (typeof next !== "string" || !next || cursor === next) break
      cursor = next
    }
    if (!found.size) return { success: false, error: "No models returned by the endpoint" }
    return { success: true, models: [...found].sort((a, b) => a.localeCompare(b)) }
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

  try {
    const request = providerRequest(config, buildSystemPrompt(opts.language), messages as import("@xnlc/types").AgentWireMessage[], [])
    const body = request.body as Record<string, unknown>
    if (!config.protocol || config.protocol === "openai") { body.stream = false; delete body.stream_options }
    const response = await fetch(request.url, { method: "POST", headers: providerHeaders(config), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error("AI API error " + response.status)
    const result = providerResult(config.protocol, await response.json())
    if (!result.text.trim()) throw new Error("Empty response from AI model")
    return { success: true, analysis: result.text }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
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

  if (config.protocol && config.protocol !== "openai") {
    const result = await callAiApi(messages, opts)
    if (result.success) {
      sendToRenderer("ai:stream-chunk", { requestId, content: result.analysis || "" })
      sendToRenderer("ai:stream-done", { requestId, fullText: result.analysis || "" })
    } else sendToRenderer("ai:stream-error", { requestId, error: result.error })
    return { success: result.success, fullText: result.analysis, error: result.error }
  }
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
  registerAgentWorkspace(getApiConfig)
  ipcMain.handle("ai:get-config", async (): Promise<AiConfig> => {
    const model = await dbHelpers.getSetting("aiModel") || "gpt-4o-mini"
    return { apiKey: decryptApiKey(await dbHelpers.getSetting("aiApiKey")), endpoint: await dbHelpers.getSetting("aiEndpoint") || "https://api.openai.com/v1", model, protocol: (await dbHelpers.getSetting("aiProtocol") || "openai") as AiProtocol, models: readModelConfigs(await dbHelpers.getSetting("aiModels"), model) }
  })
  ipcMain.handle("ai:save-config", async (_event, config: AiConfig): Promise<void> => {
    if (!config || typeof config.apiKey !== "string" || typeof config.endpoint !== "string" || typeof config.model !== "string") throw new Error("Invalid AI configuration")
    const protocol = config.protocol || "openai"
    if (!["openai", "anthropic", "gemini", "ollama"].includes(protocol)) throw new Error("Invalid AI protocol")
    validateProviderKey({ apiKey: config.apiKey.trim(), baseUrl: config.endpoint, modelId: config.model, protocol })
    const url = new URL(config.endpoint)
    if (!["https:", "http:"].includes(url.protocol) || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Use HTTPS for remote AI providers")
    const models = config.models === undefined ? readModelConfigs(await dbHelpers.getSetting("aiModels"), config.model) : validateModelConfigs(config.models)
    if (!models.some(item => item.id === config.model.trim())) throw new Error("Select an enabled model")
    await dbHelpers.setSetting("aiApiKey", encryptApiKey(config.apiKey.trim()))
    await dbHelpers.setSetting("aiEndpoint", config.endpoint.trim().replace(/\/+$/, ""))
    await dbHelpers.setSetting("aiModel", config.model.trim())
    await dbHelpers.setSetting("aiProtocol", protocol)
    await dbHelpers.setSetting("aiModels", JSON.stringify(models))
  })

  // ── Model discovery ─────────────────────────────────────
  // Значения из формы имеют приоритет над сохранёнными: список моделей нужно
  // получать для того endpoint/ключа, которые пользователь ввёл прямо сейчас.
  ipcMain.handle("ai:list-models", async (_event, override?: AiModelDiscovery): Promise<AiModelsResult> => {
    const stored = await getApiConfig()
    const apiKey = override?.apiKey?.trim() ?? stored?.apiKey ?? ""
    const endpoint = override?.endpoint?.trim() ?? stored?.baseUrl ?? "https://api.openai.com/v1"

    const protocol = override?.protocol || stored?.protocol || "openai"
    if (!apiKey && protocol !== "ollama" && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(endpoint)) {
      return { success: false, error: "AI API key not configured. Go to Settings → AI." }
    }

    try { validateProviderKey({ apiKey, baseUrl: endpoint, modelId: "", protocol }) }
    catch { return { success: false, error: "API key contains unsupported characters. Re-enter it in AI settings." } }
    return fetchAiModels(apiKey, endpoint, protocol)
  })

  // ── Crash Analysis ───────────────────────────────────────
  ipcMain.handle("ai:analyze-crash", async (_event, logContent: string): Promise<AiAnalysisResult> => {
    return callAiApi([{ role: "user", content: CRASH_ANALYSIS_PROMPT + truncateLog(logContent) }], { language: await dbHelpers.getSetting("language") || "ru" })
  })

  // ── Crash Analysis (streaming) ──────────────────────────
  ipcMain.handle("ai:analyze-crash-stream", async (_event, requestId: string, logContent: string): Promise<AiAnalysisResult> => {
    const truncated = truncateLog(logContent)
    const prompt = CRASH_ANALYSIS_PROMPT + truncated
    const language = await dbHelpers.getSetting("language") || "ru"

    return callAiApiStream(requestId, [{ role: "user", content: prompt }], { maxTokens: 512, temperature: 0.3, language })
  })

}
