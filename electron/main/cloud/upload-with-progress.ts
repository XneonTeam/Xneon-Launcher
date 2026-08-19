import http from "http"
import https from "https"
import { createReadStream } from "fs"
import { stat } from "fs/promises"

export type ProgressCallback = (percent: number) => void

export interface UploadWithProgressOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  filePath: string
  onProgress?: ProgressCallback
}

export interface UploadWithProgressResult {
  ok: boolean
  status: number
  json?: unknown
  text?: string
}

/**
 * Streaming upload of a local file to an HTTP(S) endpoint with
 * byte-based progress reporting via onProgress(percent).
 */
export async function uploadWithProgress(options: UploadWithProgressOptions): Promise<UploadWithProgressResult> {
  const { url, method = "PUT", headers, filePath, onProgress } = options
  const fileSize = (await stat(filePath)).size
  const u = new URL(url)
  const isHttps = u.protocol === "https:"
  const mod = isHttps ? https : http

  return new Promise((resolve, reject) => {
    const req = mod.request(u, {
      method,
      headers: {
        ...headers,
        "Content-Length": String(fileSize),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8")
        let json: unknown
        try { json = JSON.parse(body) } catch { /* not json */ }
        resolve({ ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode ?? 0, json, text: body })
      })
    })
    req.on("error", reject)

    let sent = 0
    const stream = createReadStream(filePath)
    stream.on("data", (chunk: Buffer) => {
      sent += chunk.length
      if (onProgress && fileSize > 0) {
        onProgress(Math.min(100, Math.round((sent / fileSize) * 100)))
      }
    })
    stream.on("end", () => {
      req.end()
    })
    stream.on("error", (err) => {
      req.destroy(err)
      reject(err)
    })
    stream.pipe(req, { end: false })
  })
}