import { app, dialog, ipcMain } from "electron"
import path from "path"
import fs from "fs/promises"
import type {
  ModrinthVersionDetail,
  ModrinthManifestFile,
  CurseForgeManifestFile,
} from "@xnlc/mods" with { "resolution-mode": "import" }
import type { BuildExportCategory } from "@xnlc/types" with { "resolution-mode": "import" }
import { getMainWindow } from "../runtime"
import { getGameDir } from "../minecraft-core"
import { dbHelpers } from "../../db"
import {
  ensureBuildIntentDir,
  getBuildIntentDirName,
  getBuildIntentPath,
  getBaseDataRoot,
  getInstancesRoot,
  loadInstancesRoot,
  downloadBuffer,
  sanitizeFileName,
  sanitizeRelativeContentPath,
  getContentDirectoryName,
  saveRemoteContentToIntent,
  saveLocalContentToIntent,
  deleteContentFromIntent,
  sendImportProgress,
  runConcurrent,
  copyOverrideEntries,
  loadAdmZip,
  loadModsModule,
  isImportCancelledError,
  throwIfImportCancelled,
  startImportSession,
  finishImportSession,
  cancelImport,
  getLoaderSelectionFromModrinthDeps,
  getLoaderSelectionFromCurseManifest,
  type ScannedBuildContent,
  type ImportModEntry,
} from "./helpers"
import { scanIntentDir } from "./scanner"

export { ensureBuildIntentDir, getBuildIntentDirName, getBuildIntentPath, scanIntentDir }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function entryTopName(filename: string, buildDirName: string): string {
  const segments = filename.split("/").filter(Boolean)
  const isSelf = segments[0] === buildDirName || segments[0] === path.basename(buildDirName)
  const index = isSelf ? 1 : 0
  return segments[index] ?? ""
}

function entryCategory(topName: string): BuildExportCategory {
  switch (topName) {
    case "mods": return "mods"
    case "resourcepacks": return "resourcepacks"
    case "shaderpacks": return "shaderpacks"
    case "saves": return "saves"
  }
  if (topName === "logs" || topName === "crash-reports" || topName === ".cache" || topName === ".fabric" || topName === ".quilt") {
    return "logs"
  }
  return "data"
}

function matchExportCategory(filename: string, buildDirName: string, categories: BuildExportCategory[]): boolean {
  const topName = entryTopName(filename, buildDirName)
  if (!topName) return false
  return categories.includes(entryCategory(topName))
}

type ImportResult = {
  success: boolean
  error?: string
  cancelled?: boolean
  version?: string
  modLoader?: string
  loaderVersion?: string
  mods?: ImportModEntry[]
  resourcepacks?: ImportModEntry[]
  shaders?: ImportModEntry[]
  installedMods?: Record<string, string>
}

type OpenImportResult = ImportResult & {
  name?: string
  description?: string
  icon?: string
  source?: "modrinth" | "curseforge"
  intentPath?: string
}

export function registerBuildHandlers() {
  ipcMain.handle("build:cancel-import", async (): Promise<{ success: boolean }> => {
    return { success: cancelImport() }
  })

  ipcMain.handle("build:get-intent-path", async (_event, dirName: string): Promise<string> => ensureBuildIntentDir(dirName))

  ipcMain.handle("build:get-instances-root", async (): Promise<string> => getInstancesRoot())

  ipcMain.handle("build:set-instances-root", async (_event, newRoot: string): Promise<{ success: boolean; root?: string; error?: string }> => {
    try {
      const trimmed = (newRoot ?? "").trim()
      if (!trimmed) {
        await dbHelpers.setSetting("instancesPath", "")
        await loadInstancesRoot()
        return { success: true, root: getInstancesRoot() }
      }
      const absRoot = path.resolve(trimmed)
      await fs.mkdir(absRoot, { recursive: true })
      // If the default location still holds the intents folder, move it over so builds are preserved.
      const defaultIntents = path.join(getBaseDataRoot(), "intents")
      const targetIntents = path.join(absRoot, "intents")
      try {
        await fs.access(defaultIntents)
        await fs.access(targetIntents).catch(async () => {
          await fs.rename(defaultIntents, targetIntents)
        })
      } catch {}
      await dbHelpers.setSetting("instancesPath", absRoot)
      await loadInstancesRoot()
      return { success: true, root: getInstancesRoot() }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:save-mod-to-intent", async (_event, dirName: string, url: string, fileName: string): Promise<string | null> => {
    return await saveRemoteContentToIntent(dirName, "mod", url, fileName)
  })

  ipcMain.handle("build:save-local-mod-to-intent", async (_event, dirName: string, localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, "mod", localFilePath)
  })

  ipcMain.handle("build:save-content-to-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<string | null> => {
    return await saveRemoteContentToIntent(dirName, contentType, url, fileName)
  })

  ipcMain.handle("build:save-local-content-to-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string): Promise<string | null> => {
    return saveLocalContentToIntent(dirName, contentType, localFilePath)
  })

  ipcMain.handle("build:delete-content-from-intent", async (_event, dirName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string): Promise<{ success: boolean; error?: string }> => {
    return deleteContentFromIntent(dirName, contentType, fileName)
  })

  ipcMain.handle("build:set-intent-path", async (_event, dirName: string): Promise<void> => {
    await ensureBuildIntentDir(dirName)
  })

  ipcMain.handle("build:rename-intent", async (_event, oldName: string, newName: string): Promise<{ success: boolean; intentPath?: string; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const oldSafeName = getBuildIntentDirName(oldName)
      const newSafeName = getBuildIntentDirName(newName)
      const oldIntentPath = path.join(baseDataRoot, "intents", oldSafeName)
      const newIntentPath = path.join(baseDataRoot, "intents", newSafeName)
      if (oldIntentPath === newIntentPath) return { success: true, intentPath: newIntentPath }
      // Nothing to rename if the source dir doesn't exist yet (not launched).
      const srcExists = await fs.access(oldIntentPath).then(() => true).catch(() => false)
      if (!srcExists) return { success: true, intentPath: newIntentPath }
      const dstExists = await fs.access(newIntentPath).then(() => true).catch(() => false)
      if (dstExists) return { success: false, error: "Папка сборки с таким именем уже существует" }
      await fs.rename(oldIntentPath, newIntentPath).catch(async () => {
        await fs.cp(oldIntentPath, newIntentPath, { recursive: true })
        await fs.rm(oldIntentPath, { recursive: true, force: true })
      })
      return { success: true, intentPath: newIntentPath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:delete-intent", async (_event, dirName: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      try { await fs.access(intentPath); await fs.rm(intentPath, { recursive: true, force: true }) } catch {}
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:move-intent-to-trash", async (_event, dirName: string): Promise<{ success: boolean; trashName?: string; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      await fs.access(intentPath)
      const trashRoot = path.join(baseDataRoot, "intents", ".trash")
      await fs.mkdir(trashRoot, { recursive: true })
      const trashName = `${Date.now()}-${safeName}`
      await fs.rename(intentPath, path.join(trashRoot, trashName)).catch(async () => {
        await fs.cp(intentPath, path.join(trashRoot, trashName), { recursive: true })
        await fs.rm(intentPath, { recursive: true, force: true })
      })
      return { success: true, trashName }
    } catch (error) {
      // Intent dir may not exist yet — still a valid "trash" (nothing to move).
      return { success: true, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:restore-intent-from-trash", async (_event, dirName: string, trashName: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseDataRoot = getInstancesRoot()
      const safeName = getBuildIntentDirName(dirName)
      const trashPath = path.join(baseDataRoot, "intents", ".trash", trashName)
      await fs.access(trashPath)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      await fs.mkdir(path.dirname(intentPath), { recursive: true })
      await fs.rename(trashPath, intentPath).catch(async () => {
        await fs.cp(trashPath, intentPath, { recursive: true })
        await fs.rm(trashPath, { recursive: true, force: true })
      })
      return { success: true }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: true }
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:purge-trash", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const trashPath = path.join(getInstancesRoot(), "intents", ".trash")
      await fs.rm(trashPath, { recursive: true, force: true }).catch(() => {})
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:copy", async (_event, dirName: string, newName: string): Promise<{ success: boolean; intentPath?: string; error?: string }> => {
    try {
      const srcIntentPath = await ensureBuildIntentDir(dirName)
      const newIntentPath = await ensureBuildIntentDir(newName)
      // Remove any pre-existing (empty) target dirs first, then deep-copy the source.
      await fs.rm(newIntentPath, { recursive: true, force: true }).catch(() => {})
      await fs.cp(srcIntentPath, newIntentPath, { recursive: true })
      return { success: true, intentPath: newIntentPath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:export-zip", async (_event, dirName: string, buildNameLabel: string, categories?: BuildExportCategory[]): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: "Окно недоступно" }
      const intentPath = await ensureBuildIntentDir(dirName)
      const picked = await dialog.showSaveDialog(win, {
        title: "Экспорт сборки",
        defaultPath: `${sanitizeFileName(buildNameLabel || dirName)}.zip`,
        filters: [{ name: "Zip архив", extensions: ["zip"] }],
      })
      if (picked.canceled || !picked.filePath) return { success: false, error: "Экспорт отменён" }

      const AdmZip = await loadAdmZip()
      const zip = new AdmZip()

      // Prism Launcher excludes logs, crash-reports and caches when exporting (ExportInstanceDialog.cpp).
      const LOG_ENTRIES = new Set(["logs", "crash-reports", ".cache", ".fabric", ".quilt"])
      const includeLogs = categories == null || categories.includes("logs")

      // `addLocalFolder` passes full zip paths like `<build>/<relative path>`; we need the
      // top-level entry name (the first segment after the build folder) to decide inclusion.
      zip.addLocalFolder(intentPath, path.basename(intentPath), (filename: string) => {
        if (categories == null) {
          return !LOG_ENTRIES.has(entryTopName(filename, path.basename(intentPath)))
        }
        return matchExportCategory(filename, path.basename(intentPath), categories)
      })
      await fs.writeFile(picked.filePath, zip.toBuffer())
      return { success: true, path: picked.filePath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:export-modlist", async (_event, dirName: string, buildNameLabel: string, format: "html" | "markdown" | "json" | "csv" | "plaintext"): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: "Окно недоступно" }
      const intentPath = await ensureBuildIntentDir(dirName)
      const scanned = await scanIntentDir(intentPath)
      const mods = scanned.mods ?? []
      const label = buildNameLabel || dirName

      const extMap: Record<string, string> = { html: "html", markdown: "md", json: "json", csv: "csv", plaintext: "txt" }
      const picked = await dialog.showSaveDialog(win, {
        title: "Экспорт списка модов",
        defaultPath: `${sanitizeFileName(label)}-mods.${extMap[format] ?? "txt"}`,
        filters: [{ name: "Файл", extensions: [extMap[format] ?? "txt"] }],
      })
      if (picked.canceled || !picked.filePath) return { success: false, error: "Экспорт отменён" }

      const rows = mods.map((m, i) => ({
        index: i + 1,
        name: m.name ?? "",
        slug: m.slug ?? "",
        version: m.version ?? "",
        author: m.author ?? "",
      }))

      let content = ""
      if (format === "json") {
        content = JSON.stringify({ build: label, exportedAt: new Date().toISOString(), mods: rows }, null, 2)
      } else if (format === "csv") {
        content = ["#;Name;Slug;Version;Author", ...rows.map(r => `${r.index};${r.name};${r.slug};${r.version};${r.author}`)].join("\n")
      } else if (format === "html") {
        content = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${label} — моды</title><style>body{font-family:sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.4rem;text-align:left}th{background:#f4f4f4}</style></head><body><h1>${label}</h1><table><thead><tr><th>#</th><th>Название</th><th>Slug</th><th>Версия</th><th>Автор</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.index}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.slug)}</td><td>${escapeHtml(r.version)}</td><td>${escapeHtml(r.author)}</td></tr>`).join("")}</tbody></table></body></html>`
      } else {
        content = [
          `Моды сборки «${label}»`,
          `Экспортировано: ${new Date().toLocaleString("ru-RU")}`,
          "",
          ...rows.map(r => `${r.index}. ${r.name}${r.version && r.version !== "local" ? ` — ${r.version}` : ""}${r.author ? ` (${r.author})` : ""}`),
        ].join("\n")
      }

      await fs.writeFile(picked.filePath, content, "utf-8")
      return { success: true, path: picked.filePath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("build:scan-intent-content", async (_event, dirName: string): Promise<ScannedBuildContent> => {
    try {
      const intentPath = await ensureBuildIntentDir(dirName)
      return await scanIntentDir(intentPath)
    } catch {
      return { mods: [], resourcepacks: [], shaders: [], installedMods: {} }
    }
  })

  ipcMain.handle(
    "content:install-remote",
    async (_event, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        const gameDir = await getGameDir()
        const targetDir = path.join(gameDir, getContentDirectoryName(contentType))
        await fs.mkdir(targetDir, { recursive: true }).catch(() => {})
        const safeFileName = sanitizeFileName(fileName)
        const filePath = path.join(targetDir, safeFileName)
        await fs.writeFile(filePath, await downloadBuffer(url))
        return { success: true, filePath }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle("build:import-modrinth", async (_event, buildName: string, projectSlug: string, versionId?: string): Promise<ImportResult> => {
    const signal = startImportSession()
    try {
      const intentPath = await ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение версий...")
      const mods = await loadModsModule()
      const versions = await mods.modrinthGetRawVersions(projectSlug)
      throwIfImportCancelled(signal)

      let version: ModrinthVersionDetail | undefined = versionId ? versions.find((v) => v.id === versionId) : undefined
      if (!version) version = versions.find((v) => v.version_type === "release") ?? versions[0]
      if (!version) throw new Error("Версии не найдены")

      const mrpackFile = version.files?.find((f: { filename?: string }) => f.filename?.endsWith(".mrpack"))
      if (!mrpackFile) throw new Error(".mrpack файл не найден")

      if (!mrpackFile?.url) throw new Error("URL для .mrpack файла не найден")
      sendImportProgress(0, 100, "Скачивание пакета...")
      const AdmZip = await loadAdmZip()
      const zip = new AdmZip(await downloadBuffer(mrpackFile.url, signal))
      const indexEntry = zip.getEntry("modrinth.index.json")
      if (!indexEntry) throw new Error("modrinth.index.json не найден")
      const index = JSON.parse(indexEntry.getData().toString("utf-8"))
      throwIfImportCancelled(signal)

      const files: ModrinthManifestFile[] = (index.files as ModrinthManifestFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
      const gameVersion: string = version.game_versions?.[0] ?? index.dependencies?.minecraft ?? ""
      const deps: Record<string, string> = index.dependencies ?? {}
      const loaderSelection = getLoaderSelectionFromModrinthDeps(deps)
      let modLoader = loaderSelection.modLoader
      const loaderVersion = loaderSelection.loaderVersion
      if (deps["fabric-loader"]) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (deps["quilt-loader"]) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      let downloaded = 0
      const totalFiles = files.length
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} файлов...`)
      const tasks = files.map((f: ModrinthManifestFile) => async () => {
        const currentFileName = path.basename(f.path ?? "")
        try {
          throwIfImportCancelled(signal)
          const fileDir = path.join(intentPath, path.dirname(f.path ?? ""))
          const filePath = path.join(fileDir, currentFileName)
          await fs.mkdir(fileDir, { recursive: true }).catch(() => {})
          try { await fs.access(filePath) } catch {
            const url = f.downloads?.[0]
            if (!url) throw new Error(`Не найдена ссылка для ${currentFileName}`)
            sendImportProgress(downloaded, totalFiles, "Скачивание файла...", currentFileName)
            await fs.writeFile(filePath, await downloadBuffer(url, signal))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${currentFileName}`, currentFileName)
          throw new Error(`Не удалось скачать ${currentFileName}: ${message}`)
        } finally {
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} файлов`, currentFileName)
        }
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      await copyOverrideEntries(zip, intentPath)
      const scanned = await scanIntentDir(intentPath)
      sendImportProgress(totalFiles, totalFiles, "Готово!")
      return { success: true, version: gameVersion, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      finishImportSession(signal)
    }
  })

  ipcMain.handle("build:import-curseforge", async (_event, buildName: string, modId: number, fileId: number): Promise<ImportResult> => {
    const signal = startImportSession()
    try {
      const intentPath = await ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение ссылки...")
      const mods = await loadModsModule()
      const zipUrl = await mods.curseforgeGetDownloadUrl(modId, fileId)
      throwIfImportCancelled(signal)
      if (!zipUrl) throw new Error("Ссылка на скачивание недоступна")

      sendImportProgress(0, 100, "Скачивание пакета...")
      const AdmZip = await loadAdmZip()
      const zip = new AdmZip(await downloadBuffer(zipUrl, signal))
      const manifestEntry = zip.getEntry("manifest.json")
      if (!manifestEntry) throw new Error("manifest.json не найден")
      const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))
      throwIfImportCancelled(signal)

      const mcVersion: string = manifest.minecraft?.version ?? ""
      const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeManifestFile) => m.primary)?.id ?? ""
      const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
      let modLoader = loaderSelection.modLoader
      const loaderVersion = loaderSelection.loaderVersion
      if (loaderRaw.startsWith("fabric")) modLoader = "fabric"
      else if (loaderRaw.startsWith("quilt")) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      const modsDir = path.join(intentPath, "mods")
      await fs.mkdir(modsDir, { recursive: true }).catch(() => {})

      const files: { projectID: number; fileID: number }[] = manifest.files ?? []
      const totalFiles = files.length
      let downloaded = 0
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} модов...`)
      const tasks = files.map((f: CurseForgeManifestFile) => async () => {
        let fileName = `mod-${f.fileID}.jar`
        try {
          throwIfImportCancelled(signal)
          const fileUrl = await mods.curseforgeGetDownloadUrl(f.projectID!, f.fileID!)
          if (!fileUrl) throw new Error(`Не получена ссылка для ${fileName}`)
          fileName = fileUrl.split("/").pop()?.split("?")[0] ?? fileName
          sendImportProgress(downloaded, totalFiles, "Скачивание мода...", fileName)
          const filePath = path.join(modsDir, fileName)
          try { await fs.access(filePath) } catch {
            await fs.writeFile(filePath, await downloadBuffer(fileUrl, signal))
          }
        } catch (error) {
          if (isImportCancelledError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${fileName}`, fileName)
          throw new Error(`Не удалось скачать ${fileName}: ${message}`)
        }
        downloaded++
        sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} модов`, fileName)
      })
      await runConcurrent(tasks, 5, signal)
      throwIfImportCancelled(signal)
      await copyOverrideEntries(zip, intentPath)
      const scanned = await scanIntentDir(intentPath)
      sendImportProgress(totalFiles, totalFiles, "Готово!")
      return { success: true, version: mcVersion, modLoader, loaderVersion, ...scanned }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      finishImportSession(signal)
    }
  })

  ipcMain.handle("build:open-and-import", async (): Promise<OpenImportResult> => {
    const signal = startImportSession()
    try {
      const win = getMainWindow()
      if (!win) return { success: false, error: "Окно недоступно" }

      const picked = await dialog.showOpenDialog(win, {
        title: "Импорт модпака",
        properties: ["openFile"],
        filters: [{ name: "Modpacks", extensions: ["mrpack", "zip"] }],
      })
      if (picked.canceled || picked.filePaths.length === 0) return { success: false, error: "Импорт отменён" }

      const selectedFile = picked.filePaths[0]
      throwIfImportCancelled(signal)
      const AdmZip = await loadAdmZip()
      const fileData = await fs.readFile(selectedFile)
      const zip = new AdmZip(fileData)
      const mrpackIndex = zip.getEntry("modrinth.index.json")
      const manifestEntry = zip.getEntry("manifest.json")

      if (mrpackIndex) {
        const index = JSON.parse(mrpackIndex.getData().toString("utf-8"))
        const buildName = index.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const intentPath = await ensureBuildIntentDir(buildName)
        const files: ModrinthManifestFile[] = (index.files as ModrinthManifestFile[] ?? []).filter((f) => f.env?.client !== "unsupported")
        const deps: Record<string, string> = index.dependencies ?? {}
        const version = deps.minecraft ?? ""
        const loaderSelection = getLoaderSelectionFromModrinthDeps(deps)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
        if (deps["fabric-loader"]) {
          modLoader = "fabric"
          sendImportProgress(0, 100, "Установка Fabric...")
        } else if (deps["quilt-loader"]) {
          modLoader = "quilt"
          sendImportProgress(0, 100, "Установка Quilt...")
        }

        let downloaded = 0
        const totalFiles = files.length
        sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} файлов...`)
        const tasks = files.map((f: ModrinthManifestFile) => async () => {
          const currentFileName = path.basename(f.path ?? "")
          try {
            const fileDir = path.join(intentPath, path.dirname(f.path ?? ""))
            const filePath = path.join(intentPath, f.path ?? "")
            await fs.mkdir(fileDir, { recursive: true }).catch(() => {})
            try { await fs.access(filePath) } catch {
              const url = f.downloads?.[0]
              if (!url) throw new Error(`Не найдена ссылка для ${currentFileName}`)
              sendImportProgress(downloaded, totalFiles, "Скачивание файла...", currentFileName)
              await fs.writeFile(filePath, await downloadBuffer(url, signal))
            }
          } catch (error) {
            if (isImportCancelledError(error)) {
              throw error
            }
            const message = error instanceof Error ? error.message : String(error)
            sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${currentFileName}`, currentFileName)
            throw new Error(`Не удалось скачать ${currentFileName}: ${message}`)
          } finally {
            downloaded++
            sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} файлов`, currentFileName)
          }
        })
        await runConcurrent(tasks, 5, signal)
        throwIfImportCancelled(signal)
        await copyOverrideEntries(zip, intentPath)
        const scanned = await scanIntentDir(intentPath)

        let mrIcon = ""
        try {
          const projectSlug = index.slug ?? buildName.toLowerCase().replace(/\s+/g, "-")
          const mods = await loadModsModule()
          const projectInfo = await mods.modrinthGetProjectInfo(projectSlug)
          mrIcon = projectInfo?.iconUrl ?? ""
        } catch {}

        return {
          success: true,
          name: buildName,
          description: index.summary ?? "",
          icon: mrIcon,
          version,
          modLoader,
          loaderVersion,
          source: "modrinth",
          intentPath,
          ...scanned,
        }
      }

      if (manifestEntry) {
        const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))
        const buildName = manifest.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const intentPath = await ensureBuildIntentDir(buildName)
        const version: string = manifest.minecraft?.version ?? ""
        const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: CurseForgeManifestFile) => m.primary)?.id ?? ""
        const loaderSelection = getLoaderSelectionFromCurseManifest(loaderRaw)
        let modLoader = loaderSelection.modLoader
        const loaderVersion = loaderSelection.loaderVersion
        if (loaderRaw.startsWith("fabric")) {
          modLoader = "fabric"
          sendImportProgress(0, 100, "Установка Fabric...")
        } else if (loaderRaw.startsWith("quilt")) {
          modLoader = "quilt"
          sendImportProgress(0, 100, "Установка Quilt...")
        }

        const modsDir = path.join(intentPath, "mods")
        await fs.mkdir(modsDir, { recursive: true }).catch(() => {})

        const files: { projectID: number; fileID: number }[] = manifest.files ?? []
        const totalFiles = files.length
        let downloaded = 0
        sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} модов...`)
        const tasks = files.map((f: CurseForgeManifestFile) => async () => {
          let fileName = `mod-${f.fileID}.jar`
          try {
            const mods = await loadModsModule()
            const fileUrl = await mods.curseforgeGetDownloadUrl(f.projectID!, f.fileID!)
            if (!fileUrl) throw new Error(`Не получена ссылка для ${fileName}`)
            fileName = fileUrl.split("/").pop()?.split("?")[0] ?? fileName
            sendImportProgress(downloaded, totalFiles, "Скачивание мода...", fileName)
            const filePath = path.join(modsDir, fileName)
            try { await fs.access(filePath) } catch {
              await fs.writeFile(filePath, await downloadBuffer(fileUrl, signal))
            }
          } catch (error) {
            if (isImportCancelledError(error)) {
              throw error
            }
            const message = error instanceof Error ? error.message : String(error)
            sendImportProgress(downloaded, totalFiles, `Ошибка загрузки ${fileName}`, fileName)
            throw new Error(`Не удалось скачать ${fileName}: ${message}`)
          }
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} модов`, fileName)
        })
        await runConcurrent(tasks, 5, signal)
        throwIfImportCancelled(signal)
        await copyOverrideEntries(zip, intentPath)
        const scanned = await scanIntentDir(intentPath)

        let cfIcon = ""
        try {
          const mods = await loadModsModule()
          const cfSearch = await mods.curseforgeSearch(buildName, { page: 0 })
          cfIcon = cfSearch.results?.[0]?.iconUrl ?? ""
        } catch {}

        return {
          success: true,
          name: buildName,
          description: manifest.summary ?? manifest.author ?? "",
          icon: cfIcon,
          version,
          modLoader,
          loaderVersion,
          source: "curseforge",
          intentPath,
          ...scanned,
        }
      }

      return { success: false, error: "Неизвестный формат модпака" }
    } catch (e) {
      if (isImportCancelledError(e)) {
        return { success: false, cancelled: true, error: "Импорт отменен" }
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      finishImportSession(signal)
    }
  })
}
