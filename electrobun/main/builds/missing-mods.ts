import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { downloadBuffer, resolveSafeIntentFilePath } from "./helpers"
import { createModpackPathClaims, writeModpackDownload } from "./modpack-install"

/**
 * Модпаки вроде Better MC кладут в сборку мод Missing Mods Checker: он на старте
 * сверяет `config/missing_mods_checker.json` с папками игры и открывает окно с
 * требованием докачать «core»-файлы. В `.mrpack` этих файлов нет — Modrinth их
 * не распространяет, они лежат только на CurseForge (в конфиге ссылки на
 * страницы загрузки). Раньше это выглядело как зависший запуск: игра ждала,
 * пока пользователь закроет окно. Здесь мы докачиваем их сами через CurseForge
 * API, чтобы окно не появлялось.
 */
export type MissingModEntry = {
  displayName?: string
  pattern?: string
  url?: string
  destination?: string
}

/** Идентификатор файла CurseForge из ссылки вида `.../download/7420614`. */
export function parseCurseforgeFileId(url: string | undefined): number | null {
  if (!url) return null
  const match = url.match(/\/download\/(\d+)/)
  return match ? Number(match[1]) : null
}

export function readMissingModsConfig(intentPath: string): MissingModEntry[] {
  try {
    const configPath = path.join(intentPath, "config", "missing_mods_checker.json")
    if (!fs.existsSync(configPath)) return []
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown
    return Array.isArray(parsed) ? (parsed as MissingModEntry[]) : []
  } catch {
    return []
  }
}

function destinationDir(entry: MissingModEntry): "mods" | "resourcepacks" {
  return entry.destination === "resourcepacks" ? "resourcepacks" : "mods"
}

function entryPath(entry: MissingModEntry): string {
  const relative = `${destinationDir(entry)}/${entry.pattern ?? ""}`
  try { createModpackPathClaims()(relative) } catch { throw new Error("Invalid missing mod path") }
  return relative
}

/** Файлы из конфига, которых нет в папках сборки. */
export function collectMissingFiles(intentPath: string, entries: MissingModEntry[]): MissingModEntry[] {
  const missing: MissingModEntry[] = []
  for (const entry of entries) {
    if (!entry?.pattern) continue
    const relative = entryPath(entry)
    // Даже проверка существования не должна переходить по пользовательской ссылке.
    let target = intentPath
    for (const segment of relative.split("/")) {
      target = path.join(target, segment)
      try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error("Missing mod path contains a link") }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    }
    if (!fs.existsSync(target)) missing.push(entry)
  }
  return missing
}

export type MissingModsResult = {
  total: number
  missing: number
  downloaded: number
  failed: number
  failedNames: string[]
}

/**
 * Докачивает недостающие файлы из CurseForge. Имя сохраняем ровно как в конфиге
 * (`pattern`) — именно по нему мод проверяет наличие файла.
 */
export async function downloadMissingModFiles(
  intentPath: string,
  entries: MissingModEntry[],
  options?: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number, current: string) => void
    loadModsModule?: () => Promise<{
      curseforgeGetFiles: (fileIds: number[]) => Promise<Record<number, { fileName?: string; downloadUrl?: string; sha1?: string; fileLength?: number }>>
    }>
  },
): Promise<MissingModsResult> {
  const total = entries.length
  options?.signal?.throwIfAborted()
  const claim = createModpackPathClaims()
  for (const entry of entries) if (entry?.pattern) claim(entryPath(entry))
  const result: MissingModsResult = { total, missing: total, downloaded: 0, failed: 0, failedNames: [] }
  if (total === 0) return result

  const loadMods = options?.loadModsModule
  let fileInfos: Record<number, { fileName?: string; downloadUrl?: string; sha1?: string; fileLength?: number }> = {}
  if (loadMods) {
    try {
      const mods = await loadMods()
      const ids = entries.map(entry => parseCurseforgeFileId(entry.url)).filter((id): id is number => id !== null)
      if (ids.length > 0) fileInfos = await mods.curseforgeGetFiles(ids)
    } catch {
      // Без метаданных попробуем прямые ссылки из конфига.
    }
  }

  let done = 0
  for (const entry of entries) {
    options?.signal?.throwIfAborted()
    const fileName = entry.pattern
    if (!fileName) continue
    const relative = entryPath(entry)
    const target = await resolveSafeIntentFilePath(intentPath, relative)
    const dir = path.dirname(target)
    const temporary = path.join(dir, `.${randomUUID()}.missing-mod-part`)
    try {
      options?.onProgress?.(done, total, fileName)
      if (fs.existsSync(target)) {
        done++
        result.downloaded++
        continue
      }
      const fileId = parseCurseforgeFileId(entry.url)
      const info = fileId !== null ? fileInfos[fileId] : undefined
      const url = info?.downloadUrl
      if (!url) {
        result.failed++
        result.failedNames.push(entry.displayName || fileName)
        done++
        continue
      }
      await fs.promises.mkdir(dir, { recursive: true })
      const buffer = await downloadBuffer(url, options?.signal, fileName)
      options?.signal?.throwIfAborted()
      await writeModpackDownload(temporary, buffer, { sha1: info?.sha1, size: info?.fileLength })
      await resolveSafeIntentFilePath(intentPath, relative)
      options?.signal?.throwIfAborted()
      // link атомарно публикует новый файл без замены появившегося пользовательского.
      await fs.promises.link(temporary, target)
      result.downloaded++
    } catch {
      options?.signal?.throwIfAborted()
      result.failed++
      result.failedNames.push(entry.displayName || fileName)
    } finally {
      await fs.promises.rm(temporary, { force: true })
    }
    done++
    options?.onProgress?.(done, total, fileName)
  }

  return result
}
