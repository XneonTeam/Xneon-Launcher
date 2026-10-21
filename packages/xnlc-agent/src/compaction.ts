import type { AgentWireMessage } from "@xnlc/types"

/** Разделяем только после завершённых пакетов инструментов; вызов и результат не разрываются. */
export function prepareAgentCompaction(messages: AgentWireMessage[], contextWindow: number, estimate: (messages: AgentWireMessage[]) => number) {
  if (messages.length < 2) return undefined
  const keepTokens = Math.min(20_000, Math.floor(contextWindow / 4))
  const suffix = new Array<number>(messages.length + 1).fill(0)
  for (let index = messages.length - 1; index >= 0; index--) suffix[index] = suffix[index + 1] + estimate([messages[index]])
  const pending = new Set<string>()
  const boundaries: number[] = []
  for (let index = 0; index < messages.length - 1; index++) {
    for (const call of messages[index].tool_calls || []) pending.add(call.id)
    if (messages[index].role === "tool") pending.delete(messages[index].tool_call_id || "")
    if (!pending.size && messages[index + 1].role !== "tool") boundaries.push(index + 1)
  }
  const minimumCut = Math.max(1, messages.length - 200)
  const recentUser = boundaries.filter(index => messages[index].role === "user").at(-1)
  const cut = suffix[0] <= keepTokens && recentUser ? recentUser : boundaries.find(index => index >= minimumCut && suffix[index] <= keepTokens) ?? boundaries.at(-1)
  if (!cut) return undefined
  const previous = messages.slice(0, cut)
  const kept = messages.slice(cut)
  // Ограничиваем и аварийный oversized-ввод; длинное сообщение сохраняет начало и конец с явной отметкой.
  const limit = Math.max(4096, Math.floor((contextWindow - 6500) * 3))
  const perMessage = Math.max(32, Math.floor(limit / previous.length) - 32)
  const clip = (text: string) => {
    if (text.length <= perMessage) return text
    const marker = "\n[Середина исключена]\n"
    const half = Math.max(1, Math.floor((perMessage - marker.length) / 2))
    return `${text.slice(0, half)}${marker}${text.slice(-half)}`
  }
  const transcript = previous.map((message, index) => `[${index}:${message.role}]\n${clip([message.content || "", ...(message.tool_calls || []).map(call => JSON.stringify(call)), ...(message.images?.length ? [`[Изображений: ${message.images.length}; содержимое не пересказывается без данных]`] : [])].join("\n"))}`).join("\n\n")
  return { kept, transcript, removed: cut }
}

export function agentCompactionThreshold(contextWindow: number) {
  return contextWindow - Math.min(16_384, Math.floor(contextWindow * 0.2))
}

export function isAgentContextOverflow(error: unknown) {
  return /context[_ -]?(?:length[_ -])?exceeded|maximum context|context (?:window|length).{0,50}(?:exceed|limit|long)|too many (?:input )?tokens|prompt.{0,40}(?:too long|exceeds)|input.{0,30}token.{0,30}limit/i.test(String(error))
}
