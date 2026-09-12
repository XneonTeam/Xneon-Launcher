import { toErrorMessage } from "../errors"
import { parentPort, workerData } from "worker_threads"
import path from "path"
import fs from "fs/promises"
import AdmZip from "adm-zip"

interface ZipWorkerData {
  intentPath: string
  archivePath: string
  /** Опциональный фильтр: включать только эти категории (mods/saves/logs/...). */
  categories?: string[]
}

interface ZipWorkerResult {
  ok: boolean
  archivePath?: string
  error?: string
}

/**
 * Категории содержимого архива. Дублирует набор из builds/index.ts (BuildExportCategory)
 * плюс серверные категории, потому что worker исполняется в отдельном потоке и не может
 * импортировать модули main-процесса.
 */
const CATEGORY_DIRS: Record<string, string[]> = {
  mods: ["mods"],
  resourcepacks: ["resourcepacks"],
  shaderpacks: ["shaderpacks"],
  saves: ["saves"],
  world: ["world", "world_nether", "world_the_end"],
  plugins: ["plugins"],
  configs: ["config", "eula.txt", "server.properties", "whitelist.json", "ops.json", "banned-players.json", "banned-ips.json", "usercache.json"],
  data: ["config", "options.txt", "servers.dat"],
  logs: ["logs", "crash-reports", ".cache", ".fabric", ".quilt"],
}

/**
 * Папки, которые идентичны во всех сборках и подключены junction-ссылкой
 * на общий кэш игр (см. shared-game-cache.ts). Их содержимое
 * восстанавливается при установке, поэтому в архив оно не попадает никогда.
 */
const SHARED_GAME_ENTRIES = new Set(["versions", "libraries", "assets"])

/**
 * Категории, которым принадлежит запись. Для файла в корне интента (нет папки)
 * верхним уровнем считается само имя файла — так `eula.txt` попадает в `configs`.
 */
function categoriesOf(relPath: string): string[] {
  const segments = relPath.replace(/\\/g, "/").split("/").filter(Boolean)
  const key = segments[0] ?? ""
  const matched: string[] = []
  for (const [cat, dirs] of Object.entries(CATEGORY_DIRS)) {
    if (dirs.includes(key)) matched.push(cat)
  }
  return matched
}

async function run(): Promise<void> {
  const { intentPath, archivePath, categories } = workerData as ZipWorkerData
  const post = (stage: "scan" | "compress", percent: number) => {
    parentPort?.postMessage({ type: "zip-progress", stage, percent } satisfies ZipProgressMessage)
  }

  try {
    post("scan", 5)
    const allEntries = await walkFiles(intentPath)

    // Пустой список = «всё содержимое» (кроме общих junction-папок).
    // Иначе включаем только выбранные категории.
    const filter = categories && categories.length > 0 ? new Set(categories) : null
    const entries = allEntries.filter((file) => {
      const relPath = path.relative(intentPath, file)
      if (SHARED_GAME_ENTRIES.has(relPath.replace(/\\/g, "/").split("/")[0])) return false
      if (!filter) return true
      return categoriesOf(relPath).some((c) => filter.has(c))
    })

    const total = entries.length
    if (total === 0) {
      throw new Error("Нечего загружать: выбранные категории не содержат файлов")
    }
    post("scan", 15)

    const zip = new AdmZip()
    for (let i = 0; i < total; i++) {
      const relPath = path.relative(intentPath, entries[i])
      zip.addLocalFile(entries[i], path.dirname(relPath).replace(/\\/g, "/"))
      const phase = (15 + Math.round((i + 1) / total * 70))
      post("compress", phase)
    }
    await fs.mkdir(path.dirname(archivePath), { recursive: true })
    zip.writeZip(archivePath)
    post("compress", 100)

    const result: ZipWorkerResult = { ok: true, archivePath }
    parentPort?.postMessage({ type: "zip-done", result } satisfies ZipDoneMessage)
  } catch (e) {
    const result: ZipWorkerResult = { ok: false, error: toErrorMessage(e) }
    parentPort?.postMessage({ type: "zip-done", result } satisfies ZipDoneMessage)
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue // junctions в общий кэш игр не пакуем
    if (entry.isDirectory()) {
      results.push(...await walkFiles(fullPath))
    } else {
      results.push(fullPath)
    }
  }
  return results
}

export type ZipProgressMessage = {
  type: "zip-progress"
  stage: "scan" | "compress"
  percent: number
}

export type ZipDoneMessage = {
  type: "zip-done"
  result: ZipWorkerResult
}

void run()