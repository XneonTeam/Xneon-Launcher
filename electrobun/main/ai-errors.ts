export class AiProviderError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

async function providerErrorCode(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let body = ""
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) return
      body += decoder.decode(value, { stream: true })
    }
    const { error } = JSON.parse(body + decoder.decode())
    return typeof error?.code === "string" ? error.code : undefined
  } catch {
    return undefined
  } finally {
    void reader.cancel().catch(() => {})
  }
}

export async function assertAiResponse(response: Response): Promise<void> {
  if (response.ok) return
  // Данные ошибки поставщика могут содержать секреты и содержимое запроса.
  const status = response.status
  const code = status === 400 || status === 429 ? await providerErrorCode(response) : undefined
  if (!response.bodyUsed) void response.body?.cancel().catch(() => {})
  if (status === 401 || status === 403) throw new AiProviderError("authentication", "AI provider rejected authentication or access.")
  if (status === 402 || code === "insufficient_quota") throw new AiProviderError("quota", "AI provider requires payment or additional quota.")
  if (status === 404) throw new AiProviderError("model", "AI endpoint or model was not found.")
  if (status === 408 || status === 504) throw new AiProviderError("timeout", "AI provider request timed out.")
  if (status === 413 || code === "context_length_exceeded") throw new AiProviderError("context", "AI provider request exceeds the context length limit.")
  if (status === 429) throw new AiProviderError("rate-limit", "AI provider rate limit or quota was reached.")
  if (status >= 500) throw new AiProviderError("outage", "AI provider is temporarily unavailable.")
  if (status >= 300 && status < 400) throw new AiProviderError("redirect", "AI endpoint redirected the request. Configure the final endpoint.")
  throw new AiProviderError("request", "AI provider rejected the request (HTTP " + status + ").")
}

export function aiFailure(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
    return new AiProviderError("timeout", "AI provider request was cancelled or timed out.")
  }
  if (error instanceof SyntaxError) return new AiProviderError("response", "AI provider returned an invalid response.")
  return new AiProviderError("connection", "AI provider connection or response failed. Check the endpoint and network.")
}
