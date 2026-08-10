import { shell } from "electron"
import http from "http"
import { URL } from "url"
import fs from "fs/promises"
import path from "path"
import type { CloudProvider, CloudAuthResult, CloudFileListResult, CloudUploadResult, CloudDownloadResult, CloudStorageQuota, CloudFileInfo } from "../provider"
import { callbackSuccessPage, callbackErrorPage } from "../callback-page"
import { getCloudCredentials } from "../credentials"
import { generatePkcePair } from "../pkce"
import { dbHelpers } from "../../../db"

const REDIRECT_PORT = 18936
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`
const AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
const GRAPH_API = "https://graph.microsoft.com/v1.0"
const BASE_FOLDER = "Xneon Launcher"
const SUB_FOLDERS = ["builds", "accounts"]
const SCOPES = "Files.ReadWrite offline_access User.Read"
const ONEDRIVE_CLIENT_ID = getCloudCredentials().onedrive.clientId

type OneDriveConfig = {
  client_id: string
  access_token: string
  refresh_token?: string
  expires_at?: number
}

async function readConfig(): Promise<OneDriveConfig | null> {
  try {
    const raw = await dbHelpers.getCloudConfig("onedrive")
    if (raw) return JSON.parse(raw) as OneDriveConfig
  } catch { /* noop */ }
  return null
}

async function writeConfig(config: OneDriveConfig): Promise<void> {
  const raw = JSON.stringify(config)
  await dbHelpers.setCloudConfig("onedrive", raw)
}

async function refreshAccessToken(config: OneDriveConfig): Promise<OneDriveConfig> {
  if (!config.refresh_token) throw new Error("No refresh token")
  const body = new URLSearchParams({ client_id: config.client_id, grant_type: "refresh_token", refresh_token: config.refresh_token, scope: SCOPES })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) {
    let detail = ""
    try { detail = await res.text() } catch { /* noop */ }
    throw new Error(`Refresh failed: ${res.status}${detail ? ` — ${detail}` : ""}`)
  }
  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string }
  const updated: OneDriveConfig = {
    client_id: config.client_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token || config.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
  await writeConfig(updated)
  return updated
}

async function getValidConfig(): Promise<OneDriveConfig | null> {
  const config = await readConfig()
  if (!config?.client_id || !config.access_token) return null
  if (config.expires_at && Date.now() > config.expires_at - 60000 && config.refresh_token) {
    try { return await refreshAccessToken(config) } catch { return null }
  }
  return config
}

async function graphFetch(url: string, config: OneDriveConfig, init?: RequestInit): Promise<Response> {
  const headers = { Authorization: `Bearer ${config.access_token}`, ...init?.headers }
  let res = await fetch(url, { ...init, headers })
  if (res.status === 401 && config.refresh_token) {
    try {
      const fresh = await refreshAccessToken(config)
      res = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${fresh.access_token}` } })
    } catch { /* keep original 401 */ }
  }
  return res
}

function encodeGraphPath(remotePath: string): string {
  return remotePath.split("/").filter(Boolean).map(seg => encodeURIComponent(seg)).join("/")
}

async function ensureRemoteFolder(config: OneDriveConfig, remotePath: string): Promise<void> {
  const segs = [BASE_FOLDER, ...remotePath.split("/").filter(Boolean)]
  let current = ""
  for (const seg of segs) {
    const childUrl = current
      ? `${GRAPH_API}/me/drive/root:/${encodeGraphPath(current)}:/children`
      : `${GRAPH_API}/me/drive/root/children`
    const res = await graphFetch(childUrl, config, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: seg, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    })
    if (!res.ok && res.status !== 409) throw new Error(`Create folder failed: ${res.status}`)
    current = current ? `${current}/${seg}` : seg
  }
}

export class OneDriveProvider implements CloudProvider {
  readonly id = "onedrive" as const
  readonly name = "OneDrive"

  async authenticate(authData?: Record<string, string>): Promise<CloudAuthResult> {
    const existing = await readConfig()
    const clientId = authData?.client_id || existing?.client_id || ONEDRIVE_CLIENT_ID
    if (!clientId) return { success: false, error: "Укажите client_id приложения Azure AD" }
    const { verifier, challenge } = generatePkcePair()

    return new Promise((resolve) => {
      const authUrl = new URL(AUTH_ENDPOINT)
      authUrl.searchParams.set("client_id", clientId)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI)
      authUrl.searchParams.set("scope", SCOPES)
      authUrl.searchParams.set("code_challenge", challenge)
      authUrl.searchParams.set("code_challenge_method", "S256")
      authUrl.searchParams.set("prompt", "select_account")

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", REDIRECT_URI)
        const code = url.searchParams.get("code")
        if (!code) { res.writeHead(400); res.end("No code"); return }

        try {
          const body = new URLSearchParams({ client_id: clientId, grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier, scope: SCOPES })
          const tokenRes = await fetch(TOKEN_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          })
          if (!tokenRes.ok) {
            let detail = ""
            try { detail = await tokenRes.text() } catch { /* noop */ }
            throw new Error(`Token exchange failed: ${tokenRes.status}${detail ? ` — ${detail}` : ""}`)
          }
          const data = await tokenRes.json() as { access_token: string; expires_in: number; refresh_token?: string }
          await writeConfig({
            client_id: clientId,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + data.expires_in * 1000,
          })
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackSuccessPage("OneDrive"))
          server.close()
          resolve({ success: true, provider: "onedrive" })
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackErrorPage("OneDrive", e instanceof Error ? e.message : String(e)))
          server.close()
          resolve({ success: false, error: e instanceof Error ? e.message : String(e) })
        }
      })
      server.listen(REDIRECT_PORT, () => { shell.openExternal(authUrl.toString()) })
      setTimeout(() => { server.close(); resolve({ success: false, error: "Timeout" }) }, 120000)
    })
  }

  async isAuthenticated(): Promise<boolean> { return (await getValidConfig()) !== null }
  async logout(): Promise<void> {
    try { await dbHelpers.removeCloudConfig("onedrive") } catch { /* noop */ }
  }

  async ensureBaseFolder(): Promise<void> {
    const config = await getValidConfig()
    if (!config) throw new Error("Not authenticated")
    for (const sub of SUB_FOLDERS) {
      await ensureRemoteFolder(config, sub)
    }
  }

  async listFiles(folderPath?: string): Promise<CloudFileListResult> {
    const config = await getValidConfig()
    if (!config) return { success: false, error: "Not authenticated" }
    try {
      const target = folderPath ? `${BASE_FOLDER}/${folderPath}` : BASE_FOLDER
      const res = await graphFetch(`${GRAPH_API}/me/drive/root:/${encodeGraphPath(target)}:/children`, config)
      if (res.status === 404) return { success: true, files: [] }
      if (!res.ok) throw new Error(`List failed: ${res.status}`)
      const data = await res.json() as { value: { id: string; name: string; size?: number; lastModifiedDateTime?: string; folder?: unknown }[] }
      const files: CloudFileInfo[] = (data.value || []).map(f => ({
        id: f.id,
        name: f.name,
        size: f.size || 0,
        modifiedAt: f.lastModifiedDateTime,
        path: folderPath ? `${folderPath}/${f.name}` : f.name,
        isDir: !!f.folder,
        category: f.folder ? undefined : (folderPath || "builds"),
      }))
      return { success: true, files }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<CloudUploadResult> {
    const config = await getValidConfig()
    if (!config) return { success: false, error: "Not authenticated" }
    try {
      const fileName = path.basename(localPath)
      const parent = remotePath.split("/").slice(0, -1).filter(Boolean).join("/")
      await ensureRemoteFolder(config, parent)
      const full = parent ? `${BASE_FOLDER}/${parent}/${fileName}` : `${BASE_FOLDER}/${fileName}`
      const fileBuffer = await fs.readFile(localPath)
      const res = await graphFetch(`${GRAPH_API}/me/drive/root:/${encodeGraphPath(full)}:/content`, config, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: fileBuffer,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      return { success: true, id: full, name: fileName }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<CloudDownloadResult> {
    const config = await getValidConfig()
    if (!config) return { success: false, error: "Not authenticated" }
    try {
      const full = `${BASE_FOLDER}/${remotePath}`
      const res = await graphFetch(`${GRAPH_API}/me/drive/root:/${encodeGraphPath(full)}:/content`, config)
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const arrayBuffer = await res.arrayBuffer()
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      await fs.writeFile(localPath, Buffer.from(arrayBuffer))
      return { success: true, localPath }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }> {
    const config = await getValidConfig()
    if (!config) return { success: false, error: "Not authenticated" }
    try {
      const full = `${BASE_FOLDER}/${remotePath}`
      const res = await graphFetch(`${GRAPH_API}/me/drive/root:/${encodeGraphPath(full)}:`, config, { method: "DELETE" })
      if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`)
      return { success: true }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async getStorageQuota(): Promise<CloudStorageQuota | null> {
    const config = await getValidConfig()
    if (!config) return null
    try {
      const res = await graphFetch(`${GRAPH_API}/me/drive`, config)
      if (!res.ok) return null
      const data = await res.json() as { quota?: { used?: number; total?: number } }
      return { used: data.quota?.used || 0, total: data.quota?.total || 0 }
    } catch { return null }
  }
}
