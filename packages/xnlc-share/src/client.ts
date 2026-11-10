import type { Repository, RepositoryCommand, ShareTransport } from "./types.js"
import { ShareError } from "./types.js"
import { readBounded, type FetchPort } from "./sources.js"
import { MAX_FILE_BYTES, fail } from "./manifest.js"

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
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.token()}` }
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
    const response = await this.fetcher(this.base + "/v1" + path, init)
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
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
