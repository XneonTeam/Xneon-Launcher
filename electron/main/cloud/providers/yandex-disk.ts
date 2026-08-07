import { shell, app } from "electron"
import http from "http"
import { URL } from "url"
import fs from "fs/promises"
import path from "path"
import type { CloudProvider, CloudAuthResult, CloudFileListResult, CloudUploadResult, CloudDownloadResult, CloudStorageQuota, CloudFileInfo } from "../provider"
import { callbackSuccessPage, callbackErrorPage } from "../callback-page"
import { getCloudCredentials } from "../credentials"
import { generatePkcePair } from "../pkce"
import { dbHelpers } from "../../../db"

const credentials = getCloudCredentials()
const YANDEX_CLIENT_ID = credentials.yandex.clientId
const REDIRECT_PORT = 18935
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const YANDEX_API = "https://cloud-api.yandex.net/v1"
const BASE_FOLDER = "Xneon Launcher"
const SUB_FOLDERS = ["builds", "accounts"]

function getTokenPath(): string {
  return path.join(app.getPath("userData"), "cloud-yandex.json")
}

type TokenData = { access_token: string; refresh_token?: string; expires_at?: number }

async function readToken(): Promise<TokenData | null> {
  try {
    const raw = await dbHelpers.getCloudConfig("yandex")
    if (raw) return JSON.parse(raw) as TokenData
  } catch { /* noop */ }
  try {
    const raw = await fs.readFile(getTokenPath(), "utf-8")
    const data = JSON.parse(raw) as TokenData
    try {
      await dbHelpers.setCloudConfig("yandex", raw)
      await fs.unlink(getTokenPath())
    } catch { /* noop */ }
    return data
  } catch { return null }
}

async function writeToken(data: TokenData): Promise<void> {
  const raw = JSON.stringify(data)
  try {
    await dbHelpers.setCloudConfig("yandex", raw)
    await fs.unlink(getTokenPath()).catch(() => {})
  } catch {
    await fs.writeFile(getTokenPath(), raw)
  }
}

async function refreshAccessToken(token: TokenData): Promise<TokenData> {
  if (!token.refresh_token) throw new Error("No refresh token")
  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: YANDEX_CLIENT_ID })
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  })
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string }
  const updated: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
  await writeToken(updated)
  return updated
}

async function getValidToken(): Promise<string | null> {
  const token = await readToken()
  if (!token) return null
  if (token.expires_at && Date.now() > token.expires_at - 60000 && token.refresh_token) {
    try { const r = await refreshAccessToken(token); return r.access_token } catch { return null }
  }
  return token.access_token
}

async function yandexFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = { Authorization: `OAuth ${token}`, ...init?.headers }
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) throw new Error("Unauthorized")
  return res
}

async function mkdirYandex(token: string, folderPath: string): Promise<void> {
  try {
    await yandexFetch(`${YANDEX_API}/disk/resources?path=${encodeURIComponent(folderPath)}`, token, {
      method: "PUT",
    })
  } catch {}
}

async function getYandexResourceId(token: string, path: string): Promise<string | null> {
  const res = await yandexFetch(`${YANDEX_API}/disk/resources?path=${encodeURIComponent(path)}`, token)
  if (!res.ok) return null
  const data = await res.json() as { resource_id: string }
  return data.resource_id
}

export class YandexDiskProvider implements CloudProvider {
  readonly id = "yandex-disk" as const
  readonly name = "Яндекс Диск"

  async authenticate(): Promise<CloudAuthResult> {
    return new Promise((resolve) => {
      const { verifier, challenge } = generatePkcePair()
      const authUrl = new URL("https://oauth.yandex.ru/authorize")
      authUrl.searchParams.set("client_id", YANDEX_CLIENT_ID)
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("force_confirm", "yes")
      authUrl.searchParams.set("code_challenge", challenge)
      authUrl.searchParams.set("code_challenge_method", "S256")

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${REDIRECT_PORT}`)
        const code = url.searchParams.get("code")
        if (!code) { res.writeHead(400); res.end("No code"); return }

        try {
          const params = new URLSearchParams({
            grant_type: "authorization_code", code, client_id: YANDEX_CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: verifier,
          })
          const tokenRes = await fetch("https://oauth.yandex.ru/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params,
          })
          if (!tokenRes.ok) throw new Error("Token exchange failed")
          const data = await tokenRes.json() as { access_token: string; expires_in: number; refresh_token: string }
          await writeToken({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 })
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackSuccessPage("Яндекс Диск"))
          server.close()
          resolve({ success: true, provider: "yandex-disk" })
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackErrorPage("Яндекс Диск", e instanceof Error ? e.message : String(e)))
          server.close()
          resolve({ success: false, error: e instanceof Error ? e.message : String(e) })
        }
      })
      server.listen(REDIRECT_PORT, () => { shell.openExternal(authUrl.toString()) })
      setTimeout(() => { server.close(); resolve({ success: false, error: "Timeout" }) }, 120000)
    })
  }

  async isAuthenticated(): Promise<boolean> { return (await getValidToken()) !== null }
  async logout(): Promise<void> {
    try { await dbHelpers.removeCloudConfig("yandex") } catch { /* noop */ }
    try { await fs.unlink(getTokenPath()) } catch { /* noop */ }
  }

  async ensureBaseFolder(): Promise<void> {
    const token = await getValidToken()
    if (!token) throw new Error("Not authenticated")
    await mkdirYandex(token, `/${BASE_FOLDER}`)
    for (const sub of SUB_FOLDERS) {
      await mkdirYandex(token, `/${BASE_FOLDER}/${sub}`)
    }
  }

  async listFiles(folderPath?: string): Promise<CloudFileListResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const ydPath = folderPath ? `/${BASE_FOLDER}/${folderPath}` : `/${BASE_FOLDER}`
      const res = await yandexFetch(`${YANDEX_API}/disk/resources?path=${encodeURIComponent(ydPath)}&limit=1000`, token)
      if (!res.ok) throw new Error(`List failed: ${res.status}`)
      const data = await res.json() as { _embedded?: { items: { name: string; path: string; size?: number; modified?: string; type: string }[] } }
      const items = data._embedded?.items || []
      const files: CloudFileInfo[] = items.map(f => ({
        id: f.path, name: f.name, size: f.size || 0, modifiedAt: f.modified,
        path: folderPath ? `${folderPath}/${f.name}` : f.name,
        isDir: f.type === "dir",
        category: f.type === "dir" ? undefined : (folderPath || "builds"),
      }))
      return { success: true, files }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<CloudUploadResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const fileName = path.basename(localPath)
      const ydDest = `/${BASE_FOLDER}/${remotePath}`
      const hrefRes = await yandexFetch(`${YANDEX_API}/disk/resources/upload?path=${encodeURIComponent(ydDest)}&overwrite=true`, token)
      if (!hrefRes.ok) throw new Error(`Upload URL failed: ${hrefRes.status}`)
      const hrefData = await hrefRes.json() as { href: string; method: string }
      const fileBuffer = await fs.readFile(localPath)
      const uploadRes = await fetch(hrefData.href, { method: hrefData.method || "PUT", body: fileBuffer })
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)
      return { success: true, id: ydDest, name: fileName }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<CloudDownloadResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const ydPath = `/${BASE_FOLDER}/${remotePath}`
      const hrefRes = await yandexFetch(`${YANDEX_API}/disk/resources/download?path=${encodeURIComponent(ydPath)}`, token)
      if (!hrefRes.ok) throw new Error(`Download URL failed: ${hrefRes.status}`)
      const hrefData = await hrefRes.json() as { href: string }
      const dlRes = await fetch(hrefData.href)
      if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`)
      const arrayBuffer = await dlRes.arrayBuffer()
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      await fs.writeFile(localPath, Buffer.from(arrayBuffer))
      return { success: true, localPath }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const ydPath = `/${BASE_FOLDER}/${remotePath}`
      await yandexFetch(`${YANDEX_API}/disk/resources?path=${encodeURIComponent(ydPath)}`, token, { method: "DELETE" })
      return { success: true }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async getStorageQuota(): Promise<CloudStorageQuota | null> {
    const token = await getValidToken()
    if (!token) return null
    try {
      const res = await yandexFetch(`${YANDEX_API}/disk`, token)
      if (!res.ok) return null
      const data = await res.json() as { used_space: number; total_space: number }
      return { used: data.used_space, total: data.total_space }
    } catch { return null }
  }
}
