// ============================================================
// XNLC — проверка требований модов к версии загрузчика
// ============================================================
//
// Сам разбор метаданных живёт в builds/loader-requirements.ts, а чтение JAR
// выполняет единый инспектор (builds/jar-inspector.ts): файл читается один раз
// и кладётся в общий кэш по (path, size, mtime), поэтому проверка требований
// после сканирования сборки диск не трогает.

import * as fs from "fs"
import * as path from "path"
import { inspectJar } from "./builds/jar-inspector"
import { satisfiesLoaderRequirement } from "./builds/version-range"
import { normalizeLoaderId, type ModArchiveRequirements } from "./builds/loader-requirements"

export type { ModArchiveRequirements, DeclaredRequirement } from "./builds/loader-requirements"

export interface LoaderRequirementEntry {
  fileName: string
  modName?: string
  modId?: string
  loaderId: string
  requirement: string
  buildLoaderVersion?: string
  satisfied: boolean
  reason?: string
}

export interface LoaderRequirementReport {
  loaderId: string
  loaderVersion?: string
  /** Сколько JAR-файлов удалось прочитать */
  checked: number
  /** Моды, объявившие требование к версии текущего загрузчика */
  issues: LoaderRequirementEntry[]
}

/**
 * Кэш готовых отчётов по папке модов. Даже с общим кэшем инспектора повторный
 * проход стоит `readdir` + `stat` на каждый JAR; здесь он превращается в
 * сравнение подписи папки (имена + размеры + mtime).
 */
const reportCache = new Map<string, { signature: string; report: LoaderRequirementReport }>()

const REPORT_CACHE_LIMIT = 64

/**
 * Читает требования мода к версии загрузчика из его JAR.
 * Возвращает `null`, если метаданные прочитать не удалось.
 */
export async function readModLoaderRequirements(filePath: string): Promise<ModArchiveRequirements | null> {
  const { loaderRequirements } = await inspectJar(filePath, { loaderRequirements: true })
  return loaderRequirements ?? null
}

const READ_CHUNK = 6

/**
 * Проверяет моды сборки: соответствует ли их требование к версии загрузчика
 * выбранной в сборке версии.
 */
export async function checkLoaderRequirements(
  modsDir: string,
  modLoader?: string,
  loaderVersion?: string,
): Promise<LoaderRequirementReport> {
  const loaderId = normalizeLoaderId(modLoader)
  const report: LoaderRequirementReport = { loaderId, loaderVersion, checked: 0, issues: [] }
  if (!loaderId || loaderId === "vanilla" || loaderId === "instance") return report

  let files: string[]
  try {
    files = (await fs.promises.readdir(modsDir)).filter(name => name.toLowerCase().endsWith(".jar"))
  } catch {
    return report
  }

  // Один `stat` на файл — из него и подпись папки, и ключ кэша инспектора.
  const entries: Array<{ fileName: string; filePath: string; size: number; mtimeMs: number }> = []
  await Promise.all(files.map(async (fileName) => {
    const filePath = path.join(modsDir, fileName)
    try {
      const stat = await fs.promises.stat(filePath)
      // Гигантские JAR-ы (шейдерпаки/сборки внутри мода) не читаем целиком.
      if (stat.size > 80 * 1024 * 1024) return
      entries.push({ fileName, filePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) })
    } catch {
      // Файл исчез между readdir и stat — пропускаем.
    }
  }))
  entries.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0))

  const signature = `${loaderId}|${loaderVersion ?? ""}|` +
    entries.map(entry => `${entry.fileName}:${entry.size}:${entry.mtimeMs}`).join("|")
  const cachedReport = reportCache.get(modsDir)
  if (cachedReport && cachedReport.signature === signature) {
    return cachedReport.report
  }

  for (let i = 0; i < entries.length; i += READ_CHUNK) {
    const chunk = entries.slice(i, i + READ_CHUNK)
    const results = await Promise.all(chunk.map(async ({ fileName, filePath }) => {
      const requirements = await readModLoaderRequirements(filePath)
      return requirements ? { fileName, requirements } : null
    }))

    for (const result of results) {
      if (!result) continue
      report.checked += 1

      const declared = result.requirements.requirements.find(item => normalizeLoaderId(item.loaderId) === loaderId)
      if (!declared) continue

      if (!loaderVersion) {
        // Версия загрузчика в сборке не выбрана — сравнивать не с чем.
        report.issues.push({
          fileName: result.fileName,
          modName: result.requirements.modName,
          modId: result.requirements.modId,
          loaderId,
          requirement: declared.requirement,
          satisfied: true,
          reason: "loader-version-unknown",
        })
        continue
      }

      const satisfied = satisfiesLoaderRequirement(loaderVersion, declared.requirement)
      report.issues.push({
        fileName: result.fileName,
        modName: result.requirements.modName,
        modId: result.requirements.modId,
        loaderId,
        requirement: declared.requirement,
        buildLoaderVersion: loaderVersion,
        satisfied,
      })
    }
  }

  if (reportCache.size >= REPORT_CACHE_LIMIT) {
    // Ключей немного (по одному на сборку), но при импорте их может стать много.
    reportCache.clear()
  }
  reportCache.set(modsDir, { signature, report })
  return report
}
