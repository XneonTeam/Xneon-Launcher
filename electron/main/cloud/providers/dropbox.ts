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
const DBX_CLIENT_ID = credentials.dropbox.clientId
const REDIRECT_PORT = 18934
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const BASE_FOLDER = "/Xneon Launcher"
const SUB_FOLDERS = ["/builds", "/accounts"]

function getTokenPath(): string {
  return path.join(app.getPath("userData"), "cloud-dropbox.json")
}

type TokenData = { access_token: string }

async function readToken(): Promise<TokenData | null> {
  try {
    const raw = await dbHelpers.getCloudConfig("dropbox")
    if (raw) return JSON.parse(raw) as TokenData
  } catch { /* noop */ }
  try {
    const raw = await fs.readFile(getTokenPath(), "utf-8")
    const data = JSON.parse(raw) as TokenData
    try {
      await dbHelpers.setCloudConfig("dropbox", raw)
      await fs.unlink(getTokenPath())
    } catch { /* noop */ }
    return data
  } catch { return null }
}

async function writeToken(data: TokenData): Promise<void> {
  const raw = JSON.stringify(data)
  try {
    await dbHelpers.setCloudConfig("dropbox", raw)
    await fs.unlink(getTokenPath()).catch(() => {})
  } catch {
    await fs.writeFile(getTokenPath(), raw)
  }
}

async function getAccessToken(): Promise<string | null> {
  const token = await readToken()
  return token?.access_token ?? null
}

async function dbxFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = { Authorization: `Bearer ${token}`, ...init?.headers }
  return fetch(url, { ...init, headers })
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
    return new Promise((resolve) => {
      const { verifier, challenge } = generatePkcePair()
      const authUrl = new URL("https://www.dropbox.com/oauth2/authorize")
      authUrl.searchParams.set("client_id", DBX_CLIENT_ID)
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("token_access_type", "offline")
      authUrl.searchParams.set("code_challenge", challenge)
      authUrl.searchParams.set("code_challenge_method", "S256")

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${REDIRECT_PORT}`)
        const code = url.searchParams.get("code")
        if (!code) { res.writeHead(400); res.end("No code"); return }

        try {
          const tokenRes = await fetch("https://api.dropbox.com/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI, client_id: DBX_CLIENT_ID, code_verifier: verifier }),
          })
          if (!tokenRes.ok) throw new Error("Token exchange failed")
          const data = await tokenRes.json() as { access_token: string }
          await writeToken({ access_token: data.access_token })
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackSuccessPage("Dropbox"))
          server.close()
          resolve({ success: true, provider: "dropbox" })
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" })
          res.end(callbackErrorPage("Dropbox", e instanceof Error ? e.message : String(e)))
          server.close()
          resolve({ success: false, error: e instanceof Error ? e.message : String(e) })
        }
      })
      server.listen(REDIRECT_PORT, () => { shell.openExternal(authUrl.toString()) })
      setTimeout(() => { server.close(); resolve({ success: false, error: "Timeout" }) }, 120000)
    })
  }

  async isAuthenticated(): Promise<boolean> { return (await getAccessToken()) !== null }
  async logout(): Promise<void> {
    try { await dbHelpers.removeCloudConfig("dropbox") } catch { /* noop */ }
    try { await fs.unlink(getTokenPath()) } catch { /* noop */ }
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
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<CloudUploadResult> {
    const token = await getAccessToken()
    if (!token) return { success: false, error: "Not authenticated" }
    try {
      const fileName = path.basename(localPath)
      const dirParts = remotePath.split("/").slice(0, -1).filter(Boolean)
      const dbxDest = `${BASE_FOLDER}/${dirParts.join("/")}/${fileName}`
      const fileBuffer = await fs.readFile(localPath)
      const res = await dbxFetch("https://content.dropboxapi.com/2/files/upload", token, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({ path: dbxDest, mode: "overwrite", autorename: false }),
        },
        body: fileBuffer,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const created = await res.json() as { id: string; name: string; path_display: string }
      return { success: true, id: created.id, name: created.name }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
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
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
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
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
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
