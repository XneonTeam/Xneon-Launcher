import path from "path"
import fs from "fs/promises"
import { formatDisplayNameFromFileName } from "./helpers"
import { readContentMetadataFromPath } from "./metadata"
import { resolveContentEntries, type ResolvedContentEntry } from "./content-resolver"
import { normalizeContentIcon } from "./content-icon"
import { BoundedCache, estimateCacheBytes } from "../../../lib/bounded-cache"
import { contentMetadataEvents } from "./content-metadata-events"
import type { ImportModEntry, ScannedBuildContent } from "./helpers"

type IntentContentFile = {
  slug: string
  filePath: string
  name: string
  enabled: boolean
  /** Папка-ресурспак/папка-шейдер: метаданные читаются из неё, хэшировать нечего. */
  isDirectory?: boolean
}

/**
 * Папка-ресурспак (`pack.mcmeta`) или папка-шейдер (`shaders/`) — это полноценный
 * контент: Minecraft читает такую папку наравне с архивом. Без этой проверки
 * брошенная папка копировалась на диск, но исчезала из списка при следующем скане.
 */
async function isContentFolder(dirPath: string): Promise<boolean> {
  const markers = ["pack.mcmeta", "shaders.properties", path.join("shaders", "shaders.properties"), "shaders"]

  for (const marker of markers) {
    try {
      await fs.access(path.join(dirPath, marker))
      return true
    } catch {
      // маркера нет — проверяем следующий
    }
  }

  return false
}

async function listIntentContentFiles(dir: string, parentPath = "", foldersAsContent = false): Promise<IntentContentFile[]> {
  const files: IntentContentFile[] = []
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  for (const entry of entries) {
    const nextRelativePath = parentPath ? path.posix.join(parentPath, entry.name) : entry.name
    const filePath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // В resourcepacks/shaderpacks папка верхнего уровня — сам контент, а не
      // контейнер: внутрь не заходим. В mods папки остаются контейнерами.
      if (foldersAsContent && !parentPath) {
        const rawName = entry.name.replace(/\.disabled$/i, "")
        if (await isContentFolder(filePath)) {
          files.push({ slug: rawName, filePath, name: rawName, enabled: rawName === entry.name, isDirectory: true })
          continue
        }
      }
      files.push(...await listIntentContentFiles(filePath, nextRelativePath, foldersAsContent))
      continue
    }

    if (!entry.isFile()) continue
    // `.litemod` принимается дропом (см. content-drop.ts), поэтому сканер обязан
    // его видеть: иначе принятый файл исчезал из списка после первого rescan.
    if (!/\.(jar|zip|litemod)(\.disabled)?$/i.test(entry.name)) continue

    const name = entry.name.replace(/\.disabled$/i, "")
    const slug = parentPath ? path.posix.join(parentPath, name) : name

    files.push({ slug, filePath, name, enabled: name === entry.name })
  }

  return files
}

const contentDirs = [
  { name: "mods", foldersAsContent: false },
  { name: "resourcepacks", foldersAsContent: true },
  { name: "shaderpacks", foldersAsContent: true },
] as const

async function readSnapshot(intentPath: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return Promise.all(contentDirs.map(async ({ name, foldersAsContent }) => {
    const files = await listIntentContentFiles(path.join(intentPath, name), "", foldersAsContent)
    const snapshot = new Map<string, string>()
    const present: IntentContentFile[] = []
    await Promise.all(files.map(async file => {
      try {
        const info = await fs.stat(file.filePath)
        snapshot.set(file.filePath, `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error
      }
    }))
    for (const file of files) if (snapshot.has(file.filePath)) present.push(file)
    return { name, files: present, snapshot }
  }))
}

const activeScans = new Map<string, Promise<ScannedBuildContent>>()

// Повторное перечисление/stat остаётся дешёвой проверкой внешних изменений.
// SQLite/metadata/сеть нужны только новым и действительно изменившимся файлам.
const resolvedFiles = new BoundedCache<string, { signature: string; entry: ResolvedContentEntry }>({
  capacity: 2048, maxWeight: 16 * 1024 * 1024, ttlMs: 5 * 60_000,
  weight: value => estimateCacheBytes(value),
})
const contentPathKey = (file: string) => process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file)
let metadataRevision = 0
contentMetadataEvents.on("updated", files => {
  metadataRevision++
  for (const file of files) resolvedFiles.delete(contentPathKey(file))
})

async function resolveSnapshotArchives(filesByDir: Awaited<ReturnType<typeof readSnapshot>>, report: (processed: number) => void, signal?: AbortSignal) {
  const resolved: Record<string, ResolvedContentEntry> = {}
  const missing: Array<{ file: string; signature: string }> = []
  let reused = 0
  for (const dir of filesByDir) for (const file of dir.files) {
    if (file.isDirectory) continue
    const signature = dir.snapshot.get(file.filePath)!
    const previous = resolvedFiles.get(contentPathKey(file.filePath))
    if (previous?.signature === signature) { resolved[file.filePath] = previous.entry; reused++ }
    else missing.push({ file: file.filePath, signature })
  }
  report(reused)
  if (!missing.length) return resolved
  const revision = metadataRevision
  const fresh = await resolveContentEntries(missing.map(item => item.file), done => report(reused + done), signal)
  signal?.throwIfAborted()
  for (const { file, signature } of missing) {
    const entry = fresh[file]
    if (!entry) continue
    resolved[file] = entry
    // Диагностика/ошибки должны повторно проверяться; позднее обогащение
    // не должно потеряться за снимком, записанным после его invalidation.
    if (entry.sha1 && !entry.diagnostics?.length && revision === metadataRevision) {
      resolvedFiles.set(contentPathKey(file), { signature, entry })
    }
  }
  return resolved
}

export function scanIntentDir(intentPath: string, onProgress?: (processed: number, total: number) => void, signal?: AbortSignal): Promise<ScannedBuildContent> {
  if (onProgress || signal) return scanStableIntentDir(intentPath, onProgress, signal)
  const normalized = path.resolve(intentPath)
  const key = process.platform === "win32" ? normalized.toLowerCase() : normalized
  const active = activeScans.get(key)
  if (active) return active
  const scan = scanStableIntentDir(normalized).finally(() => activeScans.delete(key))
  activeScans.set(key, scan)
  return scan
}

async function scanStableIntentDir(intentPath: string, onProgress?: (processed: number, total: number) => void, signal?: AbortSignal): Promise<ScannedBuildContent> {
  let snapshot = await readSnapshot(intentPath, signal)
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await scanSnapshot(snapshot, onProgress, signal)
    const current = await readSnapshot(intentPath, signal)
    signal?.throwIfAborted()
    if (snapshot.every(({ snapshot: before }, i) => {
      const after = current[i].snapshot
      return before.size === after.size && [...before].every(([file, signature]) => after.get(file) === signature)
    })) {
      // Удалённые файлы больше не удерживаются до TTL. Перебор ограничен LRU.
      const present = new Set(current.flatMap(dir=>[...dir.snapshot.keys()].map(contentPathKey)))
      const prefix = contentPathKey(intentPath) + path.sep
      for (const key of resolvedFiles.keys()) if (key.startsWith(prefix) && !present.has(key)) resolvedFiles.delete(key)
      return result
    }
    snapshot = current
  }
  throw new Error("Content directory changed during scan")
}

async function scanSnapshot(filesByDir: Awaited<ReturnType<typeof readSnapshot>>, onProgress?: (processed: number, total: number) => void, signal?: AbortSignal): Promise<ScannedBuildContent> {
  signal?.throwIfAborted()
  const mods: ImportModEntry[] = []
  const resourcepacks: ImportModEntry[] = []
  const shaders: ImportModEntry[] = []
  const installedMods: Record<string, string> = {}

  const files = filesByDir.flatMap(dir => dir.files)
  const total = files.length
  const archives = files.filter(file => !file.isDirectory).map(file => file.filePath)
  const report = (processed: number) => {
    try { onProgress?.(Math.min(processed, total), total) } catch {}
  }
  const resolved = archives.length ? await resolveSnapshotArchives(filesByDir, report, signal) : {}
  let processed = archives.length
  const targets = { mods, resourcepacks, shaderpacks: shaders }
  for (const { name: dirName, files } of filesByDir) {
    const target = targets[dirName]

    for (const { slug, filePath, name, enabled, isDirectory } of files) {
      signal?.throwIfAborted()
      const entry = resolved[filePath]
      const fileName = path.basename(name)
      // Папка-ресурспак/шейдер: метаданные (имя, версия, описание, иконка) читаем
      // прямо из неё — так в списке видны настоящие данные, а не имя папки.
      const folderMetadata = isDirectory ? await readContentMetadataFromPath(filePath, signal) : null
      const modEntry: ImportModEntry = entry
        ? {
            id: entry.sha1 || `local:${slug}`,
            slug,
            name: entry.name || formatDisplayNameFromFileName(fileName),
            description: entry.description || "",
            icon_url: entry.icon_url,
            version: entry.version || "local",
            source: entry.source,
            projectId: entry.projectId,
            modId: entry.modId,
            versionId: entry.versionId,
            fileId: entry.fileId,
            author: entry.author,
            ...(entry.diagnostics?.length ? { diagnostics: entry.diagnostics } : {}),
            enabled,
          }
        : {
            // Resolver failed (broken archive, unreadable metadata, ...) —
            // keep the file visible as a local mod instead of dropping it
            // from the list entirely.
            id: `local:${slug}`,
            slug,
            name: formatDisplayNameFromFileName(fileName),
            description: "",
            version: "local",
            source: "local",
            enabled,
          }

      if (folderMetadata && !entry) {
        modEntry.name = folderMetadata.name || modEntry.name
        modEntry.description = folderMetadata.description || modEntry.description
        modEntry.icon_url = normalizeContentIcon(folderMetadata.icon_url ?? modEntry.icon_url ?? "") || undefined
        modEntry.version = folderMetadata.version || modEntry.version
        modEntry.author = folderMetadata.author ?? modEntry.author
        if (folderMetadata.diagnostics?.length) modEntry.diagnostics = folderMetadata.diagnostics
      }

      target.push(modEntry)
      if (dirName === "mods") installedMods[slug] = filePath
      if (isDirectory) report(++processed)
    }
  }

  signal?.throwIfAborted()
  report(total)
  return { mods, resourcepacks, shaders, installedMods }
}
