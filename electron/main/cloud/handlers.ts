import { ipcMain, shell, app } from "electron"
import path from "path"
import fs from "fs/promises"
import { Worker } from "worker_threads"
import { getProvider, listProviders, type CloudProviderId } from "./registry"
import { ensureBuildIntentDir, getBuildIntentDirName } from "../builds"
import { dbHelpers } from "../../db"
import { sendToRenderer } from "../runtime"

function sendUploadProgress(id: string, percent: number, stage: "zip" | "upload") {
  sendToRenderer("cloud:upload-progress", { id, percent, stage })
}

async function createBuildZipInWorker(intentPath: string, archivePath: string, id: string): Promise<void> {
  const workerPath = path.join(__dirname, "upload-worker.js")
  const worker = new Worker(workerPath, { workerData: { intentPath, archivePath } })
  return new Promise((resolve, reject) => {
    worker.on("message", (msg) => {
      if (msg?.type === "zip-progress") {
        sendUploadProgress(id, msg.percent, "zip")
      } else if (msg?.type === "zip-done") {
        if (msg.result?.ok) resolve()
        else reject(new Error(msg.result?.error ?? "Zip failed"))
      }
    })
    worker.on("error", reject)
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Zip worker exited with code ${code}`))
      else resolve()
    })
  })
}

export function registerCloudHandlers() {
  ipcMain.handle("cloud:list-providers", () => {
    return listProviders()
  })

  ipcMain.handle("cloud:connect", async (_event, providerId: CloudProviderId, authData?: Record<string, string>) => {
    try {
      const provider = getProvider(providerId)
      const result = await provider.authenticate(authData)
      if (result.success) {
        try { await provider.ensureBaseFolder() } catch (e) { console.error("[Cloud] ensureBaseFolder failed:", e) }
      }
      return result
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:is-connected", async (_event, providerId: CloudProviderId) => {
    try {
      const provider = getProvider(providerId)
      return await provider.isAuthenticated()
    } catch { return false }
  })

  ipcMain.handle("cloud:disconnect", async (_event, providerId: CloudProviderId) => {
    try {
      const provider = getProvider(providerId)
      await provider.logout()
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:list-files", async (_event, providerId: CloudProviderId, folderPath?: string) => {
    try {
      const provider = getProvider(providerId)
      const result = await provider.listFiles(folderPath)
      return result
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:upload-file", async (_event, providerId: CloudProviderId, localPath: string, remotePath: string) => {
    try {
      const provider = getProvider(providerId)
      const id = `file-${path.basename(localPath)}`
      sendUploadProgress(id, 0, "upload")
      const result = await provider.uploadFile(localPath, remotePath, (percent) => {
        sendUploadProgress(id, percent, "upload")
      })
      sendUploadProgress(id, 100, "upload")
      return result
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:download-file", async (_event, providerId: CloudProviderId, remotePath: string, localPath: string) => {
    try {
      const provider = getProvider(providerId)
      return await provider.downloadFile(remotePath, localPath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:delete-file", async (_event, providerId: CloudProviderId, remotePath: string) => {
    try {
      const provider = getProvider(providerId)
      return await provider.deleteFile(remotePath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:get-quota", async (_event, providerId: CloudProviderId) => {
    try {
      const provider = getProvider(providerId)
      return await provider.getStorageQuota()
    } catch { return null }
  })

  ipcMain.handle("cloud:upload-build", async (_event, providerId: CloudProviderId, buildName: string, uploadId?: string) => {
    try {
      const intentPath = await ensureBuildIntentDir(buildName)
      try { await fs.access(intentPath) } catch { return { success: false, error: "Сборка не найдена" } }

      const safeName = getBuildIntentDirName(buildName)
      const archivePath = path.join(app.getPath("temp"), `${safeName}.zip`)
      const id = uploadId ?? `build-${safeName}`

      sendUploadProgress(id, 0, "zip")
      await createBuildZipInWorker(intentPath, archivePath, id)

      const provider = getProvider(providerId)
      const result = await provider.uploadFile(archivePath, `builds/${safeName}.zip`, (percent) => {
        sendUploadProgress(id, percent, "upload")
      })

      try { await fs.unlink(archivePath) } catch { /* noop */ }
      sendUploadProgress(id, 100, "upload")
      return result
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:upload-account", async (_event, providerId: CloudProviderId, account: { id: string; type: string; username: string; uuid?: string }) => {
    try {
      const jsonPath = path.join(app.getPath("temp"), `${account.username}.json`)
      await fs.writeFile(jsonPath, JSON.stringify(account, null, 2))
      const provider = getProvider(providerId)
      const id = account.id
      sendUploadProgress(id, 0, "upload")
      const result = await provider.uploadFile(jsonPath, `accounts/${account.username}.json`, (percent) => {
        sendUploadProgress(id, percent, "upload")
      })
      try { await fs.unlink(jsonPath) } catch { /* noop */ }
      sendUploadProgress(id, 100, "upload")
      return result
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("cloud:download-and-import", async (_event, providerId: CloudProviderId, remotePath: string, fileType: string) => {
    try {
      const provider = getProvider(providerId)
      const fileName = path.basename(remotePath)
      const localPath = path.join(app.getPath("temp"), fileName)
      const dlResult = await provider.downloadFile(remotePath, localPath)
      if (!dlResult.success) return { success: false, error: dlResult.error }

      if (fileType === "account") {
        const text = await fs.readFile(localPath, "utf-8")
        const account = JSON.parse(text) as { id: string; type: string; username: string; uuid?: string }
        try { await fs.unlink(localPath) } catch { /* noop */ }
        return { success: true, account }
      } else if (fileType === "instance") {
        const buildName = fileName.replace(/\.zip$/i, "")
        const AdmZip = (await import("adm-zip")).default
        const buffer = await fs.readFile(localPath)
        const intentPath = await ensureBuildIntentDir(buildName)
        const zip = new AdmZip(buffer)
        zip.extractAllTo(intentPath, true)

        const existingBuilds = await dbHelpers.loadBuilds()
        existingBuilds.push({
          id: `cloud-${Date.now()}`,
          name: buildName,
          description: "",
          version: "1.0",
          modLoader: "",
          icon: "",
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
        try { await fs.unlink(localPath) } catch { /* noop */ }
        return { success: true }
      }

      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
