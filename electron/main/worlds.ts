// ============================================================
// Worlds & Screenshots IPC Handlers
// Per-build save management: list/rename/delete/icon/seed,
// datapacks (local + Modrinth/CurseForge downloads),
// and screenshot gallery.
// ============================================================

import { ipcMain, nativeImage } from "electron"
import path from "path"
import fs from "fs/promises"
import zlib from "zlib"
import { ensureBuildIntentDir, downloadBuffer, sanitizeFileName } from "./builds/helpers"

type WorldInfo = {
  folder: string
  name: string
  seed: string
  gameMode: string
  hardcore: boolean
  lastPlayed: number
  playedTime: number
  mcVersion: string
  iconDataUrl: string
  sizeBytes: number
  lastModified: number
  path: string
  datapackCount: number
  hasLevelData: boolean
}

type DatapackInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  path: string
}

type ScreenshotInfo = {
  name: string
  sizeBytes: number
  lastModified: number
  thumbDataUrl: string
  path: string
}

type OpResult = { success: boolean; error?: string }

// ---------- Helpers ----------

function getGameDir(buildName: string): Promise<string> {
  return ensureBuildIntentDir(buildName)
}

function resolveWorldPath(savesDir: string, folder: string): string | null {
  if (!folder || folder.includes("/") || folder.includes("\\") || folder === "." || folder === "..") return null
  const worldPath = path.resolve(savesDir, folder)
  const normalizedSaves = `${path.resolve(savesDir)}${path.sep}`
  if (!worldPath.startsWith(normalizedSaves)) return null
  return worldPath
}

function resolveChildPath(parentDir: string, fileName: string): string | null {
  const targetPath = path.resolve(parentDir, sanitizeFileName(fileName))
  const normalizedParent = `${path.resolve(parentDir)}${path.sep}`
  if (!targetPath.startsWith(normalizedParent)) return null
  return targetPath
}

async function dirSize(dirPath: string, maxEntries = 200000): Promise<number> {
  let total = 0
  let count = 0
  const walk = async (dir: string): Promise<void> => {
    if (count > maxEntries) return
    let entries: string[] = []
    try { entries = await fs.readdir(dir) } catch { return }
    for (const entry of entries) {
      if (count > maxEntries) return
      count++
      const full = path.join(dir, entry)
      try {
        const stat = await fs.stat(full)
        if (stat.isDirectory()) await walk(full)
        else total += stat.size
      } catch { /* ignore */ }
    }
  }
  await walk(dirPath)
  return total
}

async function readLevelNbt(worldPath: string): Promise<{ parsed: unknown; type: string } | null> {
  try {
    const nbt = await import("prismarine-nbt")
    const levelFile = path.join(worldPath, "level.dat")
    const buffer = await fs.readFile(levelFile)
    const { parsed, type } = await nbt.parse(buffer)
    return { parsed, type }
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTagValue(parent: any, key: string): any {
  try {
    if (!parent || typeof parent !== "object") return undefined
    const tag = parent.value?.[key]
    return tag?.value
  } catch {
    return undefined
  }
}

function formatBigInt(value: unknown): string {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") return String(Math.trunc(value))
  if (typeof value === "string") return value
  return ""
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  return 0
}

function gameModeName(gameType: number): string {
  switch (gameType) {
    case 1: return "Креатив"
    case 2: return "Приключение"
    case 3: return "Наблюдатель"
    default: return "Выживание"
  }
}

function fileToDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`
}

async function readIconDataUrl(worldPath: string): Promise<string> {
  try {
    const iconPath = path.join(worldPath, "icon.png")
    const buffer = await fs.readFile(iconPath)
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) return ""
    const resized = image.getSize().width > 256 || image.getSize().height > 256 ? image.resize({ width: 256, height: 256 }) : image
    return fileToDataUrl(resized.toPNG(), "image/png")
  } catch {
    return ""
  }
}

function parseWorldFolder(savesDir: string, folder: string): Promise<WorldInfo> {
  return (async () => {
    const worldPath = resolveWorldPath(savesDir, folder)!
    let name = folder
    let seed = ""
    let gameMode = "Выживание"
    let hardcore = false
    let lastPlayed = 0
    let playedTime = 0
    let mcVersion = ""
    let hasLevelData = false

    const level = await readLevelNbt(worldPath)
    if (level?.parsed) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (level.parsed as any).value?.Data
      const levelName = getTagValue(data, "LevelName")
      if (typeof levelName === "string" && levelName.trim()) name = levelName
      const randomSeed = getTagValue(data, "RandomSeed")
      if (randomSeed !== undefined && randomSeed !== null) seed = formatBigInt(randomSeed)
      const gameType = getTagValue(data, "GameType")
      const hardcoreValue = getTagValue(data, "hardcore")
      hardcore = hardcoreValue === 1 || hardcoreValue === true
      gameMode = gameModeName(toNumber(gameType))
      lastPlayed = toNumber(getTagValue(data, "LastPlayed"))
      const worldTime = getTagValue(data, "Time")
      if (worldTime !== undefined) playedTime = Math.max(0, Math.floor(toNumber(worldTime) / 20))
      const versionName = getTagValue(data, "Version")
      if (versionName && typeof versionName === "object") {
        const nameValue = versionName?.value?.Name?.value ?? getTagValue(versionName, "Name")
        if (typeof nameValue === "string") mcVersion = nameValue
      }
      hasLevelData = true
    }

    let sizeBytes = 0
    let lastModified = 0
    let datapackCount = 0
    try {
      const stat = await fs.stat(worldPath)
      lastModified = stat.mtimeMs
      sizeBytes = await dirSize(worldPath)
    } catch { /* ignore */ }

    try {
      const dpDir = path.join(worldPath, "datapacks")
      datapackCount = (await fs.readdir(dpDir).catch(() => [])).length
    } catch { /* ignore */ }

    return {
      folder,
      name,
      seed,
      gameMode,
      hardcore,
      lastPlayed,
      playedTime,
      mcVersion,
      iconDataUrl: await readIconDataUrl(worldPath),
      sizeBytes,
      lastModified,
      path: worldPath,
      datapackCount,
      hasLevelData,
    }
  })()
}

async function listDatapacks(worldPath: string): Promise<DatapackInfo[]> {
  const dpDir = path.join(worldPath, "datapacks")
  let entries: string[] = []
  try { entries = await fs.readdir(dpDir) } catch { return [] }
  const result: DatapackInfo[] = []
  for (const entry of entries) {
    const full = path.join(dpDir, entry)
    try {
      const stat = await fs.stat(full)
      result.push({ name: entry, sizeBytes: stat.size, lastModified: stat.mtimeMs, path: full })
    } catch { /* ignore */ }
  }
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

// ---------- Handlers ----------

export function registerWorldsHandlers(): void {
  ipcMain.handle("worlds:list", async (_event, buildName: string): Promise<WorldInfo[]> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      let folders: string[] = []
      try { folders = (await fs.readdir(savesDir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name) } catch { return [] }
      const worlds = await Promise.all(folders.map(folder => parseWorldFolder(savesDir, folder)))
      worlds.sort((a, b) => b.lastPlayed - a.lastPlayed)
      return worlds
    } catch {
      return []
    }
  })

  ipcMain.handle("worlds:rename", async (_event, buildName: string, folder: string, newName: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }

      const trimmedName = newName.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").slice(0, 64)
      if (!trimmedName) return { success: false, error: "Введите название мира" }
      if (trimmedName === folder) return { success: true }

      const newFolder = trimmedName.replace(/\s+/g, "_")
      const newWorldPath = path.join(savesDir, newFolder)
      try { await fs.access(newWorldPath) } catch {
        await fs.rename(worldPath, newWorldPath)
      }

      // Update LevelName inside level.dat (keep in-sync display name)
      const targetWorldPath = newWorldPath
      const level = await readLevelNbt(targetWorldPath)
      if (level?.parsed) {
        try {
          const nbt = await import("prismarine-nbt")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = (level.parsed as any).value?.Data
          if (data?.value?.LevelName) {
            data.value.LevelName.value = trimmedName
            const uncompressed = nbt.writeUncompressed(level.parsed as never, level.type as never)
            await fs.writeFile(path.join(targetWorldPath, "level.dat"), zlib.gzipSync(uncompressed))
          }
        } catch { /* level.dat update is best-effort */ }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("worlds:delete", async (_event, buildName: string, folder: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      await fs.rm(worldPath, { recursive: true, force: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("worlds:set-icon", async (_event, buildName: string, folder: string, dataUrl: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }

      const image = nativeImage.createFromDataURL(dataUrl)
      if (image.isEmpty()) return { success: false, error: "Не удалось прочитать изображение" }
      const resized = image.resize({ width: 256, height: 256 })
      await fs.writeFile(path.join(worldPath, "icon.png"), resized.toPNG())
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("worlds:list-datapacks", async (_event, buildName: string, folder: string): Promise<DatapackInfo[]> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return []
      return await listDatapacks(worldPath)
    } catch {
      return []
    }
  })

  ipcMain.handle("worlds:install-datapack-remote", async (_event, buildName: string, folder: string, url: string, fileName: string): Promise<OpResult & { path?: string }> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      const dpDir = path.join(worldPath, "datapacks")
      await fs.mkdir(dpDir, { recursive: true }).catch(() => {})
      const safeName = sanitizeFileName(fileName)
      const filePath = resolveChildPath(dpDir, safeName)
      if (!filePath) return { success: false, error: "Некорректное имя файла" }
      const buffer = await downloadBuffer(url)
      if (buffer.length < 4) return { success: false, error: "Файл пуст" }
      try { await fs.access(filePath) } catch {
        await fs.writeFile(filePath, buffer)
      }
      return { success: true, path: filePath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("worlds:install-datapack-local", async (_event, buildName: string, folder: string, localFilePath: string): Promise<OpResult & { path?: string }> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      const dpDir = path.join(worldPath, "datapacks")
      await fs.mkdir(dpDir, { recursive: true }).catch(() => {})
      const destPath = resolveChildPath(dpDir, path.basename(localFilePath))
      if (!destPath) return { success: false, error: "Некорректное имя файла" }
      try { await fs.access(destPath) } catch {
        await fs.copyFile(localFilePath, destPath)
      }
      return { success: true, path: destPath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("worlds:delete-datapack", async (_event, buildName: string, folder: string, fileName: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const savesDir = path.join(gameDir, "saves")
      const worldPath = resolveWorldPath(savesDir, folder)
      if (!worldPath) return { success: false, error: "Некорректное имя папки мира" }
      const dpDir = path.join(worldPath, "datapacks")
      const filePath = resolveChildPath(dpDir, fileName)
      if (!filePath) return { success: false, error: "Некорректное имя файла" }
      await fs.rm(filePath, { recursive: true, force: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ---------- Screenshots ----------

  const listScreenshots = async (buildName: string): Promise<ScreenshotInfo[]> => {
    const gameDir = await getGameDir(buildName)
    const shotsDir = path.join(gameDir, "screenshots")
    let entries: string[] = []
    try { entries = await fs.readdir(shotsDir) } catch { return [] }
    const result: ScreenshotInfo[] = []
    for (const entry of entries) {
      if (!/\.(png|jpe?g|webp|bmp)$/i.test(entry)) continue
      const full = path.join(shotsDir, entry)
      try {
        const stat = await fs.stat(full)
        if (!stat.isFile()) continue
        const buffer = await fs.readFile(full)
        const image = nativeImage.createFromBuffer(buffer)
        if (image.isEmpty()) continue
        const size = image.getSize()
        const maxDim = Math.max(size.width, size.height)
        const thumb = maxDim > 480 ? image.resize({ width: Math.round(size.width * 480 / maxDim) }) : image
        result.push({
          name: entry,
          sizeBytes: stat.size,
          lastModified: stat.mtimeMs,
          thumbDataUrl: fileToDataUrl(thumb.toPNG(), "image/png"),
          path: full,
        })
      } catch { /* ignore */ }
    }
    result.sort((a, b) => b.lastModified - a.lastModified)
    return result
  }

  ipcMain.handle("screenshots:list", async (_event, buildName: string): Promise<ScreenshotInfo[]> => {
    try {
      return await listScreenshots(buildName)
    } catch {
      return []
    }
  })

  ipcMain.handle("screenshots:get", async (_event, buildName: string, fileName: string): Promise<string | null> => {
    try {
      const gameDir = await getGameDir(buildName)
      const shotsDir = path.join(gameDir, "screenshots")
      const filePath = resolveChildPath(shotsDir, fileName)
      if (!filePath) return null
      const buffer = await fs.readFile(filePath)
      const image = nativeImage.createFromBuffer(buffer)
      if (image.isEmpty()) return null
      return fileToDataUrl(image.toPNG(), "image/png")
    } catch {
      return null
    }
  })

  ipcMain.handle("screenshots:delete", async (_event, buildName: string, fileName: string): Promise<OpResult> => {
    try {
      const gameDir = await getGameDir(buildName)
      const shotsDir = path.join(gameDir, "screenshots")
      const filePath = resolveChildPath(shotsDir, fileName)
      if (!filePath) return { success: false, error: "Некорректное имя файла" }
      await fs.rm(filePath, { force: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
