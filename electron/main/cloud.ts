import { app, ipcMain } from "electron"
import path from "path"
import fs from "fs/promises"
import { ensureBuildIntentDir, getBuildIntentDirName } from "./builds"
import { getCloudApiUrl } from "./config"
import { dbHelpers } from "../db"

type CloudFile = {
  id: string
  name: string
  size: number
  uploadedAt?: string
  category?: string
  downloadUrl?: string
  icon?: string
  build?: { icon?: string }
}

type CloudUser = {
  id: string
  username: string
  email: string
}

type StorageInfo = {
  used_bytes: number
  limit_bytes: number
  used_gb: number
  limit_gb: number
  formatted_used: string
  formatted_limit: string
}

async function cloudApiUrl(): Promise<string> {
  return getCloudApiUrl()
}

function safeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "isAxiosError" in error) {
    const axiosErr = error as any
    return axiosErr.response?.data?.detail ?? axiosErr.response?.data?.error ?? axiosErr.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function registerCloudHandlers() {
  ipcMain.handle("cloud:login", async (_event, username: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      const res = await axios.post(`${baseUrl}/auth/login`, { username, password }, { headers: { "Content-Type": "application/json" } })
      return { success: true, token: res.data.token }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:get-user", async (_event, token: string): Promise<{ success: boolean; user?: CloudUser; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      const res = await axios.get(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, user: res.data.user ?? res.data }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:register", async (_event, username: string, password: string, email?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      await axios.post(`${baseUrl}/auth/register`, { username, password, email })
      return { success: true }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:get-storage-info", async (_event, token: string): Promise<StorageInfo | null> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      const res = await axios.get(`${baseUrl}/files/storage/info`, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as StorageInfo
    } catch {
      return null
    }
  })

  ipcMain.handle("cloud:get-files", async (_event, token: string, category?: string): Promise<{ success: boolean; files?: CloudFile[]; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      const params = category ? `?category=${category}` : ""
      const res = await axios.get(`${baseUrl}/files${params}`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, files: res.data.files ?? res.data ?? [] }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:delete-file", async (_event, token: string, fileId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      await axios.delete(`${baseUrl}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:download-file", async (_event, token: string, fileId: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      const res = await axios.get(`${baseUrl}/files/${fileId}/download`, { headers: { Authorization: `Bearer ${token}` }, responseType: "arraybuffer" })
      const filePath = path.join(app.getPath("temp"), fileName)
      await fs.writeFile(filePath, Buffer.from(res.data))
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:download-and-import", async (_event, token: string, fileId: string, fileName: string, fileType: string): Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      const res = await axios.get(`${baseUrl}/files/${fileId}/download`, { headers: { Authorization: `Bearer ${token}` }, responseType: "arraybuffer" })
      const buffer = Buffer.from(res.data)

      if (fileType === "account") {
        const text = buffer.toString("utf-8")
        const account = JSON.parse(text) as { id: string; type: string; username: string; uuid?: string }
        return { success: true, account }
      } else if (fileType === "instance") {
        const buildName = fileName.replace(/\.zip$/i, "")
        const AdmZip = (await import("adm-zip")).default
        const metaUrl = await cloudApiUrl()
        const metaRes = await axios.get(`${metaUrl}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } })
        const meta = metaRes.data as { version?: string; mcVersion?: string; modLoader?: string; description?: string; icon?: string; coverImage?: string }

        const intentPath = await ensureBuildIntentDir(buildName)
        const zip = new AdmZip(buffer)
        zip.extractAllTo(intentPath, true)

        const existingBuilds = await dbHelpers.loadBuilds()
        existingBuilds.push({
          id: fileId,
          name: buildName,
          description: meta.description || "",
          version: meta.version || "1.0",
          modLoader: meta.modLoader || "",
          icon: meta.icon || "",
          coverImage: meta.coverImage ?? undefined,
          mods: [],
          resourcepacks: [],
          shaders: [],
          createdAt: new Date().toISOString(),
          source: "local",
          intentPath,
          loaderVersion: undefined,
          installedMods: {},
          projectSlug: undefined,
          playtime: 0,
        })
        await dbHelpers.saveAllBuilds(existingBuilds)
      }

      return { success: true }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:get-categories", async (_event, token: string): Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const axios = (await import("axios")).default
      const res = await axios.get(`${baseUrl}/files/categories`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, categories: res.data.categories ?? {} }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("build:upload-to-cloud", async (_event, buildName: string, cloudToken: string, category: string = "instance"): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log("[BUILD-UPLOAD] Starting upload for", buildName)
      const intentPath = await ensureBuildIntentDir(buildName)
      try { await fs.access(intentPath) } catch { return { success: false, error: "Сборка не найдена" } }

      const AdmZip = (await import("adm-zip")).default
      const FormData = (await import("form-data")).default
      const axios = (await import("axios")).default

      const zip = new AdmZip()
      zip.addLocalFolder(intentPath)
      const safeName = getBuildIntentDirName(buildName)
      const archivePath = path.join(app.getPath("temp"), `${safeName}.zip`)
      zip.writeZip(archivePath)

      const fileBuffer = await fs.readFile(archivePath)
      const form = new FormData()
      form.append("file", fileBuffer, {
        filepath: `${safeName}.zip`,
        contentType: "application/zip",
        knownLength: fileBuffer.length,
      })
      form.append("name", buildName)
      form.append("category", category)

      console.log("[BUILD-UPLOAD] Calling loadBuilds()")
      const allBuilds = await dbHelpers.loadBuilds()
      console.log("[BUILD-UPLOAD] loadBuilds() returned", allBuilds.length, "builds")
      const dbBuild = allBuilds.find(b => b.name === buildName || getBuildIntentDirName(b.name) === safeName)
      form.append("type", category)
      form.append("version", dbBuild ? (dbBuild.version || "1.0") : (category === "instance" ? "1.0" : category))
      if (dbBuild) {
        form.append("mcVersion", dbBuild.modLoader || "")
        form.append("modLoader", dbBuild.modLoader || "")
        form.append("description", dbBuild.description || "")
        form.append("icon", dbBuild.icon || "")
      }

      const baseUrl = await cloudApiUrl()
      const response = await axios.post(`${baseUrl}/files/upload`, form, {
        headers: { Authorization: `Bearer ${cloudToken}`, ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })

      if (response.status < 200 || response.status >= 300) {
        const errorMsg = response.data?.detail ?? response.data?.error ?? response.data?.message ?? `HTTP ${response.status}`
        throw new Error(errorMsg)
      }

      try { await fs.unlink(archivePath) } catch {}
      return { success: true }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:upload-account-data", async (_event, cloudToken: string, account: { id: string; type: string; username: string; uuid?: string }): Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }> => {
    try {
      const FormData = (await import("form-data")).default
      const axios = (await import("axios")).default

      const jsonData = JSON.stringify(account, null, 2)
      const buffer = Buffer.from(jsonData, "utf-8")
      const form = new FormData()
      form.append("file", buffer, { filename: `${account.username}.json`, contentType: "application/json" })
      form.append("name", account.username)
      form.append("type", "account")
      form.append("category", "account")
      form.append("version", account.type)

      const baseUrl = await cloudApiUrl()
      const response = await axios.post(`${baseUrl}/files/upload`, form, {
        headers: { Authorization: `Bearer ${cloudToken}`, ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })

      if (response.status < 200 || response.status >= 300) {
        const errorMsg = response.data?.detail ?? response.data?.error ?? `HTTP ${response.status}`
        return { success: false, error: errorMsg }
      }

      return { success: true, id: response.data.id, name: response.data.name, size: response.data.size }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:upload-file", async (_event, filePath: string, cloudToken: string, category: string): Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }> => {
    try {
      return await handleUploadFile(filePath, cloudToken, category)
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  async function handleUploadFile(filePath: string, cloudToken: string, category: string): Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }> {
    try { await fs.access(filePath) } catch { return { success: false, error: "Файл не найден" } }
    const FormData = (await import("form-data")).default
    const axios = (await import("axios")).default
    const fileName = path.basename(filePath)
    const fileBuffer = await fs.readFile(filePath)
    const form = new FormData()
    form.append("file", fileBuffer, { filename: fileName, contentType: "application/octet-stream" })
    form.append("category", category)

    const baseUrl = await cloudApiUrl()
    const response = await axios.post(`${baseUrl}/files/upload`, form, {
      headers: { Authorization: `Bearer ${cloudToken}`, ...form.getHeaders() },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })

    if (response.status < 200 || response.status >= 300) {
      const errorMsg = response.data?.detail ?? response.data?.error ?? `HTTP ${response.status}`
      return { success: false, error: errorMsg }
    }

    return { success: true, id: response.data.id, name: response.data.name, size: response.data.size }
  }
}
