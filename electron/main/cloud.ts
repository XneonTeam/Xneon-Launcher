import { app, ipcMain } from "electron"
import path from "path"
import fs from "fs"
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require("axios")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FormData = require("form-data")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require("adm-zip") as new () => { addLocalFolder(localPath: string): void; writeZip(outputPath: string): void }
import { ensureBuildIntentDir, getBuildIntentDirName } from "./builds"

const CLOUD_API_URL = process.env.CLOUD_API_URL || "http://localhost:3000/api"

export function registerCloudHandlers() {
  ipcMain.handle("cloud:login", async (_event, username: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> => {
    try {
      const res = await axios.post(`${CLOUD_API_URL}/auth/login`, { username, password }, { headers: { "Content-Type": "application/json" } })
      return { success: true, token: res.data.access_token }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("cloud:get-user", async (_event, token: string): Promise<{ success: boolean; user?: { id: string; username: string; email: string }; error?: string }> => {
    try {
      const res = await axios.get(`${CLOUD_API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, user: res.data.user || res.data }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("cloud:register", async (_event, username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await axios.post(`${CLOUD_API_URL}/auth/register`, { username, password })
      return { success: true }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("cloud:get-storage-info", async (_event, token: string) => {
    try {
      const res = await axios.get(`${CLOUD_API_URL}/files/storage/info`, { headers: { Authorization: `Bearer ${token}` } })
      return res.data
    } catch {
      return null
    }
  })

  ipcMain.handle("cloud:get-files", async (_event, token: string, category?: string): Promise<{ success: boolean; files?: any[]; error?: string }> => {
    try {
      const params = category ? `?category=${category}` : ""
      const res = await axios.get(`${CLOUD_API_URL}/files${params}`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, files: res.data.files || res.data || [] }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("cloud:delete-file", async (_event, token: string, fileId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await axios.delete(`${CLOUD_API_URL}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("cloud:download-file", async (_event, token: string, fileId: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const res = await axios.get(`${CLOUD_API_URL}/files/${fileId}/download`, { headers: { Authorization: `Bearer ${token}` }, responseType: "arraybuffer" })
      const filePath = path.join(app.getPath("temp"), fileName)
      fs.writeFileSync(filePath, Buffer.from(res.data))
      return { success: true, filePath }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("cloud:get-categories", async (_event, token: string): Promise<{ success: boolean; categories?: Record<string, { count: number; size: number }>; error?: string }> => {
    try {
      const res = await axios.get(`${CLOUD_API_URL}/files/categories`, { headers: { Authorization: `Bearer ${token}` } })
      return { success: true, categories: res.data.categories || {} }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e)
      return { success: false, error: msg }
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

      const response = await axios.post(`${CLOUD_API_URL}/files/upload`, form, {
        headers: { Authorization: `Bearer ${cloudToken}`, ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })

      if (response.status < 200 || response.status >= 300) {
        const errorMsg = response.data?.detail || response.data?.error || response.data?.message || `HTTP ${response.status}`
        throw new Error(errorMsg)
      }

      try { fs.unlinkSync(archivePath) } catch {}
      return { success: true }
    } catch (e: any) {
      const message = e?.response?.data?.detail || e?.response?.data?.error || e?.response?.data?.message || e?.message || String(e)
      return { success: false, error: message }
    }
  })

  ipcMain.handle("cloud:upload-file", async (_event, filePath: string, cloudToken: string, category: string): Promise<{ success: boolean; id?: string; name?: string; size?: number; error?: string }> => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: "Файл не найден" }
      const fileName = path.basename(filePath)
      const fileBuffer = fs.readFileSync(filePath)
      const form = new FormData()
      form.append("file", fileBuffer, { filename: fileName, contentType: "application/octet-stream" })
      form.append("category", category)

      const response = await axios.post(`${CLOUD_API_URL}/files/upload`, form, {
        headers: { Authorization: `Bearer ${cloudToken}`, ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })

      if (response.status < 200 || response.status >= 300) {
        const errorMsg = response.data?.detail || response.data?.error || `HTTP ${response.status}`
        return { success: false, error: errorMsg }
      }

      return { success: true, id: response.data.id, name: response.data.name, size: response.data.size }
    } catch (e: any) {
      const message = e?.response?.data?.detail || e?.response?.data?.error || e?.message || String(e)
      return { success: false, error: message }
    }
  })
}
