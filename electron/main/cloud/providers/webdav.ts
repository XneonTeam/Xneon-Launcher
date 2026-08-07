import fs from "fs/promises"
import path from "path"
import { app } from "electron"
import type { CloudProvider, CloudAuthResult, CloudFileListResult, CloudUploadResult, CloudDownloadResult, CloudStorageQuota, CloudFileInfo } from "../provider"
import { createClient } from "webdav"
import { dbHelpers } from "../../../db"

const BASE_FOLDER = "Xneon Launcher"
const SUB_FOLDERS = ["builds", "accounts"]

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "cloud-webdav.json")
}

type WebDavConfig = {
  url: string
  username: string
  password: string
}

let cachedClient: ReturnType<typeof createClient> | null = null
let cachedConfig: WebDavConfig | null = null

async function readConfig(): Promise<WebDavConfig | null> {
  try {
    const raw = await dbHelpers.getCloudConfig("webdav")
    if (raw) return JSON.parse(raw) as WebDavConfig
  } catch { /* noop */ }
  try {
    const raw = await fs.readFile(getConfigPath(), "utf-8")
    const config = JSON.parse(raw) as WebDavConfig
    try {
      await dbHelpers.setCloudConfig("webdav", raw)
      await fs.unlink(getConfigPath())
    } catch { /* noop */ }
    return config
  } catch { return null }
}

async function writeConfig(config: WebDavConfig): Promise<void> {
  const raw = JSON.stringify(config)
  try {
    await dbHelpers.setCloudConfig("webdav", raw)
    await fs.unlink(getConfigPath()).catch(() => {})
  } catch {
    await fs.writeFile(getConfigPath(), raw)
  }
}

async function getClient(): Promise<ReturnType<typeof createClient> | null> {
  const config = await readConfig()
  if (!config) return null
  if (cachedClient && cachedConfig?.url === config.url && cachedConfig?.username === config.username) return cachedClient
  cachedClient = createClient(config.url, { username: config.username, password: config.password })
  cachedConfig = config
  return cachedClient
}

async function ensureFolder(client: ReturnType<typeof createClient>, folderPath: string): Promise<void> {
  try {
    const exists = await client.exists(folderPath)
    if (!exists) await client.createDirectory(folderPath, { recursive: true })
  } catch {
    try { await client.createDirectory(folderPath, { recursive: true }) } catch { /* noop */ }
  }
}

export class WebDavProvider implements CloudProvider {
  readonly id = "webdav" as const
  readonly name = "WebDAV"

  async authenticate(authData?: Record<string, string>): Promise<CloudAuthResult> {
    if (!authData?.url || !authData?.username || !authData?.password) {
      return { success: false, error: "Заполните URL, логин и пароль" }
    }
    const config: WebDavConfig = { url: authData.url.replace(/\/+$/, ""), username: authData.username, password: authData.password }
    const client = createClient(config.url, { username: config.username, password: config.password })
    try {
      await client.stat("/")
      await writeConfig(config)
      cachedClient = client
      cachedConfig = config
      return { success: true, provider: "webdav" }
    } catch (e) {
      return { success: false, error: `Не удалось подключиться: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const client = await getClient()
    if (!client) return false
    try { await client.stat("/"); return true } catch { return false }
  }

  async logout(): Promise<void> {
    try { await dbHelpers.removeCloudConfig("webdav") } catch { /* noop */ }
    try { await fs.unlink(getConfigPath()) } catch { /* noop */ }
    cachedClient = null
    cachedConfig = null
  }

  async ensureBaseFolder(): Promise<void> {
    const client = await getClient()
    if (!client) throw new Error("Not configured")
    await ensureFolder(client, `/${BASE_FOLDER}`)
    for (const sub of SUB_FOLDERS) {
      await ensureFolder(client, `/${BASE_FOLDER}/${sub}`)
    }
  }

  async listFiles(folderPath?: string): Promise<CloudFileListResult> {
    const client = await getClient()
    if (!client) return { success: false, error: "Not configured" }
    try {
      const targetPath = folderPath ? `/${BASE_FOLDER}/${folderPath}` : `/${BASE_FOLDER}`
      const items = await client.getDirectoryContents(targetPath) as any[]
      const files: CloudFileInfo[] = items.map(f => ({
        id: f.filename, name: f.basename || f.name, size: f.size || 0, modifiedAt: f.lastmod,
        path: folderPath ? `${folderPath}/${f.basename || f.name}` : f.basename || f.name,
        isDir: f.type === "directory",
        category: f.type === "directory" ? undefined : (folderPath || "builds"),
      }))
      return { success: true, files }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<CloudUploadResult> {
    const client = await getClient()
    if (!client) return { success: false, error: "Not configured" }
    try {
      const fileName = path.basename(localPath)
      const dirParts = remotePath.split("/").slice(0, -1).filter(Boolean)
      const targetDir = dirParts.length > 0 ? `/${BASE_FOLDER}/${dirParts.join("/")}` : `/${BASE_FOLDER}`
      await ensureFolder(client, targetDir)
      const destPath = `${targetDir}/${fileName}`
      const fileBuffer = await fs.readFile(localPath)
      await client.putFileContents(destPath, fileBuffer, { overwrite: true })
      return { success: true, id: destPath, name: fileName }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<CloudDownloadResult> {
    const client = await getClient()
    if (!client) return { success: false, error: "Not configured" }
    try {
      const srcPath = `/${BASE_FOLDER}/${remotePath}`
      const content = await client.getFileContents(srcPath) as ArrayBuffer
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      await fs.writeFile(localPath, Buffer.from(content))
      return { success: true, localPath }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async deleteFile(remotePath: string): Promise<{ success: boolean; error?: string }> {
    const client = await getClient()
    if (!client) return { success: false, error: "Not configured" }
    try {
      const srcPath = `/${BASE_FOLDER}/${remotePath}`
      await client.deleteFile(srcPath)
      return { success: true }
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  }

  async getStorageQuota(): Promise<CloudStorageQuota | null> {
    return null
  }
}
