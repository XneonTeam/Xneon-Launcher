import type { AiProtocol, AgentWireMessage, AgentToolSpec, AgentTurnResult } from "@xnlc/types"

type Json = Record<string, any>
export interface ProviderConfig { apiKey: string; baseUrl: string; modelId: string; protocol?: AiProtocol }
export function validateProviderKey(config: ProviderConfig): void {
  if (config.protocol === "ollama" || !config.apiKey) return
  if (config.apiKey.length > 4096 || /[^\x21-\x7e]/.test(config.apiKey)) {
    throw new Error("API key must contain only visible ASCII characters. Re-enter the key in AI settings.")
  }
}
export function providerHeaders(config: ProviderConfig): Record<string, string> {
  const common = { "Content-Type": "application/json" }
  if (config.protocol === "anthropic") return { ...common, "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
  if (config.protocol === "gemini") return { ...common, "x-goog-api-key": config.apiKey }
  return { ...common, ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }
}
function imageData(url: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (!match) throw new Error("Invalid image attachment")
  return { mimeType: match[1], data: match[2] }
}
export function providerRequest(config: ProviderConfig, system: string, messages: AgentWireMessage[], tools: AgentToolSpec[], options: { cache?: boolean; maxOutputTokens?: number } = {}) {
  const base = config.baseUrl.replace(/\/+$/, "")
  const model = config.modelId.replace(/^models\//, "")
  const maxTokens = Number.isFinite(options.maxOutputTokens) ? Math.max(256, Math.min(4096, Math.floor(options.maxOutputTokens!))) : 4096
  if (config.protocol === "anthropic") {
    const history: Json[] = []
    for (const message of messages) {
      const role = message.role === "assistant" ? "assistant" : "user"
      const content: Json[] = message.role === "tool" ? [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content || "" }] : [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...(message.images || []).map(url => { const image = imageData(url); return { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } } }),
        ...(message.tool_calls || []).map(call => ({ type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) }))
      ]
      if (!content.length) continue
      if (history.at(-1)?.role === role) history.at(-1)!.content.push(...content)
      else history.push({ role, content })
    }
    const cache = options.cache !== false ? { type: "ephemeral" as const } : undefined
    const last = history.at(-1)
    if (cache && last?.role === "user" && last.content.length) last.content.at(-1).cache_control = cache
    return { url: `${base}/messages`, body: { model, system: cache ? [{ type: "text", text: system, cache_control: cache }] : system, messages: history, max_tokens: maxTokens, tools: tools.map((tool, index) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters, ...(cache && index === tools.length - 1 ? { cache_control: cache } : {}) })) } }
  }
  if (config.protocol === "gemini") {
    const calls = new Map(messages.flatMap(message => (message.tool_calls || []).map(call => [call.id, call.function.name] as const)))
    const originalIds = new Set(messages.flatMap(message => (message.providerParts || []) as Json[]).flatMap(part => part.functionCall?.id ? [part.functionCall.id] : []))
    const contents: Json[] = []
    for (const message of messages) {
      const role = message.role === "assistant" ? "model" : "user"
      const parts: Json[] = message.role === "tool" ? [{ functionResponse: { ...(originalIds.has(message.tool_call_id) ? { id: message.tool_call_id } : {}), name: calls.get(message.tool_call_id || ""), response: { result: message.content || "" } } }] : message.providerParts?.length ? message.providerParts as Json[] : [
        ...(message.content ? [{ text: message.content }] : []),
        ...(message.images || []).map(url => ({ inlineData: imageData(url) })),
        ...(message.tool_calls || []).map(call => ({ functionCall: { id: call.id, name: call.function.name, args: JSON.parse(call.function.arguments) } }))
      ]
      if (!parts.length) continue
      if (contents.at(-1)?.role === role) contents.at(-1)!.parts.push(...parts)
      else contents.push({ role, parts })
    }
    return { url: `${base}/models/${encodeURIComponent(model)}:generateContent`, body: { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: maxTokens }, tools: tools.length ? [{ functionDeclarations: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, parametersJsonSchema: tool.function.parameters })) }] : undefined } }
  }
  const toolNames = new Map(messages.flatMap(message => (message.tool_calls || []).map(call => [call.id, call.function.name] as const)))
  if (config.protocol === "ollama") return { url: `${base}/api/chat`, body: { model, stream: false, messages: [{ role: "system", content: system }, ...messages.map(({ images, providerParts: _parts, ...message }) => ({ ...message, content: message.content || "", ...(message.role === "tool" ? { tool_name: toolNames.get(message.tool_call_id || "") } : {}), ...(images?.length ? { images: images.map(url => imageData(url).data) } : {}), ...(message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({ ...call, function: { ...call.function, arguments: JSON.parse(call.function.arguments) } })) } : {}) }))], tools, options: { num_predict: maxTokens } } }
  return { url: `${base}/chat/completions`, body: { model, messages: [{ role: "system", content: system }, ...messages.map(({ images, providerParts: _parts, ...message }) => ({ ...message, ...(images?.length ? { content: [{ type: "text", text: message.content || "" }, ...images.map(url => ({ type: "image_url", image_url: { url } }))] } : {}) }))], tools, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens } }
}
export function providerResult(protocol: AiProtocol = "openai", data: Json): AgentTurnResult {
  if (protocol === "anthropic") {
    if (data.stop_reason === "max_tokens") throw new Error("AI response exceeded output limit")
    if (!Array.isArray(data.content)) throw new Error("Empty AI response")
    return { text: data.content.filter((p: Json) => p.type === "text").map((p: Json) => p.text).join("\n"), calls: data.content.filter((p: Json) => p.type === "tool_use").map((p: Json) => ({ id: p.id, type: "function", function: { name: p.name, arguments: JSON.stringify(p.input) } })), usage: { prompt_tokens: data.usage ? (data.usage.input_tokens || 0) + (data.usage.cache_creation_input_tokens || 0) + (data.usage.cache_read_input_tokens || 0) : undefined, completion_tokens: data.usage?.output_tokens } }
  }
  if (protocol === "gemini") {
    const candidate = data.candidates?.[0]
    if (!candidate?.content?.parts || (candidate.finishReason && candidate.finishReason !== "STOP")) throw new Error("Empty or incomplete AI response")
    const parts: Json[] = candidate.content.parts
    return { text: parts.filter(p => p.text && !p.thought).map(p => p.text).join("\n"), calls: parts.filter(p => p.functionCall).map(p => ({ id: p.functionCall.id || crypto.randomUUID(), type: "function", function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } })), providerParts: parts, usage: { prompt_tokens: data.usageMetadata?.promptTokenCount, completion_tokens: data.usageMetadata?.candidatesTokenCount, total_tokens: data.usageMetadata?.totalTokenCount } }
  }
  if (protocol === "ollama") {
    if (!data.message || data.done_reason === "length") throw new Error("Empty or incomplete AI response")
    return { text: data.message.content || "", calls: (data.message.tool_calls || []).map((call: Json) => ({ id: call.id || crypto.randomUUID(), type: "function", function: { name: call.function.name, arguments: JSON.stringify(call.function.arguments || {}) } })), usage: { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count } }
  }
  const choice = data.choices?.[0]
  if (!choice || choice.finish_reason === "length") throw new Error("Empty or incomplete AI response")
  if (!choice.message?.content && !choice.message?.tool_calls?.length) throw new Error("AI returned an empty response. Check the selected model and API endpoint.")
  return { text: choice.message.content || "", calls: choice.message.tool_calls || [], usage: data.usage }
}
