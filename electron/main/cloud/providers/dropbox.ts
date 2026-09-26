import { opFailure } from "../../errors"
import { shell } from "electron"
import { URL } from "url"
import fs from "fs/promises"
import path from "path"
import type { CloudProvider, CloudAuthResult, CloudFileListResult, CloudUploadResult, CloudDownloadResult, CloudStorageQuota, CloudFileInfo } from "../provider"
import { getCloudCredentials } from "../credentials"
import { readCloudToken, writeCloudToken, clearCloudToken } from "../token-store"
import { runOAuthLoopback } from "../oauth-loopback"
import { fetchWithRetry } from "@xnlc/core/retry"

const credentials = getCloudCredentials()
const DBX_CLIENT_ID = credentials.dropbox.clientId
const REDIRECT_PORT = 18934
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const BASE_FOLDER = "/Xneon Launcher"
const SUB_FOLDERS = ["/builds", "/accounts", "/servers"]

type TokenData = { access_token?: string; refresh_token?: string; expires_at?: number }

/** Токен и его обновление — в общем хранилище (см. token-store.ts). */
const readToken = () => readCloudToken<TokenData>("dropbox")
const writeToken = (data: TokenData) => writeCloudToken("dropbox", data)

/**
 * Обновляет access token по refresh_token.
 *
 * Dropbox с `token_access_type=offline` выдаёт короткоживущий access token
 * (~4 часа) и долгоживущий refresh_token. Раньше сохранялся только access
 * token, поэтому через несколько часов провайдер молча «терял авторизацию» —
 * остальные OAuth-провайдеры (Яндекс, OneDrive, Google Drive) refresh умели.
 */
async function refreshAccessToken(token: TokenData): Promise<TokenData> {
  if (!token.refresh_token) throw new Error("No refresh token")
  const res = await fetchWithRetry("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: DBX_CLIENT_ID,
    }),
  })
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in?: number; refresh_token?: string }
  const updated: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 14400) * 1000,
  }
  await writeToken(updated)
  return updated
}

async function getAccessToken(): Promise<string | null> {
  const token = await readToken()
  if (!token) return null
  if (!token.access_token && token.refresh_token) {
    try { return (await refreshAccessToken(token)).access_token ?? null } catch { return null }
  }
  if (token.expires_at && Date.now() > token.expires_at - 60000 && token.refresh_token) {
    try { return (await refreshAccessToken(token)).access_token ?? null } catch { return token.access_token ?? null }
  }
  return token.access_token ?? null
}

async function dbxFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = { Authorization: `Bearer ${token}`, ...init?.headers }
  return fetchWithRetry(url, { ...init, headers })
}

async function ensureFolderOnDropbox(token: string, folderPath: string): Promise<void> {
  try {
    await dbxFetch("https://api.dropboxapi.com/2/files/create_folder_v2", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath, autorename: false }),
    })
  } catch { /* folder may exist */ }
}

export class DropboxProvider implements CloudProvider {
  readonly id = "dropbox" as const
  readonly name = "Dropbox"

  async authenticate(): Promise<CloudAuthResult> {
    // Общий loopback-каркас (см. oauth-loopback.ts).
    return runOAuthLoopback({
      providerLabel: "Dropbox",
      providerId: "dropbox",
      port: REDIRECT_PORT,
      buildAuthUrl: ({ challenge }) => {
        const authUrl = new URL("https://www.dropbox.com/oauth2/authorize")
        authUrl.searchParams.set("client_id", DBX_CLIENT_ID)
        authUrl.searchParams.set("redirect_uri", REDIRECT_URI)
        authUrl.searchParams.set("response_type", "code")
        // offline — иначе Dropbox не выдаст refresh_token.
        authUrl.searchParams.set("token_access_type", "offline")
        authUrl.searchParams.set("code_challenge", challenge)
        authUrl.searchParams.set("code_challenge_method", "S256")
        return authUrl.toString()
      },
      exchange: async (code, verifier) => {
        const tokenRes = await fetch("https://api.dropbox.com/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI, client_id: DBX_CLIENT_ID, code_verifier: verifier }),
        })
        if (!tokenRes.ok) throw new Error("Token exchange failed")
        const data = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in?: number }
        // refresh_token сохраняем обязательно: без него авторизация умирает
        // вместе с короткоживущим access token.
        await writeToken({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
        })
      },
    })
  }

  async isAuthenticated(): Promise<boolean> { return (await getAccessToken()) !== null }
  async logout(): Promise<void> {
    await clearCloudToken("dropbox")
  }

  async ensureBaseFolder(): Promise<void> {
    const token = await getAccessToken()
    if (!token) throw new Error("Not authenticated")
    await ensureFolderOnDropbox(token, BASE_FOLDER)
    for (const sub of SUB_FOLDERS) {
      await ensureFolderOnDropbox(token, `${BASE_FOLDER}${sub}`)
    }
  }

  async listFiles(folderPath?: string): Promise<CloudFileListResult> {
    const token = await getAccessToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const dbxPath = folderPath ? `${BASE_FOLDER}/${folderPath}` : BASE_FOLDER
      const res = await dbxFetch("https://api.dropboxapi.com/2/files/list_folder", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dbxPath }),
      })
      if (!res.ok) throw new Error(`List failed: ${res.status}`)
      const data = await res.json() as { entries: { name: string; path_lower: string; path_display: string; is_downloadable?: boolean; size?: number; server_modified?: string; ".tag": string }[] }
      const files: CloudFileInfo[] = data.entries
        .filter(e => e[".tag"] === "file" || e[".tag"] === "folder")
        .map(e => ({
          id: e.path_display, name: e.name, size: e.size || 0, modifiedAt: e.server_modified,
          path: folderPath ? `${folderPath}/${e.name}` : e.name,
          isDir: e[".tag"] === "folder",
          category: e[".tag"] === "folder" ? undefined : (folderPath || "builds"),
        }))
      return { success: true, files }
    } catch (e) { return opFailure(e) }
  }

  async uploadFile(localPath: string, remotePath: string, onProgress?: (percent: number) => void): Promise<CloudUploadResult> {
    const token = await getAccessToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const fileName = path.basename(localPath)
      const dirParts = remotePath.split("/").slice(0, -1).filter(Boolean)
      const dbxDest = `${BASE_FOLDER}/${dirParts.join("/")}/${fileName}`
      const { uploadWithProgress } = await import("../upload-with-progress.js")
      const res = await uploadWithProgress({
        url: "https://content.dropboxapi.com/2/files/upload",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({ path: dbxDest, mode: "overwrite", autorename: false }),
        },
        filePath: localPath,
        onProgress,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const created = res.json as { id: string; name: string; path_display: string }
      return { success: true, id: created.id, name: created.name }
    } catch (e) { return opFailure(e) }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<CloudDownloadResult> {
    const token = await getAccessToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const dbxPath = `${BASE_FOLDER}/${remotePath}`
      const res = await dbxFetch("https://content.dropboxapi.com/2/files/download", token, {
        method: "POST",
        headers: { "Dropbox-API-Arg": JSON.stringify({ path: dbxPath }) },
      })
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const arrayBuffer = await res.arrayBuffer()
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      await fs.writeFile(localPath, Buffer.from(arrayBuffer))
      return { success: true, localPath }
    } catch (e) { return opFailure(e) }
  }

  async deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }> {
    const token = await getAccessToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const dbxPath = `${BASE_FOLDER}/${remotePath}`
      await dbxFetch("https://api.dropboxapi.com/2/files/delete_v2", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dbxPath }),
      })
      return { success: true }
    } catch (e) { return opFailure(e) }
  }

  async getStorageQuota(): Promise<CloudStorageQuota | null> {
    const token = await getAccessToken()
    if (!token) return null
    try {
      const res = await dbxFetch("https://api.dropboxapi.com/2/users/get_space_usage", token, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      })
      if (!res.ok) return null
      const data = await res.json() as { used: number; allocation?: { allocated: number } }
      return { used: data.used, total: data.allocation?.allocated || 0 }
    } catch { return null }
  }
}
