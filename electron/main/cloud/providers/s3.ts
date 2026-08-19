import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import type { CloudProvider, CloudAuthResult, CloudFileListResult, CloudUploadResult, CloudDownloadResult, CloudStorageQuota, CloudFileInfo } from "../provider"
import { dbHelpers } from "../../../db"
import { fetchWithRetry } from "@xnlc/core/retry"

const BASE_PREFIX = "xneon-launcher/"

type S3Config = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  forcePathStyle: boolean
}

let cachedConfig: S3Config | null = null

async function readConfig(): Promise<S3Config | null> {
  if (cachedConfig) return cachedConfig
  try {
    const raw = await dbHelpers.getCloudConfig("s3")
    if (raw) { cachedConfig = JSON.parse(raw) as S3Config; return cachedConfig }
  } catch { /* noop */ }
  return null
}

async function writeConfig(config: S3Config): Promise<void> {
  await dbHelpers.setCloudConfig("s3", JSON.stringify(config))
  cachedConfig = config
}

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest()
}

function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex")
}

function getSignatureHeaders(
  config: S3Config,
  method: string,
  url: string,
  headers: Record<string, string>,
  payloadHash: string,
): Record<string, string> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const dateStamp = amzDate.slice(0, 8)

  const parsedUrl = new URL(url)
  const host = parsedUrl.host
  const canonicalUri = parsedUrl.pathname || "/"
  const canonicalQueryString = parsedUrl.searchParams.toString().split("&").sort().join("&")

  const signedHeadersList = Object.keys({ host, ...headers, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash }).sort()
  const canonicalHeaders = signedHeadersList.map(h => {
    const val = h === "host" ? host : h === "x-amz-date" ? amzDate : h === "x-amz-content-sha256" ? payloadHash : (headers[h] ?? "")
    return `${h}:${val}\n`
  }).join("")

  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeadersList.join(";"), payloadHash].join("\n")
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [`AWS4-HMAC-SHA256`, amzDate, credentialScope, sha256(canonicalRequest)].join("\n")

  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, config.region)
  const kService = hmac(kRegion, "s3")
  const kSigning = hmac(kService, "aws4_request")
  const signature = hmac(kSigning, stringToSign).toString("hex")

  const authHeader = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList.join(";")}, Signature=${signature}`

  return {
    Host: host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authHeader,
  }
}

function s3Url(config: S3Config, key: string): string {
  const endpoint = config.endpoint.replace(/\/+$/, "")
  if (config.forcePathStyle) {
    return `${endpoint}/${config.bucket}/${key}`
  }
  const baseUrl = new URL(endpoint)
  baseUrl.hostname = `${config.bucket}.${baseUrl.hostname}`
  return `${baseUrl.origin}/${key}`
}

function s3ListUrl(config: S3Config, prefix: string, continuationToken?: string): string {
  const endpoint = config.endpoint.replace(/\/+$/, "")
  let base: string
  if (config.forcePathStyle) {
    base = `${endpoint}/${config.bucket}`
  } else {
    const baseUrl = new URL(endpoint)
    baseUrl.hostname = `${config.bucket}.${baseUrl.hostname}`
    base = baseUrl.origin
  }
  const params = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" })
  if (continuationToken) params.set("continuation-token", continuationToken)
  return `${base}?${params.toString()}`
}

async function s3Request(config: S3Config, method: string, url: string, body?: Buffer, onProgress?: (percent: number) => void): Promise<Response> {
  const payloadHash = body ? sha256(body) : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  const authHeaders = getSignatureHeaders(config, method, url, {}, payloadHash)

  const headers: Record<string, string> = { ...authHeaders, "Content-Type": "application/octet-stream" }
  if (body) headers["Content-Length"] = String(body.length)

  const fetchBody = body ? new Uint8Array(body) : undefined
  const response = await fetchWithRetry(url, { method, headers, body: fetchBody })
  return response
}

async function listS3Files(config: S3Config, prefix: string): Promise<CloudFileInfo[]> {
  const files: CloudFileInfo[] = []
  let continuationToken: string | undefined
  do {
    const url = s3ListUrl(config, prefix, continuationToken)
    const signedHeaders = getSignatureHeaders(config, "GET", url, {}, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    const res = await fetchWithRetry(url, { headers: signedHeaders })
    const text = await res.text()

    const keyRegex = /<Key>([^<]+)<\/Key>/g
    const sizeRegex = /<Size>([^<]+)<\/Size>/g
    const lastModRegex = /<LastModified>([^<]+)<\/LastModified>/g
    const nextTokenRegex = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/
    const isTruncatedRegex = /<IsTruncated>([^<]+)<\/IsTruncated>/

    let match: RegExpExecArray | null
    const keys: string[] = []
    const sizes: string[] = []
    const lastMods: string[] = []

    while ((match = keyRegex.exec(text)) !== null) keys.push(match[1])
    while ((match = sizeRegex.exec(text)) !== null) sizes.push(match[1])
    while ((match = lastModRegex.exec(text)) !== null) lastMods.push(match[1])

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const name = key.slice(prefix.length).replace(/\/$/, "")
      if (!name) continue
      const isDir = key.endsWith("/")
      files.push({
        id: key, name, size: parseInt(sizes[i] ?? "0", 10), modifiedAt: lastMods[i],
        path: name, isDir,
      })
    }

    const isTruncated = isTruncatedRegex.exec(text)?.[1] === "true"
    continuationToken = isTruncated ? nextTokenRegex.exec(text)?.[1] : undefined
  } while (continuationToken)

  return files
}

export class S3Provider implements CloudProvider {
  readonly id = "s3" as const
  readonly name = "S3"

  async authenticate(authData?: Record<string, string>): Promise<CloudAuthResult> {
    if (!authData?.endpoint || !authData?.bucket || !authData?.accessKeyId || !authData?.secretAccessKey) {
      return { success: false, error: "Заполните endpoint, bucket, Access Key и Secret Key" }
    }
    const config: S3Config = {
      endpoint: authData.endpoint.replace(/\/+$/, ""),
      bucket: authData.bucket,
      accessKeyId: authData.accessKeyId,
      secretAccessKey: authData.secretAccessKey,
      region: authData.region || "us-east-1",
      forcePathStyle: authData.forcePathStyle !== "false",
    }
    try {
      const url = s3ListUrl(config, BASE_PREFIX)
      const signedHeaders = getSignatureHeaders(config, "GET", url, {}, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
      const res = await fetch(url, { headers: signedHeaders })
      if (!res.ok && res.status !== 404) {
        return { success: false, error: `S3 ошибка: ${res.status} ${res.statusText}` }
      }
      await writeConfig(config)
      return { success: true, provider: "s3" }
    } catch (e) {
      return { success: false, error: `Не удалось подключиться: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const config = await readConfig()
    return config !== null
  }

  async logout(): Promise<void> {
    try { await dbHelpers.removeCloudConfig("s3") } catch { /* noop */ }
    cachedConfig = null
  }

  async ensureBaseFolder(): Promise<void> {
    const config = await readConfig()
    if (!config) throw new Error("S3 не настроен")
    const folders = ["builds/", "accounts/"]
    for (const sub of folders) {
      const key = `${BASE_PREFIX}${sub}`
      const url = s3Url(config, key)
      await s3Request(config, "PUT", url, Buffer.alloc(0))
    }
  }

  async listFiles(folderPath?: string): Promise<CloudFileListResult> {
    const config = await readConfig()
    if (!config) return { success: false, error: "S3 не настроен" }
    try {
      const prefix = folderPath ? `${BASE_PREFIX}${folderPath}/` : BASE_PREFIX
      const files = await listS3Files(config, prefix)
      return { success: true, files }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async uploadFile(localPath: string, remotePath: string, onProgress?: (percent: number) => void): Promise<CloudUploadResult> {
    const config = await readConfig()
    if (!config) return { success: false, error: "S3 не настроен" }
    try {
      const key = `${BASE_PREFIX}${remotePath}`
      const body = await fs.readFile(localPath)
      const url = s3Url(config, key)
      onProgress?.(50)
      const res = await s3Request(config, "PUT", url, body, onProgress)
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`)
      onProgress?.(100)
      return { success: true, id: key, name: path.basename(remotePath) }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<CloudDownloadResult> {
    const config = await readConfig()
    if (!config) return { success: false, error: "S3 не настроен" }
    try {
      const key = `${BASE_PREFIX}${remotePath}`
      const url = s3Url(config, key)
      const signedHeaders = getSignatureHeaders(config, "GET", url, {}, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
      const res = await fetchWithRetry(url, { headers: signedHeaders })
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      await fs.writeFile(localPath, buffer)
      return { success: true, localPath }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }> {
    const config = await readConfig()
    if (!config) return { success: false, error: "S3 не настроен" }
    try {
      const key = `${BASE_PREFIX}${remotePath}`
      const url = s3Url(config, key)
      const res = await s3Request(config, "DELETE", url)
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      return { success: true }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async getStorageQuota(): Promise<CloudStorageQuota | null> {
    return null
  }
}
