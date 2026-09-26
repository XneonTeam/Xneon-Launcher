import { opFailure } from "../../errors"
import { shell } from "electron"
import { URL } from "url"
import fs from "fs/promises"
import path from "path"
import type { CloudProvider, CloudAuthResult, CloudFileListResult, CloudUploadResult, CloudDownloadResult, CloudStorageQuota, CloudFileInfo } from "../provider"
import { getCloudCredentials } from "../credentials"
import { readCloudToken, writeCloudToken, clearCloudToken, getValidCloudToken } from "../token-store"
import { runOAuthLoopback } from "../oauth-loopback"
import { fetchWithRetry } from "@xnlc/core/retry"

const credentials = getCloudCredentials()
const YANDEX_CLIENT_ID = credentials.yandex.clientId
const REDIRECT_PORT = 18935
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const YANDEX_API = "https://cloud-api.yandex.net/v1"
const BASE_FOLDER = "Xneon Launcher"
const SUB_FOLDERS = ["builds", "accounts", "servers"]

type TokenData = { access_token: string; refresh_token?: string; expires_at?: number }

/** Токен и его обновление — в общем хранилище (см. token-store.ts). */
const readToken = () => readCloudToken<TokenData>("yandex")
const writeToken = (data: TokenData) => writeCloudToken("yandex", data)

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
  // Общий каркас «проверить срок → обновить по refresh_token → записать».
  const token = await getValidCloudToken<TokenData>("yandex", refreshAccessToken)
  return token?.access_token ?? null
}

async function yandexFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = { Authorization: `OAuth ${token}`, ...init?.headers }
  const res = await fetchWithRetry(url, { ...init, headers })
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
    // Общий loopback-каркас (см. oauth-loopback.ts).
    return runOAuthLoopback({
      providerLabel: "Яндекс Диск",
      providerId: "yandex-disk",
      port: REDIRECT_PORT,
      buildAuthUrl: ({ challenge }) => {
        const authUrl = new URL("https://oauth.yandex.ru/authorize")
        authUrl.searchParams.set("client_id", YANDEX_CLIENT_ID)
        authUrl.searchParams.set("redirect_uri", REDIRECT_URI)
        authUrl.searchParams.set("response_type", "code")
        authUrl.searchParams.set("force_confirm", "yes")
        authUrl.searchParams.set("code_challenge", challenge)
        authUrl.searchParams.set("code_challenge_method", "S256")
        return authUrl.toString()
      },
      exchange: async (code, verifier) => {
        const tokenRes = await fetch("https://oauth.yandex.ru/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code", code, client_id: YANDEX_CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: verifier,
          }),
        })
        if (!tokenRes.ok) throw new Error("Token exchange failed")
        const data = await tokenRes.json() as { access_token: string; expires_in: number; refresh_token: string }
        await writeToken({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 })
      },
    })
  }

  async isAuthenticated(): Promise<boolean> {
    // Быстрая локальная проверка: сохранённый токен => подключён.
    // Refresh токена выполняется лениво при реальных операциях, чтобы не
    // блокировать рендер страницы Cloud сетевым запросом.
    const token = await readToken()
    return token !== null
  }
  async logout(): Promise<void> {
    await clearCloudToken("yandex")
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
    } catch (e) { return opFailure(e) }
  }

  async uploadFile(localPath: string, remotePath: string, onProgress?: (percent: number) => void): Promise<CloudUploadResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const fileName = path.basename(localPath)
      const ydDest = `/${BASE_FOLDER}/${remotePath}`
      const hrefRes = await yandexFetch(`${YANDEX_API}/disk/resources/upload?path=${encodeURIComponent(ydDest)}&overwrite=true`, token)
      if (!hrefRes.ok) throw new Error(`Upload URL failed: ${hrefRes.status}`)
      const hrefData = await hrefRes.json() as { href: string; method: string }
      const { uploadWithProgress } = await import("../upload-with-progress.js")
      const uploadRes = await uploadWithProgress({
        url: hrefData.href,
        method: hrefData.method || "PUT",
        headers: {},
        filePath: localPath,
        onProgress,
      })
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)
      return { success: true, id: ydDest, name: fileName }
    } catch (e) { return opFailure(e) }
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
    } catch (e) { return opFailure(e) }
  }

  async deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const ydPath = `/${BASE_FOLDER}/${remotePath}`
      await yandexFetch(`${YANDEX_API}/disk/resources?path=${encodeURIComponent(ydPath)}`, token, { method: "DELETE" })
      return { success: true }
    } catch (e) { return opFailure(e) }
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
