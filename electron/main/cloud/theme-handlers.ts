import { ipcMain, app } from "electron"
import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { dbHelpers } from "../../db"
import { sendToRenderer } from "../runtime"
import { opFailure } from "../errors"
import { getProvider, type CloudProviderId } from "./registry"
import { createThemeBundle, restoreThemeBundle, readThemeBundlePreview } from "./theme-bundle"

const previewCache = new Map<string, ReturnType<typeof readThemeBundlePreview>>()

/** Читаем только манифест, не устанавливая тему и не извлекая её медиа. */
export async function cloudThemePreview(providerId: CloudProviderId, file: { path: string; size: number; modifiedAt?: string }) {
  const key = JSON.stringify([providerId, file.path, file.size, file.modifiedAt])
  const cached = previewCache.get(key)
  if (cached) return cached
  if (file.size > 512 * 1024 * 1024) return undefined
  const temporary = await fs.mkdtemp(path.join(app.getPath("temp"), "xneon-preview-"))
  try {
    const local = path.join(temporary, "theme.xntheme")
    const result = await getProvider(providerId).downloadFile(file.path, local)
    if (!result.success) throw new Error(result.error || "Theme preview download failed")
    if ((await fs.stat(local)).size > 512 * 1024 * 1024) throw new Error("Theme archive exceeds size limit")
    const preview = readThemeBundlePreview(await fs.readFile(local))
    if (previewCache.size >= 64) previewCache.delete(previewCache.keys().next().value!)
    previewCache.set(key, preview)
    return preview
  } catch (error) {
    console.warn("[Cloud] Theme preview failed:", providerId, file.path, error)
    return undefined
  }
  finally { await fs.rm(temporary, { recursive: true, force: true }).catch(() => {}) }
}

function themeList(raw: string | undefined): Array<Record<string, unknown>> {
  const themes = JSON.parse(raw || "[]")
  if (!Array.isArray(themes)) throw new Error("Invalid custom themes storage")
  return themes
}

export function registerCloudThemeHandlers() {
  let importQueue: Promise<unknown> = Promise.resolve()
  ipcMain.handle("cloud:upload-theme", async (_event, providerId: CloudProviderId, themeId: string, uploadId?: string) => {
    let temporary: string | undefined
    try {
      const theme = themeList(await dbHelpers.getSetting("customThemes")).find(theme => theme.id === themeId)
      if (!theme) throw new Error("Custom theme not found")
      const provider = getProvider(providerId)
      if (!await provider.isAuthenticated()) throw new Error("Cloud provider is not connected")
      temporary = await fs.mkdtemp(path.join(app.getPath("temp"), "xneon-theme-"))
      const id = uploadId || randomUUID()
      const progress = (percent: number, stage: "zip" | "upload") => sendToRenderer("cloud:upload-progress", { id, percent, stage })
      progress(0, "zip")
      const buffer = await createThemeBundle(theme, path.join(app.getPath("userData"), "theme-media"))
      const safeId = String(theme.id).replace(/[^a-z0-9_-]/gi, "_").slice(0, 100)
      const name = String(theme.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80)
      const fileName = `${name}-${safeId}.xntheme`
      const file = path.join(temporary, fileName)
      await fs.writeFile(file, buffer)
      progress(100, "zip")
      await provider.ensureBaseFolder()
      const result = await provider.uploadFile(file, `themes/${fileName}`, percent => progress(percent, "upload"))
      if (result.success) progress(100, "upload")
      return result
    } catch (error) { return opFailure(error) }
    finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {}) }
  })
  ipcMain.handle("cloud:import-theme", async (_event, providerId: CloudProviderId, remotePath: string) => {
    let temporary: string | undefined
    try {
      const provider = getProvider(providerId)
      temporary = await fs.mkdtemp(path.join(app.getPath("temp"), "xneon-theme-"))
      const file = path.join(temporary, "theme.xntheme")
      const result = await provider.downloadFile(remotePath, file)
      if (!result.success) return { success: false, error: result.error }
      if ((await fs.stat(file)).size > 512 * 1024 * 1024) throw new Error("Theme archive exceeds size limit")
      const theme = await restoreThemeBundle(await fs.readFile(file), path.join(app.getPath("userData"), "theme-media"))
      // Новая запись не перезаписывает одноимённую тему на другом устройстве.
      const imported = { ...theme, id: `custom-cloud-${randomUUID()}`, custom: true, createdAt: Date.now(), updatedAt: Date.now() }
      const save = importQueue.then(async () => {
        const themes = themeList(await dbHelpers.getSetting("customThemes"))
        const value = JSON.stringify([...themes, imported])
        await dbHelpers.setSetting("customThemes", value)
        sendToRenderer("settings:updated", { key: "customThemes", value })
        return { success: true, id: imported.id, name: imported.name }
      })
      importQueue = save.catch(() => {})
      return await save
    } catch (error) { return opFailure(error) }
    finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {}) }
  })
}
