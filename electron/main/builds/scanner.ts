import path from "path"
import fs from "fs/promises"
import { formatDisplayNameFromFileName } from "./helpers"
import { readContentMetadataFromPath } from "./metadata"
import { resolveContentEntries } from "./content-resolver"
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
  try { await fs.access(dir) } catch { return [] }

  const files: IntentContentFile[] = []
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }

  for (const entry of entries) {
    const nextRelativePath = parentPath ? path.posix.join(parentPath, entry.name) : entry.name
    const filePath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // В resourcepacks/shaderpacks папка верхнего уровня — сам контент, а не
      // контейнер: внутрь не заходим. В mods папки остаются контейнерами.
      if (foldersAsContent && !parentPath) {
        const rawName = entry.name.endsWith(".disabled") ? entry.name.slice(0, -".disabled".length) : entry.name
        if (await isContentFolder(filePath)) {
          files.push({ slug: rawName, filePath, name: rawName, enabled: !entry.name.endsWith(".disabled"), isDirectory: true })
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

    const name = entry.name.endsWith(".disabled")
      ? entry.name.slice(0, -".disabled".length)
      : entry.name
    const slug = parentPath ? path.posix.join(parentPath, name) : name

    files.push({ slug, filePath, name, enabled: !entry.name.endsWith(".disabled") })
  }

  return files
}

export async function scanIntentDir(intentPath: string, onProgress?: (processed: number, total: number) => void): Promise<ScannedBuildContent> {
  const mods: ImportModEntry[] = []
  const resourcepacks: ImportModEntry[] = []
  const shaders: ImportModEntry[] = []
  const installedMods: Record<string, string> = {}

  const dirs = [
    { dir: path.join(intentPath, "mods"), target: mods, map: installedMods, foldersAsContent: false },
    { dir: path.join(intentPath, "resourcepacks"), target: resourcepacks, map: null, foldersAsContent: true },
    { dir: path.join(intentPath, "shaderpacks"), target: shaders, map: null, foldersAsContent: true },
  ]

  const filesByDir = new Map<string, Awaited<ReturnType<typeof listIntentContentFiles>>>()
  let total = 0
  // Три каталога читаем параллельно: раньше это были три последовательных
  // обхода (readdir + resolver) на каждое открытие сборки.
  await Promise.all(dirs.map(async ({ dir, foldersAsContent }) => {
    const files = await listIntentContentFiles(dir, "", foldersAsContent)
    filesByDir.set(dir, files)
    total += files.length
  }))

  // Прогресс считаем по сумме обработанных файлов во всех каталогах.
  const progressByDir = new Map<string, number>()
  const report = () => {
    let processed = 0
    for (const { dir } of dirs) processed += progressByDir.get(dir) ?? 0
    try { onProgress?.(Math.min(processed, total), total) } catch {}
  }

  const resolvedByDir = new Map<string, Awaited<ReturnType<typeof resolveContentEntries>>>()
  await Promise.all(dirs.map(async ({ dir }) => {
    const files = filesByDir.get(dir) ?? []
    const folderFiles = files.filter((file) => file.isDirectory)
    const archiveFiles = files.filter((file) => !file.isDirectory)
    // Папки в resolver не отдаём: там хэширование файла, а папку хэшировать нельзя.
    progressByDir.set(dir, folderFiles.length)
    if (archiveFiles.length === 0) {
      resolvedByDir.set(dir, {})
      report()
      return
    }
    resolvedByDir.set(dir, await resolveContentEntries(
      archiveFiles.map((file) => file.filePath),
      (done) => {
        progressByDir.set(dir, folderFiles.length + done)
        report()
      },
    ))
    progressByDir.set(dir, files.length)
    report()
  }))

  for (const { dir, target, map } of dirs) {
    const files = filesByDir.get(dir) ?? []
    const resolved = resolvedByDir.get(dir) ?? {}

    for (const { slug, filePath, name, enabled, isDirectory } of files) {
      const entry = resolved[filePath]
      const fileName = path.basename(name)
      // Папка-ресурспак/шейдер: метаданные (имя, версия, описание, иконка) читаем
      // прямо из неё — так в списке видны настоящие данные, а не имя папки.
      const folderMetadata = isDirectory ? await readContentMetadataFromPath(filePath) : null
      const modEntry: ImportModEntry = entry
        ? {
            id: entry.sha1,
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
        modEntry.icon_url = folderMetadata.icon_url ?? modEntry.icon_url
        modEntry.version = folderMetadata.version || modEntry.version
        modEntry.author = folderMetadata.author ?? modEntry.author
      }

      target.push(modEntry)
      if (map !== null) {
        map[slug] = filePath
      }
    }
  }

  // Папки не проходили через resolver, поэтому их «обработку» учитываем отдельно.
  for (const { dir } of dirs) progressByDir.set(dir, (filesByDir.get(dir) ?? []).length)
  report()
  onProgress?.(total, total)
  return { mods, resourcepacks, shaders, installedMods }
}
