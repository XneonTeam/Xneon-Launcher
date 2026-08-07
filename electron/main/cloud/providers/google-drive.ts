import { BrowserWindow, shell, app } from "electron"
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
const GOOGLE_CLIENT_ID = credentials.googleDrive.clientId
const GOOGLE_CLIENT_SECRET = credentials.googleDrive.clientSecret
const GOOGLE_REDIRECT_PORT = 18932
const GOOGLE_REDIRECT_URI = `http://localhost:${GOOGLE_REDIRECT_PORT}/callback`
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata"
const GOOGLE_API = "https://www.googleapis.com/drive/v3"
const GOOGLE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
const BASE_FOLDER = "Xneon Launcher"
const SUB_FOLDERS = ["builds", "accounts"]

function getTokenPath(): string {
  return path.join(app.getPath("userData"), "cloud-google-drive.json")
}

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

async function readToken(): Promise<TokenData | null> {
  try {
    const raw = await dbHelpers.getCloudConfig("google-drive")
    const data = JSON.parse(raw) as TokenData
    if (isValidToken(data)) return data
  } catch { /* noop */ }
  try {
    const raw = await fs.readFile(getTokenPath(), "utf-8")
    const data = JSON.parse(raw) as TokenData
    if (isValidToken(data)) {
      try {
        await dbHelpers.setCloudConfig("google-drive", raw)
        await fs.unlink(getTokenPath())
      } catch { /* noop */ }
      return data
    }
  } catch { /* noop */ }
  return null
}

async function writeToken(data: TokenData): Promise<void> {
  const raw = JSON.stringify(data)
  try {
    await dbHelpers.setCloudConfig("google-drive", raw)
    await fs.unlink(getTokenPath()).catch(() => {})
  } catch {
    await fs.writeFile(getTokenPath(), raw)
  }
}

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
  const res = await fetch(url, { ...init, headers })
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
    return new Promise((resolve) => {
      const { verifier, challenge } = generatePkcePair()
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
      authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID)
      authUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("scope", GOOGLE_SCOPES)
      authUrl.searchParams.set("access_type", "offline")
      authUrl.searchParams.set("prompt", "consent")
      authUrl.searchParams.set("code_challenge", challenge)
      authUrl.searchParams.set("code_challenge_method", "S256")

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${GOOGLE_REDIRECT_PORT}`)
        const code = url.searchParams.get("code")
        if (!code) {
          res.writeHead(400)
          res.end("No code")
          return
        }

        try {
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

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackSuccessPage("Google Drive"))
          server.close()
          resolve({ success: true, provider: "google-drive" })
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackErrorPage("Google Drive", e instanceof Error ? e.message : String(e)))
          server.close()
          resolve({ success: false, error: e instanceof Error ? e.message : String(e) })
        }
      })

      server.listen(GOOGLE_REDIRECT_PORT, () => {
        shell.openExternal(authUrl.toString())
      })

      setTimeout(() => { server.close(); resolve({ success: false, error: "Timeout" }) }, 120000)
    })
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await getValidToken()
    return token !== null
  }

  async logout(): Promise<void> {
    try { await dbHelpers.removeCloudConfig("google-drive") } catch { /* noop */ }
    try { await fs.unlink(getTokenPath()) } catch { /* noop */ }
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
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<CloudUploadResult> {
    const token = await getValidToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const fileBuffer = await fs.readFile(localPath)
      const fileName = path.basename(localPath)
      const dirParts = remotePath.split("/").slice(0, -1).filter(Boolean)
      const baseId = await findOrCreateBaseFolder(token)
      let parentId = baseId
      for (const part of dirParts) {
        parentId = await createFolderIfNotExists(token, part, parentId)
      }
      const metadata = { name: fileName, parents: [parentId] }
      const boundary = `----XneonBoundary${Date.now()}`
      const parts: (string | Buffer)[] = []
      parts.push(Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`))
      parts.push(Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`))
      parts.push(fileBuffer)
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
      const body = Buffer.concat(parts.map(p => typeof p === "string" ? Buffer.from(p) : p))

      const res = await fetch(`${GOOGLE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(body.length) },
        body,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const created = await res.json() as { id: string; name: string }
      return { success: true, id: created.id, name: created.name }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
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
      return { success: false, error: e instanceof Error ? e.message : String(e) }
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
      return { success: false, error: e instanceof Error ? e.message : String(e) }
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
