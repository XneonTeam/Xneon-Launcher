import { app, ipcMain } from "electron"
import path from "path"
import fs from "fs"
import axios from "axios"
import FormData from "form-data"
import AdmZip from "adm-zip"
import { ensureBuildIntentDir, getBuildIntentDirName } from "./builds"
import { getCloudApiUrl } from "./config"

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
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail ?? error.response?.data?.error ?? error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function registerCloudHandlers() {
  ipcMain.handle("cloud:login", async (_event, username: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const res = await axios.post(`${baseUrl}/auth/login`, { username, password }, { headers: { "Content-Type": "application/json" } })
      return { success: true, token: res.data.token }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:get-user", async (_event, token: string): Promise<{ success: boolean; user?: CloudUser; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const res = await axios.get(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, user: res.data.user ?? res.data }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:register", async (_event, username: string, password: string, email?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      await axios.post(`${baseUrl}/auth/register`, { username, password, email })
      return { success: true }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:get-storage-info", async (_event, token: string): Promise<StorageInfo | null> => {
    try {
      const baseUrl = await cloudApiUrl()
      const res = await axios.get(`${baseUrl}/files/storage/info`, { headers: { Authorization: `Bearer ${token}` } })
      return res.data as StorageInfo
    } catch {
      return null
    }
  })

  ipcMain.handle("cloud:get-files", async (_event, token: string, category?: string): Promise<{ success: boolean; files?: CloudFile[]; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
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
      await axios.delete(`${baseUrl}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:download-file", async (_event, token: string, fileId: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const res = await axios.get(`${baseUrl}/files/${fileId}/download`, { headers: { Authorization: `Bearer ${token}` }, responseType: "arraybuffer" })
      const filePath = path.join(app.getPath("temp"), fileName)
      fs.writeFileSync(filePath, Buffer.from(res.data))
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:get-categories", async (_event, token: string): Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }> => {
    try {
      const baseUrl = await cloudApiUrl()
      const res = await axios.get(`${baseUrl}/files/categories`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, categories: res.data.categories ?? {} }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("build:upload-to-cloud", async (_event, buildName: string, cloudToken: string, category: string = "instance"): Promise<{ success: boolean; error?: string }> => {
    try {
      const intentPath = ensureBuildIntentDir(buildName)
      if (!fs.existsSync(intentPath)) return { success: false, error: "Сборка не найдена" }

      const zip = new AdmZip()
      zip.addLocalFolder(intentPath)
      const safeName = getBuildIntentDirName(buildName)
      const archivePath = path.join(app.getPath("temp"), `${safeName}.zip`)
      zip.writeZip(archivePath)

      const fileBuffer = fs.readFileSync(archivePath)
      const form = new FormData()
      form.append("file", fileBuffer, {
        filepath: `${safeName}.zip`,
        contentType: "application/zip",
        knownLength: fileBuffer.length,
      })
      form.append("name", buildName)
      form.append("category", category)

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

      try { fs.unlinkSync(archivePath) } catch {}
      return { success: true }
    } catch (e) {
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  ipcMain.handle("cloud:upload-account-data", async (_event, cloudToken: string, account: { id: string; type: string; username: string; uuid?: string }): Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }> => {
    try {
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
    if (!fs.existsSync(filePath)) return { success: false, error: "Файл не найден" }
    const fileName = path.basename(filePath)
    const fileBuffer = fs.readFileSync(filePath)
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
