import type { AgentToolCall, AgentTurnResult } from "@xnlc/types" with { "resolution-mode": "import" }

/** Разбор SSE не зависит от границ сетевых пакетов и сохраняет аргументы инструментов. */
export async function readAgentStream(
  body: ReadableStream<Uint8Array>,
  onText: (delta: string) => void,
): Promise<AgentTurnResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const calls = new Map<number, AgentToolCall>()
  let buffer = "", text = "", size = 0
  let usage: AgentTurnResult["usage"]
  let finished = false
  let finishReason: string | undefined
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return
    const data = line.slice(5).trim()
    if (data === "[DONE]") { finished = true; return }
    if (!data) return
    const event = JSON.parse(data) as {
      error?: { message?: string }
      usage?: AgentTurnResult["usage"]
      choices?: Array<{ finish_reason?: string; delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }> } }>
    }
    if (event.error) throw new Error(event.error.message || "AI stream error")
    if (event.usage) usage = event.usage
    const choice = event.choices?.[0]
    if (choice?.finish_reason) finishReason = choice.finish_reason
    const delta = choice?.delta
    if (delta?.content) { text += delta.content; onText(delta.content) }
    for (const part of delta?.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 63) throw new Error("Invalid tool call index")
      const call = calls.get(part.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } }
      if (part.id) call.id += part.id
      if (part.function?.name) call.function.name += part.function.name
      if (part.function?.arguments) call.function.arguments += part.function.arguments
      calls.set(part.index, call)
    }
  }
  try {
    while (!finished) {
      const chunk = await reader.read()
      if (chunk.done) { buffer += decoder.decode(); break }
      size += chunk.value.byteLength
      if (size > 4_000_000) throw new Error("AI response is too large")
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) { consume(line.replace(/\r$/, "")); if (finished) break }
    }
    if (!finished && buffer.trim()) consume(buffer.trim())
    if (!finished && !finishReason) throw new Error("AI stream ended before completion. Retry the response.")
    if (finishReason === "length") throw new Error("AI response exceeded the output limit. Please narrow the request.")
    const result = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
    if (result.some(call => !call.id || !call.function.name)) throw new Error("Incomplete tool call")
    if (!text.trim() && !result.length) throw new Error("Empty response from AI model")
    return { text, calls: result, usage }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Скрываем секреты в логах, вложениях и результатах инструментов перед отправкой. */
export function redactAgentText(text: string): string {
  return text
    .replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/(--accessToken\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/[A-Z]:[\\/]Users[\\/][^\\/\s]+/gi, "<USER_HOME>")
    .replace(/\/(?:home|Users)\/[^/\s]+/g, "<USER_HOME>")
}
