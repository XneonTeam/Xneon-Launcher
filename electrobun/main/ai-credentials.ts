import type { AiProtocol } from "@xnlc/types"
import { AI_ENDPOINTS } from "@xnlc/urls"

export const DEFAULT_AI_ENDPOINT = AI_ENDPOINTS.openai

export function aiEndpoint(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error("Invalid AI endpoint") }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Use HTTPS for remote AI providers")
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid AI endpoint")
  return url.href.replace(/\/+$/, "")
}

export function usesStoredAiKey(endpoint: string, protocol: AiProtocol, savedEndpoint: string, savedProtocol: AiProtocol): boolean {
  try { return protocol === savedProtocol && aiEndpoint(endpoint) === aiEndpoint(savedEndpoint) }
  catch { return false }
}
