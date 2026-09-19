import fs from "node:fs"
import path from "node:path"
import { downloadBuffer } from "./helpers"

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

/** Файлы из конфига, которых нет в папках сборки. */
export function collectMissingFiles(intentPath: string, entries: MissingModEntry[]): MissingModEntry[] {
  const missing: MissingModEntry[] = []
  for (const entry of entries) {
    if (!entry?.pattern) continue
    const target = path.join(intentPath, destinationDir(entry), entry.pattern)
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
      curseforgeGetFiles: (fileIds: number[]) => Promise<Record<number, { fileName?: string; downloadUrl?: string }>>
    }>
  },
): Promise<MissingModsResult> {
  const total = entries.length
  const result: MissingModsResult = { total, missing: total, downloaded: 0, failed: 0, failedNames: [] }
  if (total === 0) return result

  const loadMods = options?.loadModsModule
  let fileInfos: Record<number, { fileName?: string; downloadUrl?: string }> = {}
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
    const fileName = entry.pattern
    if (!fileName) continue
    const dir = path.join(intentPath, destinationDir(entry))
    const target = path.join(dir, fileName)
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
      fs.mkdirSync(dir, { recursive: true })
      const buffer = await downloadBuffer(url, options?.signal, fileName)
      fs.writeFileSync(target, buffer)
      result.downloaded++
    } catch {
      result.failed++
      result.failedNames.push(entry.displayName || fileName)
    }
    done++
    options?.onProgress?.(done, total, fileName)
  }

  return result
}
