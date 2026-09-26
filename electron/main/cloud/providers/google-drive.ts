import { opFailure } from "../../errors"
import { BrowserWindow } from "electron"
import https from "https"
import { createReadStream } from "fs"
import { URL } from "url"
import fs from "fs/promises"
import path from "path"
import type { CloudProvider, CloudAuthResult, CloudFileListResult, CloudUploadResult, CloudDownloadResult, CloudStorageQuota, CloudFileInfo } from "../provider"
import { getCloudCredentials } from "../credentials"
import { readCloudToken, writeCloudToken, clearCloudToken } from "../token-store"
import { runOAuthLoopback } from "../oauth-loopback"
import { fetchWithRetry } from "@xnlc/core/retry"

const credentials = getCloudCredentials()
const GOOGLE_CLIENT_ID = credentials.googleDrive.clientId
const GOOGLE_CLIENT_SECRET = credentials.googleDrive.clientSecret
const GOOGLE_REDIRECT_PORT = 18932
const GOOGLE_REDIRECT_URI = `http://localhost:${GOOGLE_REDIRECT_PORT}/callback`
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata"
const GOOGLE_API = "https://www.googleapis.com/drive/v3"
const GOOGLE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
const BASE_FOLDER = "Xneon Launcher"
const SUB_FOLDERS = ["builds", "accounts", "servers"]

type TokenData = {
  access_token: string
  refresh_token?: string
  expires_at?: number
}

function isValidToken(data: TokenData | null): data is TokenData {
  if (!data) return false
  if (data.expires_at && Date.now() > data.expires_at && data.refresh_token) return true
  return !!data.access_token
}

/** Токен и его обновление — в общем хранилище (см. token-store.ts). */
async function readToken(): Promise<TokenData | null> {
  const data = await readCloudToken<TokenData>("google-drive")
  return isValidToken(data) ? data : null
}
const writeToken = (data: TokenData) => writeCloudToken("google-drive", data)

async function refreshAccessToken(token: TokenData): Promise<TokenData> {
  if (!token.refresh_token) throw new Error("No refresh token")
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  })
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  const updated: TokenData = {
    access_token: data.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
  await writeToken(updated)
  return updated
}

async function getValidToken(): Promise<string | null> {
  const token = await readToken()
  if (!token) return null
  if (token.expires_at && Date.now() > token.expires_at - 60000) {
    if (token.refresh_token) {
      try {
        const refreshed = await refreshAccessToken(token)
        return refreshed.access_token
      } catch { return null }
    }
  }
  return token.access_token
}

async function googleFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = { Authorization: `Bearer ${token}`, ...init?.headers }
  const res = await fetchWithRetry(url, { ...init, headers })
  if (res.status === 401) throw new Error("Unauthorized")
  return res
}

async function createFolderIfNotExists(token: string, name: string, parentId: string): Promise<string> {
  const listRes = await googleFetch(
    `${GOOGLE_API}/files?q=name='${encodeURIComponent(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    token
  )
  const listData = await listRes.json() as { files: { id: string }[] }
  if (listData.files.length > 0) return listData.files[0].id

  const createRes = await googleFetch(`${GOOGLE_API}/files?fields=id`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  })
  const created = await createRes.json() as { id: string }
  return created.id
}

async function findOrCreateBaseFolder(token: string): Promise<string> {
  const findRes = await googleFetch(
    `${GOOGLE_API}/files?q=name='${encodeURIComponent(BASE_FOLDER)}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    token
  )
  const findData = await findRes.json() as { files: { id: string }[] }
  if (findData.files.length > 0) return findData.files[0].id

  const createRes = await googleFetch(`${GOOGLE_API}/files?fields=id`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: BASE_FOLDER,
      mimeType: "application/vnd.google-apps.folder",
    }),
  })
  const created = await createRes.json() as { id: string }
  return created.id
}

async function getFolderId(token: string, folderPath: string): Promise<string | null> {
  const baseId = await findOrCreateBaseFolder(token)
  const parts = folderPath.split("/").filter(Boolean)
  let currentId = baseId
  for (const part of parts) {
    const res = await googleFetch(
      `${GOOGLE_API}/files?q=name='${encodeURIComponent(part)}' and '${currentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
      token
    )
    const data = await res.json() as { files: { id: string }[] }
    if (data.files.length === 0) return null
    currentId = data.files[0].id
  }
  return currentId
}

export class GoogleDriveProvider implements CloudProvider {
  readonly id = "google-drive" as const
  readonly name = "Google Drive"

  async authenticate(): Promise<CloudAuthResult> {
    // Общий loopback-каркас (см. oauth-loopback.ts): сервер, таймер, страницы
    // ответа и закрытие — в одном месте, провайдер отдаёт только свои параметры.
    return runOAuthLoopback({
      providerLabel: "Google Drive",
      providerId: "google-drive",
      port: GOOGLE_REDIRECT_PORT,
      buildAuthUrl: ({ challenge }) => {
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
        authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID)
        authUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI)
        authUrl.searchParams.set("response_type", "code")
        authUrl.searchParams.set("scope", GOOGLE_SCOPES)
        authUrl.searchParams.set("access_type", "offline")
        authUrl.searchParams.set("prompt", "consent")
        authUrl.searchParams.set("code_challenge", challenge)
        authUrl.searchParams.set("code_challenge_method", "S256")
        return authUrl.toString()
      },
      exchange: async (code, verifier) => {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: "authorization_code",
            redirect_uri: GOOGLE_REDIRECT_URI,
            code_verifier: verifier,
          }),
        })
        if (!tokenRes.ok) throw new Error("Token exchange failed")
        const data = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number }
        await writeToken({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
        })
      },
    })
  }

  async isAuthenticated(): Promise<boolean> {
    // Быстрая локальная проверка: сохранённый валидный токен => подключён.
    // Refresh токена выполняется лениво при реальных операциях, чтобы не
    // блокировать рендер страницы Cloud сетевым запросом.
    const token = await readToken()
    return token !== null
  }

  async logout(): Promise<void> {
    await clearCloudToken("google-drive")
  }

  async ensureBaseFolder(): Promise<void> {
    const token = await getValidToken()
    if (!token) throw new Error("Not authenticated")
    const baseId = await findOrCreateBaseFolder(token)
    for (const sub of SUB_FOLDERS) {
      await createFolderIfNotExists(token, sub, baseId)
    }
  }

  async listFiles(folderPath?: string): Promise<CloudFileListResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const baseId = await findOrCreateBaseFolder(token)
      let parentId = baseId
      if (folderPath) {
        const id = await getFolderId(token, folderPath)
        if (id) parentId = id
      }
      const res = await googleFetch(
        `${GOOGLE_API}/files?q='${parentId}' in parents and trashed=false&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=name`,
        token
      )
      const data = await res.json() as { files: { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[] }
      const files: CloudFileInfo[] = data.files.map(f => ({
        id: f.id,
        name: f.name,
        size: Number(f.size || 0),
        mimeType: f.mimeType,
        modifiedAt: f.modifiedTime,
        path: folderPath ? `${folderPath}/${f.name}` : f.name,
        isDir: f.mimeType === "application/vnd.google-apps.folder",
        category: f.mimeType === "application/vnd.google-apps.folder" ? undefined : (folderPath || "builds"),
      }))
      return { success: true, files }
    } catch (e) {
      return opFailure(e)
    }
  }

  async uploadFile(localPath: string, remotePath: string, onProgress?: (percent: number) => void): Promise<CloudUploadResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const fileStats = await fs.stat(localPath)
      const fileName = path.basename(localPath)
      const dirParts = remotePath.split("/").slice(0, -1).filter(Boolean)
      const baseId = await findOrCreateBaseFolder(token)
      let parentId = baseId
      for (const part of dirParts) {
        parentId = await createFolderIfNotExists(token, part, parentId)
      }
      const metadata = { name: fileName, parents: [parentId] }
      const boundary = `----XneonBoundary${Date.now()}`
      const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`)
      const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
      const totalBytes = prefix.length + fileStats.size + suffix.length

      let sentBytes = 0
      const reportProgress = (chunkBytes: number) => {
        sentBytes += chunkBytes
        if (onProgress && totalBytes > 0) {
          onProgress(Math.min(100, Math.round((sentBytes / totalBytes) * 100)))
        }
      }

      const res = await new Promise<Response>((resolve, reject) => {
        const request = https.request(new URL(`${GOOGLE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
            "Content-Length": String(totalBytes),
          },
        }, (response) => {
          const chunks: Buffer[] = []
          response.on("data", (c: Buffer) => chunks.push(c))
          response.on("end", () => resolve(new Response(Buffer.concat(chunks).toString("utf-8"), {
            status: response.statusCode ?? 500,
            headers: { "content-type": response.headers["content-type"] ?? "" },
          })))
        })
        request.on("error", reject)
        reportProgress(prefix.length)
        request.write(prefix)
        const stream = createReadStream(localPath)
        stream.on("data", (c: Buffer) => reportProgress(c.length))
        stream.on("error", (err) => { request.destroy(err); reject(err) })
        stream.on("end", () => {
          request.end(suffix)
        })
        stream.pipe(request, { end: false })
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const created = await res.json() as { id: string; name: string }
      return { success: true, id: created.id, name: created.name }
    } catch (e) {
      return opFailure(e)
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<CloudDownloadResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const fileName = path.basename(remotePath)
      const dirParts = remotePath.split("/").slice(0, -1).filter(Boolean)
      const baseId = await findOrCreateBaseFolder(token)
      let parentId = baseId
      for (const part of dirParts) {
        const res = await googleFetch(
          `${GOOGLE_API}/files?q=name='${encodeURIComponent(part)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
          token
        )
        const data = await res.json() as { files: { id: string }[] }
        if (data.files.length === 0) return { success: false, error: `Folder not found: ${part}` }
        parentId = data.files[0].id
      }
      const findRes = await googleFetch(
        `${GOOGLE_API}/files?q=name='${encodeURIComponent(fileName)}' and '${parentId}' in parents and trashed=false&fields=files(id)`,
        token
      )
      const findData = await findRes.json() as { files: { id: string }[] }
      if (findData.files.length === 0) return { success: false, error: "File not found" }
      const fileId = findData.files[0].id

      const dlRes = await googleFetch(`${GOOGLE_API}/files/${fileId}?alt=media`, token)
      if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`)
      const arrayBuffer = await dlRes.arrayBuffer()
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      await fs.writeFile(localPath, Buffer.from(arrayBuffer))
      return { success: true, localPath }
    } catch (e) {
      return opFailure(e)
    }
  }

  async deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const parts = remotePath.split("/").filter(Boolean)
      const fileName = parts.pop()!
      const baseId = await findOrCreateBaseFolder(token)
      let parentId = baseId
      for (const part of parts) {
        const res = await googleFetch(
          `${GOOGLE_API}/files?q=name='${encodeURIComponent(part)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
          token
        )
        const data = await res.json() as { files: { id: string }[] }
        if (data.files.length === 0) return { success: false, error: `Folder not found: ${part}` }
        parentId = data.files[0].id
      }
      const findRes = await googleFetch(
        `${GOOGLE_API}/files?q=name='${encodeURIComponent(fileName)}' and '${parentId}' in parents and trashed=false&fields=files(id)`,
        token
      )
      const findData = await findRes.json() as { files: { id: string }[] }
      if (findData.files.length === 0) return { success: false, error: "File not found" }
      await googleFetch(`${GOOGLE_API}/files/${findData.files[0].id}`, token, { method: "DELETE" })
      return { success: true }
    } catch (e) {
      return opFailure(e)
    }
  }

  async getStorageQuota(): Promise<CloudStorageQuota | null> {
    const token = await getValidToken()
    if (!token) return null
    try {
      const res = await googleFetch(`${GOOGLE_API}/about?fields=storageQuota`, token)
      const data = await res.json() as { storageQuota: { usage: string; limit: string } }
      return { used: Number(data.storageQuota.usage || 0), total: Number(data.storageQuota.limit || 0) }
    } catch { return null }
  }
}
