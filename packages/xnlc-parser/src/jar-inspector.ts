import fs from "node:fs/promises"
import { sha1File, curseforgeFingerprintFile } from "./utilities.js"
import type { ParserDiagnostic } from "./metadata.js"
import { inspectArchive, type ContentMetadata } from "./archive-inspection.js"
import type { ModArchiveRequirements } from "./loader-requirements.js"
import type { JarDeclaredDependency } from "./jar-dependencies.js"

export type JarDeclaredDependencies = { modId: string | null; declared: JarDeclaredDependency[] }
export type JarInspectionRequest = { sha1?: boolean; curseforgeFingerprint?: boolean; metadata?: boolean; loaderRequirements?: boolean; dependencies?: boolean; signal?: AbortSignal }
export type JarInspection = { diagnostics?: ParserDiagnostic[]; sha1?: string; curseforgeFingerprint?: number | null; metadata?: ContentMetadata; loaderRequirements?: ModArchiveRequirements | null; dependencies?: JarDeclaredDependencies }
type CacheEntry = JarInspection & { size: number; mtime: number }
const cache = new Map<string, CacheEntry>()

function getCacheEntry(filePath: string, size: number, mtime: number): CacheEntry {
  const existing = cache.get(filePath)
  if (existing && existing.size === size && existing.mtime === mtime) return existing
  if (cache.size >= 800) cache.clear()
  const entry: CacheEntry = { size, mtime }
  cache.set(filePath, entry)
  return entry
}

type RequirementSnapshot = { size: number; mtimeMs: number; ctimeMs: number }
const requirementsCache = new Map<string, { snapshot: RequirementSnapshot; requirements: ModArchiveRequirements | null }>()

/** Повторно используем требования, полученные worker при обычном скане. */
export function rememberLoaderRequirements(filePath: string, snapshot: RequirementSnapshot, inspection?: JarInspection): void {
  if (inspection?.loaderRequirements === undefined) return
  if (requirementsCache.size >= 2048) {
    const first = requirementsCache.keys().next()
    if (!first.done) requirementsCache.delete(first.value)
  }
  requirementsCache.set(filePath, { snapshot, requirements: inspection.loaderRequirements })
}

export function cachedLoaderRequirements(filePath: string, snapshot: RequirementSnapshot): ModArchiveRequirements | null | undefined {
  const entry = requirementsCache.get(filePath)
  const previous = entry?.snapshot
  if (previous && previous.size === snapshot.size && previous.mtimeMs === snapshot.mtimeMs && previous.ctimeMs === snapshot.ctimeMs) return entry.requirements
}

export async function inspectJar(filePath: string, request: JarInspectionRequest = {}, knownStat?: { size: number; mtimeMs: number }): Promise<JarInspection> {
  request.signal?.throwIfAborted()
  const stat = knownStat ?? await fs.stat(filePath).catch(() => null)
  if (!stat) return { diagnostics: [{ code: "SCAN_ERROR", message: "Cannot stat content file" }] }
  const size = stat.size, mtime = Math.round(stat.mtimeMs)
  const entry = getCacheEntry(filePath, size, mtime)
  const needSha1 = request.sha1 && entry.sha1 === undefined
  const needFingerprint = request.curseforgeFingerprint && entry.curseforgeFingerprint === undefined
  const needMetadata = request.metadata && entry.metadata === undefined
  const needRequirements = request.loaderRequirements && entry.loaderRequirements === undefined
  const needDependencies = request.dependencies && entry.dependencies === undefined
  try {
    if (needSha1) entry.sha1 = await sha1File(filePath, { maxSize: Number.MAX_SAFE_INTEGER, signal: request.signal })
    if (needFingerprint) entry.curseforgeFingerprint = await curseforgeFingerprintFile(filePath, { maxSize: Number.MAX_SAFE_INTEGER, signal: request.signal })
    if (needMetadata || needRequirements || needDependencies) {
      try {
        const result = await inspectArchive(filePath, { metadata: !!needMetadata, dependencies: !!needDependencies, loaderRequirements: !!needRequirements, signal: request.signal })
        entry.diagnostics = result.diagnostics
        if (needMetadata) entry.metadata = result.metadata ?? {}
        if (needRequirements) entry.loaderRequirements = result.loaderRequirements ?? null
        if (needDependencies) entry.dependencies = result.dependencies ?? { modId: null, declared: [] }
      } catch (error) {
        request.signal?.throwIfAborted()
        // Повреждённый архив остаётся в списке, вычисленные хеши сохраняются.
        entry.diagnostics = [{ code: (error as { code?: string })?.code ?? "SCAN_ERROR", message: error instanceof Error ? error.message : String(error) }]
        if (cache.get(filePath) === entry) cache.delete(filePath)
      }
    }
    const current = await fs.stat(filePath).catch(() => null)
    request.signal?.throwIfAborted()
    if (!current || current.size !== size || Math.round(current.mtimeMs) !== mtime) {
      if (cache.get(filePath) === entry) cache.delete(filePath)
      return { diagnostics: [{ code: "SCAN_ERROR", message: "Content file changed during scan" }] }
    }
  } catch (error) {
    if (cache.get(filePath) === entry) cache.delete(filePath)
    throw error
  }
  return { diagnostics: entry.diagnostics, sha1: entry.sha1, curseforgeFingerprint: entry.curseforgeFingerprint, metadata: entry.metadata, loaderRequirements: entry.loaderRequirements, dependencies: entry.dependencies }
}
