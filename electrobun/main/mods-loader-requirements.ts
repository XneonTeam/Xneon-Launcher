// ============================================================
// XNLC — проверка требований модов к версии загрузчика
// ============================================================
//
// Парсер возвращает требования JAR, а здесь формируется отчёт для сборки.

import * as fs from "fs"
import * as path from "path"
import { cachedLoaderRequirements, inspectJar, rememberLoaderRequirements, runScanWorker, satisfiesLoaderRequirement, normalizeLoaderId, type ModArchiveRequirements } from "@xnlc/parser"

export type { ModArchiveRequirements, DeclaredRequirement } from "@xnlc/parser"

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
  const entries: Array<{ fileName: string; filePath: string; size: number; mtimeMs: number; ctimeMs: number }> = []
  await Promise.all(files.map(async (fileName) => {
    const filePath = path.join(modsDir, fileName)
    try {
      const stat = await fs.promises.stat(filePath)
      // XNLC читает отдельные entries, без полного чтения большого JAR.
      entries.push({ fileName, filePath, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs })
    } catch {
      // Файл исчез между readdir и stat — пропускаем.
    }
  }))
  entries.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0))

  const signature = `${loaderId}|${loaderVersion ?? ""}|` +
    entries.map(entry => `${entry.fileName}:${entry.size}:${entry.mtimeMs}:${entry.ctimeMs}`).join("|")
  const cachedReport = reportCache.get(modsDir)
  if (cachedReport && cachedReport.signature === signature) {
    return cachedReport.report
  }

  const scanned = new Map<string, ModArchiveRequirements>()
  const missing = new Map<string, typeof entries[number]>()
  for (const entry of entries) {
    const cached = cachedLoaderRequirements(entry.filePath, entry)
    if (cached === undefined) missing.set(entry.filePath, entry)
    else if (cached) scanned.set(entry.filePath, cached)
  }
  let complete = true
  try {
    await runScanWorker([...missing.values()], { loaderRequirements: true }, result => {
      const entry = missing.get(result.filePath)
      if (entry) rememberLoaderRequirements(result.filePath, entry, result.inspection)
      if (result.inspection?.loaderRequirements === undefined) complete = false
      if (result.inspection?.loaderRequirements) scanned.set(result.filePath, result.inspection.loaderRequirements)
    })
  } catch {
    return report
  }
  for (let i = 0; i < entries.length; i += READ_CHUNK) {
    const chunk = entries.slice(i, i + READ_CHUNK)
    const results = chunk.map(({ fileName, filePath }) => {
      const requirements = scanned.get(filePath)
      return requirements ? { fileName, requirements } : null
    })

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

  if (!complete) return report
  if (reportCache.size >= REPORT_CACHE_LIMIT) {
    // Ключей немного (по одному на сборку), но при импорте их может стать много.
    reportCache.clear()
  }
  reportCache.set(modsDir, { signature, report })
  return report
}
