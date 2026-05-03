import { app, dialog, ipcMain } from "electron"
import path from "path"
import fs from "fs"
import { cfFetch } from "./curseforge"
import { getMainWindow, sendToRenderer } from "./runtime"

type ImportResult = { success: boolean; error?: string; version?: string; modLoader?: string }

type OpenImportResult = ImportResult & {
  name?: string
  description?: string
  icon?: string
  source?: "modrinth" | "curseforge"
  intentPath?: string
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require("adm-zip") as new (data?: Buffer) => {
  getEntries(): { entryName: string; isDirectory: boolean; getData(): Buffer }[]
  getEntry(name: string): { getData(): Buffer } | null
  addLocalFolder(localPath: string, readstream?: unknown): void
  writeZip(outputPath: string, keepOrder?: boolean): void
  toBuffer(): Buffer
}

export function getBaseDataRoot(): string {
  if (process.platform === "win32") return path.join(app.getPath("appData"), "xneonlauncher")
  if (process.platform === "darwin") return path.join(app.getPath("home"), "Library", "Application Support", "xneonlauncher")
  return path.join(app.getPath("home"), ".xneonlauncher")
}

export function getBuildIntentDirName(rawName: string): string {
  return rawName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ _-]/g, "_") || "unnamed-build"
}

export function ensureBuildIntentDir(dirName: string): string {
  const baseDataRoot = getBaseDataRoot()
  const safeName = getBuildIntentDirName(dirName)
  const intentPath = path.join(baseDataRoot, "intents", safeName)
  if (!fs.existsSync(intentPath)) fs.mkdirSync(intentPath, { recursive: true })
  const modsPath = path.join(intentPath, "mods")
  if (!fs.existsSync(modsPath)) fs.mkdirSync(modsPath, { recursive: true })
  return intentPath
}

export async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

export function sendImportProgress(current: number, total: number, message: string) {
  sendToRenderer("import:progress", { current, total, message })
}

export async function runConcurrent<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency).map(fn => fn())
    results.push(...await Promise.all(batch))
  }
  return results
}

function copyOverrideEntries(zip: InstanceType<typeof AdmZip>, intentPath: string) {
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("overrides/") && !entry.isDirectory) {
      const relPath = entry.entryName.replace(/^overrides\//, "")
      const destPath = path.join(intentPath, relPath)
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(destPath, entry.getData())
    }
  }
}

export function registerBuildHandlers() {
  ipcMain.handle("build:get-intent-path", (_event, dirName: string): string => ensureBuildIntentDir(dirName))

  ipcMain.handle("build:save-mod-to-intent", async (_event, dirName: string, url: string, fileName: string): Promise<string | null> => {
    try {
      const intentPath = ensureBuildIntentDir(dirName)
      const filePath = path.join(intentPath, "mods", fileName)
      const res = await fetch(url)
      if (!res.ok) return null
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()))
      return filePath
    } catch {
      return null
    }
  })

  ipcMain.handle("build:save-local-mod-to-intent", async (_event, dirName: string, localFilePath: string): Promise<string | null> => {
    try {
      const intentPath = ensureBuildIntentDir(dirName)
      const destPath = path.join(intentPath, "mods", path.basename(localFilePath))
      if (!fs.existsSync(destPath)) fs.copyFileSync(localFilePath, destPath)
      return destPath
    } catch {
      return null
    }
  })

  ipcMain.handle("build:set-intent-path", (_event, dirName: string): void => {
    ensureBuildIntentDir(dirName)
  })

  ipcMain.handle("build:import-modrinth", async (_event, buildName: string, projectSlug: string, versionId?: string): Promise<ImportResult> => {
    try {
      const intentPath = ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение версий...")
      const versionsRes = await fetch(`https://api.modrinth.com/v2/project/${projectSlug}/version`)
      if (!versionsRes.ok) throw new Error(`Modrinth API: ${versionsRes.status}`)
      const versions = await versionsRes.json() as any[]

      let version: any = versionId ? versions.find((v: any) => v.id === versionId) : null
      if (!version) version = versions.find((v: any) => v.version_type === "release") ?? versions[0]
      if (!version) throw new Error("Версии не найдены")

      const mrpackFile = version.files?.find((f: any) => f.filename?.endsWith(".mrpack"))
      if (!mrpackFile) throw new Error(".mrpack файл не найден")

      sendImportProgress(0, 100, "Скачивание пакета...")
      const zip = new AdmZip(await downloadBuffer(mrpackFile.url))
      const indexEntry = zip.getEntry("modrinth.index.json")
      if (!indexEntry) throw new Error("modrinth.index.json не найден")
      const index = JSON.parse(indexEntry.getData().toString("utf-8"))

      const files: any[] = (index.files ?? []).filter((f: any) => f.env?.client !== "unsupported")
      const gameVersion: string = version.game_versions?.[0] ?? index.dependencies?.minecraft ?? ""
      const deps: Record<string, string> = index.dependencies ?? {}
      let modLoader = "vanilla"
      if (deps["fabric-loader"]) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (deps["quilt-loader"]) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      } else if (deps.neoforge) {
        modLoader = "neoforge"
        sendImportProgress(0, 100, "Установка NeoForge...")
      } else if (deps.forge) {
        modLoader = "forge"
        sendImportProgress(0, 100, "Установка Forge...")
      }

      let downloaded = 0
      const totalFiles = files.length
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} файлов...`)
      const tasks = files.map((f: any) => async () => {
        try {
          const fileDir = path.join(intentPath, path.dirname(f.path))
          const filePath = path.join(fileDir, path.basename(f.path))
          if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
          if (!fs.existsSync(filePath)) {
            const url: string = f.downloads?.[0]
            if (!url) return
            fs.writeFileSync(filePath, await downloadBuffer(url))
          }
        } finally {
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} файлов`)
        }
      })
      await runConcurrent(tasks, 5)
      copyOverrideEntries(zip, intentPath)
      sendImportProgress(totalFiles, totalFiles, "Готово!")
      return { success: true, version: gameVersion, modLoader }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("build:import-curseforge", async (_event, buildName: string, modId: number, fileId: number): Promise<ImportResult> => {
    try {
      const intentPath = ensureBuildIntentDir(buildName)
      sendImportProgress(0, 100, "Получение ссылки...")
      const urlData = await cfFetch(`/mods/${modId}/files/${fileId}/download-url`) as { data?: string }
      const zipUrl = urlData.data
      if (!zipUrl) throw new Error("Ссылка на скачивание недоступна")

      sendImportProgress(0, 100, "Скачивание пакета...")
      const zip = new AdmZip(await downloadBuffer(zipUrl))
      const manifestEntry = zip.getEntry("manifest.json")
      if (!manifestEntry) throw new Error("manifest.json не найден")
      const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))

      const mcVersion: string = manifest.minecraft?.version ?? ""
      const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: any) => m.primary)?.id ?? ""
      let modLoader = "vanilla"
      if (loaderRaw.startsWith("forge")) modLoader = "forge"
      else if (loaderRaw.startsWith("fabric")) modLoader = "fabric"
      else if (loaderRaw.startsWith("neoforge")) {
        modLoader = "neoforge"
        sendImportProgress(0, 100, "Установка NeoForge...")
      } else if (loaderRaw.startsWith("quilt")) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      const modsDir = path.join(intentPath, "mods")
      if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })

      const files: { projectID: number; fileID: number }[] = manifest.files ?? []
      const totalFiles = files.length
      let downloaded = 0
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} модов...`)
      const tasks = files.map((f: any) => async () => {
        try {
          const urlRes = await cfFetch(`/mods/${f.projectID}/files/${f.fileID}/download-url`) as { data?: string }
          const fileUrl = urlRes.data
          if (!fileUrl) return
          const fileName = fileUrl.split("/").pop()?.split("?")[0] ?? `mod-${f.fileID}.jar`
          const filePath = path.join(modsDir, fileName)
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, await downloadBuffer(fileUrl))
          }
        } catch {}
        downloaded++
        sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} модов`)
      })
      await runConcurrent(tasks, 5)
      copyOverrideEntries(zip, intentPath)
      sendImportProgress(totalFiles, totalFiles, "Готово!")
      return { success: true, version: mcVersion, modLoader }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("build:open-and-import", async (): Promise<OpenImportResult> => {
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
      const zip = new AdmZip(fs.readFileSync(selectedFile))
      const mrpackIndex = zip.getEntry("modrinth.index.json")
      const manifestEntry = zip.getEntry("manifest.json")

      if (mrpackIndex) {
        const index = JSON.parse(mrpackIndex.getData().toString("utf-8"))
        const buildName = index.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const intentPath = ensureBuildIntentDir(buildName)
        const files: any[] = (index.files ?? []).filter((f: any) => f.env?.client !== "unsupported")
        const deps: Record<string, string> = index.dependencies ?? {}
        const version = deps.minecraft ?? ""
        let modLoader = "vanilla"
if (deps["fabric-loader"]) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (deps["quilt-loader"]) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      } else if (deps.neoforge) {
        modLoader = "neoforge"
        sendImportProgress(0, 100, "Установка NeoForge...")
      } else if (deps.forge) {
        modLoader = "forge"
        sendImportProgress(0, 100, "Установка Forge...")
      }

      let downloaded = 0
      const totalFiles = files.length
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} файлов...`)
      const tasks = files.map((f: any) => async () => {
        try {
          const fileDir = path.join(intentPath, path.dirname(f.path))
          const filePath = path.join(intentPath, f.path)
          if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
          if (!fs.existsSync(filePath)) {
            const url: string = f.downloads?.[0]
            if (!url) return
            fs.writeFileSync(filePath, await downloadBuffer(url))
          }
        } finally {
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} файлов`)
        }
      })
      await runConcurrent(tasks, 5)
      copyOverrideEntries(zip, intentPath)

      let mrIcon = ""
      try {
          const projectSlug = index.slug ?? buildName.toLowerCase().replace(/\s+/g, "-")
          const projectRes = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}`)
          if (projectRes.ok) {
            const projectData = await projectRes.json() as { icon_url?: string }
            mrIcon = projectData.icon_url ?? ""
          }
        } catch {}

        return {
          success: true,
          name: buildName,
          description: index.summary ?? "",
          icon: mrIcon,
          version,
          modLoader,
          source: "modrinth",
          intentPath,
        }
      }

      if (manifestEntry) {
        const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"))
        const buildName = manifest.name ?? path.basename(selectedFile, path.extname(selectedFile))
        const intentPath = ensureBuildIntentDir(buildName)
        const version: string = manifest.minecraft?.version ?? ""
        const loaderRaw: string = manifest.minecraft?.modLoaders?.find((m: any) => m.primary)?.id ?? ""
        let modLoader = "vanilla"
if (loaderRaw.startsWith("forge")) {
        modLoader = "forge"
        sendImportProgress(0, 100, "Установка Forge...")
      } else if (loaderRaw.startsWith("fabric")) {
        modLoader = "fabric"
        sendImportProgress(0, 100, "Установка Fabric...")
      } else if (loaderRaw.startsWith("neoforge")) {
        modLoader = "neoforge"
        sendImportProgress(0, 100, "Установка NeoForge...")
      } else if (loaderRaw.startsWith("quilt")) {
        modLoader = "quilt"
        sendImportProgress(0, 100, "Установка Quilt...")
      }

      const modsDir = path.join(intentPath, "mods")
      if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })

      const files: { projectID: number; fileID: number }[] = manifest.files ?? []
      const totalFiles = files.length
      let downloaded = 0
      sendImportProgress(0, totalFiles, `Скачивание ${totalFiles} модов...`)
      const tasks = files.map((f: any) => async () => {
          try {
            const urlRes = await cfFetch(`/mods/${f.projectID}/files/${f.fileID}/download-url`) as { data?: string }
            const fileUrl = urlRes.data
            if (!fileUrl) return
            const fileName = fileUrl.split("/").pop()?.split("?")[0] ?? `mod-${f.fileID}.jar`
            const filePath = path.join(modsDir, fileName)
            if (!fs.existsSync(filePath)) {
              fs.writeFileSync(filePath, await downloadBuffer(fileUrl))
            }
          } catch {}
          downloaded++
          sendImportProgress(downloaded, totalFiles, `${downloaded}/${totalFiles} модов`)
        })
        await runConcurrent(tasks, 5)
        copyOverrideEntries(zip, intentPath)

        let cfIcon = ""
        try {
          const cfSearchRes = await cfFetch("/mods/search", { gameId: "432", searchFilter: buildName, pageSize: "1" }) as { data?: { logo?: { thumbnailUrl?: string } }[] }
          cfIcon = cfSearchRes.data?.[0]?.logo?.thumbnailUrl ?? ""
        } catch {}

        return {
          success: true,
          name: buildName,
          description: manifest.summary ?? manifest.author ?? "",
          icon: cfIcon,
          version,
          modLoader,
          source: "curseforge",
          intentPath,
        }
      }

      return { success: false, error: "Неизвестный формат модпака" }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
