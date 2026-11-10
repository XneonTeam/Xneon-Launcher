import { toErrorMessage } from "../errors"
import { parentPort, workerData } from "worker_threads"
import path from "path"
import fs from "fs/promises"
import AdmZip from "adm-zip"
import { META_ICON_ENTRY, META_NAME_ENTRY } from "./archive-meta"

interface ZipWorkerData {
  intentPath: string
  archivePath: string
  /** Опциональный фильтр: включать только эти категории (mods/saves/logs/...). */
  categories?: string[]
  /** Иконка сборки (data-URL). Хранится в БД, а не в интенте, поэтому кладётся в архив отдельно. */
  icon?: string
  /** Настоящее имя сборки/сервера: имя файла архива санитизировано и теряет `:`, `?`, `*`. */
  name?: string
}

interface ZipWorkerResult {
  ok: boolean
  archivePath?: string
  error?: string
}

import { EXPORT_CATEGORY_DIRS, SHARED_GAME_ENTRIES, categoriesOf as categoriesOfEntry } from "./categories.js"

/** Категории, которым принадлежит запись. См. categories.ts. */
function categoriesOf(relPath: string): string[] {
  return categoriesOfEntry(relPath, EXPORT_CATEGORY_DIRS)
}

async function run(): Promise<void> {
  const { intentPath, archivePath, categories, icon, name } = workerData as ZipWorkerData
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

    // Иконка сборки живёт в БД (data-URL), а не в папке интента, поэтому в общий
    // обход файлов она не попадает. Добавляем её отдельной метазаписью, чтобы при
    // восстановлении из облака иконка не терялась. Пустую иконку не пишем.
    if (icon && icon.trim()) {
      zip.addFile(META_ICON_ENTRY, Buffer.from(icon, "utf-8"))
    }

    // Настоящее имя сборки: по имени файла архива оно уже не восстановится.
    if (name && name.trim()) {
      zip.addFile(META_NAME_ENTRY, Buffer.from(name, "utf-8"))
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