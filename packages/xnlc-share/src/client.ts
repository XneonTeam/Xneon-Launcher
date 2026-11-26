import type { Repository, RepositoryCommand, ShareTransport } from "./types.js"
import { ShareError } from "./types.js"
import { readBounded, type FetchPort } from "./sources.js"
import { MAX_FILE_BYTES, fail } from "./manifest.js"

declare const XNLC_APPLICATION_USER_AGENT: string | undefined
const USER_AGENT = typeof XNLC_APPLICATION_USER_AGENT === "string" ? XNLC_APPLICATION_USER_AGENT : "xnlc-share"

/**
 * Ошибка для ответа, который нельзя прочитать как JSON. Так отвечает
 * Cloudflare challenge (Cf-Mitigated: challenge) и ошибочный шлюз;
 * клиент должен назвать причину, а не падать на JSON.parse.
 */
export function unreadableShareResponse(status: number, mitigated: string | null, body: string): ShareError {
  const challenged = mitigated === "challenge" || ((status === 403 || status === 503) && /^\s*<(!doctype\s+html|html)/i.test(body))
  return challenged
    ? new ShareError("SERVICE_UNAVAILABLE", "Share API refused the launcher client (Cloudflare challenge)")
    : new ShareError("HTTP", `Share API returned an unreadable response (${status})`)
}

export class ShareApiClient implements ShareTransport {
  private base: string
  private signal?: AbortSignal
  constructor(base: string, private token: () => Promise<string>, private fetcher: FetchPort) {
    const url = new URL(base)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) fail("API_URL", "Share API requires HTTPS or loopback")
    if (url.username || url.password || url.search || url.hash) fail("API_URL", "Invalid API base URL")
    this.base = base.replace(/\/$/, "")
  }
  setSignal(signal?: AbortSignal): void { this.signal = signal }
  private async request(path: string, method = "GET", body?: unknown, onUpload?: (transferred: number) => void): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT, Authorization: `Bearer ${await this.token()}` }
    if (body && !(body instanceof Uint8Array)) headers["Content-Type"] = "application/json"
    let requestBody: BodyInit | undefined = body instanceof Uint8Array ? body as BodyInit : body === undefined ? undefined : JSON.stringify(body)
    if (body instanceof Uint8Array && onUpload) {
      let offset = 0
      requestBody = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= body.length) { controller.close(); return }
          const end = Math.min(offset + 64 * 1024, body.length)
          controller.enqueue(body.subarray(offset, end)); offset = end; onUpload(offset)
        },
      })
    }
    const timeout = AbortSignal.timeout(120000)
    const signal = this.signal ? AbortSignal.any([timeout, this.signal]) : timeout
    const init: RequestInit & { duplex?: "half" } = { method, headers, body: requestBody, redirect: "error", signal, ...(onUpload && body instanceof Uint8Array ? { duplex: "half" as const } : {}) }
    let response: Response
    try {
      response = await this.fetcher(this.base + "/v1" + path, init)
    } catch (error) {
      // Отмена по signal остаётся отменой; всё прочее — недоступность сервиса.
      if (error && typeof error === "object" && (error as { name?: string }).name === "AbortError") throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new ShareError("SERVICE_UNAVAILABLE", `Share API is unreachable: ${reason}`)
    }
    if (!response.ok) {
      const text = await response.text()
      let error: { error?: { code?: string; message?: string } } = {}
      try { error = JSON.parse(text) as typeof error } catch {
        throw unreadableShareResponse(response.status, response.headers.get("cf-mitigated"), text)
      }
      throw new ShareError(error.error?.code ?? "HTTP", error.error?.message ?? `Share API returned ${response.status}`)
    }
    return response
  }
  private repository(id: string): string { return `/repositories/${encodeURIComponent(id)}` }
  async create(): Promise<string> { return ((await (await this.request("/repositories", "POST", {})).json()) as { id: string }).id }
  async get(id: string): Promise<Repository> { return (await this.request(this.repository(id))).json() as Promise<Repository> }
  async mutate(id: string, command: RepositoryCommand): Promise<Repository> { return (await this.request(this.repository(id) + "/commands", "POST", command)).json() as Promise<Repository> }
  async hasObject(id: string, hash: string): Promise<boolean> { return ((await (await this.request(this.repository(id) + `/objects/${hash}/exists`)).json()) as { exists: boolean }).exists }
  async upload(id: string, hash: string, bytes: Uint8Array, onProgress?: (transferred: number) => void): Promise<void> {
    const ticket = await (await this.request(this.repository(id) + `/objects/${hash}/ticket`, "POST", { size: bytes.length })).json() as { ticket: string }
    await this.request(this.repository(id) + `/objects/${hash}?ticket=${encodeURIComponent(ticket.ticket)}`, "PUT", bytes, onProgress)
  }
  async download(id: string, hash: string): Promise<Uint8Array> { return readBounded(await this.request(this.repository(id) + `/objects/${hash}`), MAX_FILE_BYTES) }
}
