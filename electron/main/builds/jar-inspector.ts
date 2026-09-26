// ============================================================
// XNLC — единый инспектор JAR
// ============================================================
//
// Раньше один и тот же JAR читался целиком несколько раз независимо друг от
// друга: sha1 (content-resolver), метаданные (builds/metadata) и отпечаток
// CurseForge (builds/fingerprint), плюс отдельные парсеры в
// mods-loader-requirements и mods-jar-deps со своими кэшами. На холодном скане
// папки модов это давало 3–4 полных прохода по одним и тем же данным и
// блокировало main-процесс.
//
// Здесь файл читается один раз, а результат (sha1 / отпечаток / метаданные /
// требования к загрузчику / объявленные зависимости) кладётся в общий кэш по
// ключу (path, size, mtime). Повторное обращение к тому же неизменённому файлу
// диск не трогает вообще; разные потребители дополняют одну запись кэша,
// а не держат собственные.

import fs from "fs/promises"
import crypto from "crypto"
import { loadAdmZip, type AdmZipType } from "./archive-utils"
import { parseModMetadataFromZip, type ModMetadata } from "./metadata"
import { computeFingerprintFromBuffer } from "./fingerprint"
import { readModLoaderRequirementsFromZip, type ModArchiveRequirements } from "./loader-requirements"
import { readDeclaredDependenciesFromZip, type JarDeclaredDependency } from "./jar-dependencies"

export type JarDeclaredDependencies = { modId: string | null; declared: JarDeclaredDependency[] }

/** Какие части инспекции нужны вызывающему. Считаются только они. */
export type JarInspectionRequest = {
  sha1?: boolean
  curseforgeFingerprint?: boolean
  metadata?: boolean
  loaderRequirements?: boolean
  dependencies?: boolean
}

export type JarInspection = {
  sha1?: string
  /** `null` — файл слишком большой для полного чтения, отпечаток не считался. */
  curseforgeFingerprint?: number | null
  metadata?: ModMetadata
  loaderRequirements?: ModArchiveRequirements | null
  dependencies?: JarDeclaredDependencies
}

type JarInspectionCacheEntry = {
  size: number
  mtime: number
  sha1?: string
  curseforgeFingerprint?: number | null
  metadata?: ModMetadata
  loaderRequirements?: ModArchiveRequirements | null
  dependencies?: JarDeclaredDependencies
}

const inspectionCache = new Map<string, JarInspectionCacheEntry>()
/**
 * Потолок кэша. Записи содержат метаданные с иконкой (data-URL), поэтому
 * держим примерно «одну большую сборку плюс запас», а не безлимит.
 */
const INSPECTION_CACHE_LIMIT = 800
/** Файлы больше этого размера не читаем целиком ради метаданных и отпечатка. */
const FULL_READ_LIMIT = 80 * 1024 * 1024
/** Порог, после которого sha1 считается потоком, а не через чтение в память. */
const STREAM_THRESHOLD = 65536 * 20

/** Потоковый sha1: большие JAR не тянем в память целиком. */
export async function sha1OfFile(filePath: string, size: number): Promise<string> {
  if (size > STREAM_THRESHOLD) {
    const hash = crypto.createHash("sha1")
    const handle = await fs.open(filePath, "r")
    try {
      for await (const chunk of handle.createReadStream()) {
        hash.update(chunk)
      }
    } finally {
      await handle.close()
    }
    return hash.digest("hex")
  }
  return sha1OfBuffer(await fs.readFile(filePath))
}

export function sha1OfBuffer(buffer: Buffer): string {
  return crypto.createHash("sha1").update(buffer).digest("hex")
}

function getCacheEntry(filePath: string, size: number, mtime: number): JarInspectionCacheEntry {
  const cached = inspectionCache.get(filePath)
  if (cached && cached.size === size && cached.mtime === mtime) {
    return cached
  }
  if (inspectionCache.size >= INSPECTION_CACHE_LIMIT) {
    // Ключей примерно столько же, сколько JAR-ов на диске; при переполнении
    // дешевле сбросить кэш, чем городить LRU.
    inspectionCache.clear()
  }
  const fresh: JarInspectionCacheEntry = { size, mtime }
  inspectionCache.set(filePath, fresh)
  return fresh
}

/** Сбрасывает общий кэш инспекций (импорт, подмена файлов, смена папки интентов). */
export function clearJarInspectionCache(): void {
  inspectionCache.clear()
}

/**
 * Кладёт в кэш результат, посчитанный вне main-процесса (worker холодного
 * сканирования). Без этого main перечитывал бы те же JAR повторно при первом
 * же обращении к зависимостям или требованиям загрузчика.
 */
export function primeJarInspectionCache(
  filePath: string,
  stat: { size: number; mtimeMs: number },
  inspection: JarInspection,
): void {
  const entry = getCacheEntry(filePath, stat.size, Math.round(stat.mtimeMs))
  if (inspection.sha1 !== undefined) entry.sha1 = inspection.sha1
  if (inspection.curseforgeFingerprint !== undefined) entry.curseforgeFingerprint = inspection.curseforgeFingerprint
  if (inspection.metadata !== undefined) entry.metadata = inspection.metadata
  if (inspection.loaderRequirements !== undefined) entry.loaderRequirements = inspection.loaderRequirements
  if (inspection.dependencies !== undefined) entry.dependencies = inspection.dependencies
}

/**
 * Инспектирует JAR за один проход по диску. Уже посчитанные части берутся из
 * общего кэша по (path, size, mtime), поэтому последовательные вызовы разных
 * потребителей не читают файл повторно.
 */
export async function inspectJar(
  filePath: string,
  request: JarInspectionRequest = {},
  knownStat?: { size: number; mtimeMs: number },
): Promise<JarInspection> {
  let size: number
  let mtime: number
  try {
    if (knownStat) {
      size = knownStat.size
      mtime = Math.round(knownStat.mtimeMs)
    } else {
      const stat = await fs.stat(filePath)
      size = stat.size
      mtime = Math.round(stat.mtimeMs)
    }
  } catch {
    return {}
  }

  const entry = getCacheEntry(filePath, size, mtime)

  const needSha1 = request.sha1 === true && entry.sha1 === undefined
  const needFingerprint = request.curseforgeFingerprint === true && entry.curseforgeFingerprint === undefined
  const needMetadata = request.metadata === true && entry.metadata === undefined
  const needRequirements = request.loaderRequirements === true && entry.loaderRequirements === undefined
  const needDependencies = request.dependencies === true && entry.dependencies === undefined
  const needsZip = needMetadata || needRequirements || needDependencies

  if (needSha1 || needFingerprint || needsZip) {
    if (size > FULL_READ_LIMIT) {
      // Гигантский архив (шейдерпак, сборка внутри мода): читаем только потоком.
      if (needSha1) entry.sha1 = await sha1OfFile(filePath, size)
      if (needFingerprint) entry.curseforgeFingerprint = null
      if (needMetadata) entry.metadata = {}
      if (needRequirements) entry.loaderRequirements = null
      if (needDependencies) entry.dependencies = { modId: null, declared: [] }
    } else {
      let buffer: Buffer
      try {
        buffer = await fs.readFile(filePath)
      } catch {
        return {}
      }

      // Порядок важен: подсчёт отпечатка CurseForge мутирует буфер (схлопывает
      // пробельные байты на месте), поэтому ZIP разбирается раньше, а sha1 —
      // до всего остального.
      if (needSha1) entry.sha1 = sha1OfBuffer(buffer)

      let zip: AdmZipType | null = null
      if (needsZip) {
        try {
          const AdmZip = await loadAdmZip()
          zip = new AdmZip(buffer)
        } catch {
          zip = null
        }
      }

      if (zip) {
        if (needMetadata) entry.metadata = await parseModMetadataFromZip(zip)
        if (needRequirements) entry.loaderRequirements = await readModLoaderRequirementsFromZip(zip)
        if (needDependencies) entry.dependencies = await readDeclaredDependenciesFromZip(zip)
      } else if (needsZip) {
        if (needMetadata) entry.metadata = {}
        if (needRequirements) entry.loaderRequirements = null
        if (needDependencies) entry.dependencies = { modId: null, declared: [] }
      }

      if (needFingerprint) entry.curseforgeFingerprint = computeFingerprintFromBuffer(buffer)
    }
  }

  return {
    sha1: entry.sha1,
    curseforgeFingerprint: entry.curseforgeFingerprint,
    metadata: entry.metadata,
    loaderRequirements: entry.loaderRequirements,
    dependencies: entry.dependencies,
  }
}
