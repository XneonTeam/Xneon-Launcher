import { app, dialog, ipcMain } from "electron"
import path from "path"
import fs from "fs/promises"
import type {
  ModrinthVersionDetail,
  ModrinthManifestFile,
  CurseForgeManifestFile,
} from "@xnlc/mods" with { "resolution-mode": "import" }
import { getMainWindow } from "../runtime"
import { getGameDir } from "../minecraft-core"
import {
  ensureBuildIntentDir,
  getBuildIntentDirName,
  getBuildIntentPath,
  getBaseDataRoot,
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

  ipcMain.handle("build:delete-intent", async (_event, dirName: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseDataRoot = getBaseDataRoot()
      const safeName = getBuildIntentDirName(dirName)
      const intentPath = path.join(baseDataRoot, "intents", safeName)
      try { await fs.access(intentPath); await fs.rm(intentPath, { recursive: true, force: true }) } catch {}
      return { success: true }
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
