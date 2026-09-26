import fs from "fs/promises"
import { loadModsModule } from "./helpers"
import { inspectJar, primeJarInspectionCache } from "./jar-inspector"
import { logRuntime } from "../runtime"
import { dbHelpers } from "../../db"

export type ResolvedContentEntry = {
  sha1: string
  name: string
  description: string
  version: string
  icon_url?: string
  author?: string
  source: "local" | "modrinth" | "curseforge"
  projectId?: string
  versionId?: string
  modId?: number
  fileId?: number
}

type CfCandidate = {
  filePath: string
  sha1: string
}

type CfMatch = {
  modId: number
  fileId: number
  isAvailable?: boolean
}

/**
 * Batch-resolves CurseForge matches by fingerprint (sha1 as fallback), mirroring XMCL.
 * Returns `{ ok, matches }` — `ok` is false when the API call itself failed, so the
 * caller can avoid persisting the "checked" mark and retry on the next scan.
 */
async function resolveCurseforgeMatches(candidates: CfCandidate[]): Promise<{ ok: boolean; matches: Record<string, CfMatch> }> {
  const matches: Record<string, CfMatch> = {}
  if (candidates.length === 0) return { ok: true, matches }

  // Отпечаток CurseForge считается по всему содержимому файла, поэтому чтение
  // всех JAR-ов сразу — это сотни мегабайт в памяти одновременно. Держим ту же
  // умеренную параллельность, что и у остальных проходов. Отпечаток приходит из
  // общего кэша инспектора, если этот же файл уже разбирался на скане, — тогда
  // диск не читается повторно.
  const fingerprints = new Map<string, number>()
  const FINGERPRINT_CHUNK = 4
  for (let i = 0; i < candidates.length; i += FINGERPRINT_CHUNK) {
    const chunk = candidates.slice(i, i + FINGERPRINT_CHUNK)
    await Promise.all(chunk.map(async (candidate) => {
      try {
        const { curseforgeFingerprint } = await inspectJar(candidate.filePath, { curseforgeFingerprint: true })
        if (typeof curseforgeFingerprint === "number") {
          fingerprints.set(candidate.sha1, curseforgeFingerprint)
        }
      } catch {}
    }))
  }

  const values = [...new Set([...fingerprints.values()])].filter(n => Number.isFinite(n) && n > 0)
  if (values.length === 0) return { ok: true, matches }

  try {
    const mods = await loadModsModule()
    const result = await mods.curseforgeGetFingerprintsMatches(values)
    const byFingerprint = new Map(result.exactMatches.map(match => [match.fileFingerprint, match] as const))
    const bySha1 = new Map(result.exactMatches.filter(match => match.sha1).map(match => [match.sha1, match] as const))

    for (const { sha1 } of candidates) {
      const fingerprint = fingerprints.get(sha1)
      if (fingerprint === undefined) continue
      const match = byFingerprint.get(fingerprint) ?? bySha1.get(sha1)
      if (match && match.modId > 0) {
        matches[sha1] = { modId: match.modId, fileId: match.fileId }
      }
    }
  } catch {
    return { ok: false, matches }
  }

  return { ok: true, matches }
}

/**
 * Enriches cache entries with Modrinth metadata in the background: the network
 * resolution (hash -> project/version) runs AFTER the local result has been
 * returned, so the UI does not wait for the API. Results are written to the DB
 * and picked up on the next scan/refetch.
 */
function enrichWithModrinthInBackground(toParse: Array<{ filePath: string; sha1: string }>): void {
  if (toParse.length === 0) return
  void (async () => {
    try {
      const missingSha1s = [...new Set(toParse.map((entry) => entry.sha1))]
      const mods = await loadModsModule()
      const mrMap = await mods.modrinthGetFilesByHash(missingSha1s)

      const projectIds = [...new Set(Object.values(mrMap).map((m) => m.projectId))]
      const versionIds = [...new Set(Object.values(mrMap).map((m) => m.versionId).filter(Boolean))]

      let projectInfoMap: Record<string, { iconUrl: string; author?: string }> = {}
      let versionInfoMap: Record<string, { versionNumber?: string; name?: string }> = {}
      try {
        const [pMap, vMap] = await Promise.all([
          mods.modrinthGetProjectsByIds(projectIds),
          mods.modrinthGetVersionsByIds(versionIds),
        ])
        projectInfoMap = pMap
        versionInfoMap = vMap
      } catch {}

      // Пачкой: поштучные SELECT/INSERT в цикле давали N+1 запросов и столько же
      // коммитов на каждое фоновое обогащение.
      const matched = toParse.filter(({ sha1 }) => mrMap[sha1])
      const existingBySha1 = new Map(
        (await dbHelpers.getResources([...new Set(matched.map(({ sha1 }) => sha1))]))
          .map((resource) => [resource.sha1, resource] as const),
      )
      const updates: Array<Parameters<typeof dbHelpers.upsertResource>[0]> = []
      for (const { sha1 } of matched) {
        const found = mrMap[sha1]
        const existing = existingBySha1.get(sha1)
        // Never overwrite a source that is already known (e.g. CurseForge):
        // many mods exist on both platforms, so a hash match here is only a
        // guess and must not clobber an authoritative platform identity.
        if (existing?.source === "curseforge" || existing?.cfChecked === 1 || existing?.modId) continue

        const mrInfo = found.projectId ? projectInfoMap[found.projectId] : undefined
        const verInfo = found.versionId ? versionInfoMap[found.versionId] : undefined

        // At this point the record has no conflicting source, so claiming
        // Modrinth is safe. Missing fields are filled from Modrinth data.
        updates.push({
          sha1,
          name: existing?.name || "",
          description: existing?.description || "",
          version: verInfo?.versionNumber || existing?.version || verInfo?.name || "",
          icon: existing?.icon || mrInfo?.iconUrl || "",
          author: existing?.author || mrInfo?.author || "",
          source: "modrinth",
          projectId: found.projectId,
          versionId: found.versionId,
          modId: existing?.modId ?? null,
          fileId: existing?.fileId ?? null,
          cfChecked: existing?.cfChecked ?? 0,
        })
      }
      await dbHelpers.upsertResources(updates)
    } catch {
      // Background Modrinth enrichment is best-effort: fail silently.
    }
  })()
}

export async function resolveContentEntries(filePaths: string[], onProgress?: (processed: number, total: number) => void): Promise<Record<string, ResolvedContentEntry>> {
  const result: Record<string, ResolvedContentEntry> = {}
  if (filePaths.length === 0) return result

  const report = (processed: number, total: number) => {
    try { onProgress?.(Math.max(0, Math.min(processed, total)), total) } catch {}
  }
  let processed = 0

  const stats = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const stat = await fs.stat(filePath)
      return { filePath, stat }
    } catch {
      return null
    }
  }))
  const valid = stats.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const totalFiles = valid.length
  if (totalFiles === 0) return result

  const snapshots = await dbHelpers.getFileSnapshots(valid.map((entry) => entry.filePath))
  const snapshotByPath = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot]))

  const toHash: Array<{ filePath: string; size: number; mtime: number }> = []
  for (const { filePath, stat } of valid) {
    const snapshot = snapshotByPath.get(filePath)
    if (snapshot && snapshot.size === stat.size && snapshot.mtime === Math.round(stat.mtimeMs)) {
      continue
    }
    toHash.push({ filePath, size: stat.size, mtime: Math.round(stat.mtimeMs) })
  }

  // Единый инспектор: sha1 считается за тот же проход, что и всё остальное,
  // а результат кладётся в общий кэш по (path, size, mtime).
  const hashed = (await Promise.all(toHash.map(async ({ filePath, size, mtime }) => {
    const { sha1 } = await inspectJar(filePath, { sha1: true }, { size, mtimeMs: mtime })
    return sha1 ? { filePath, sha1, size, mtime } : null
  }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  // Снапшоты пишем одной транзакцией: при `synchronous` каждый отдельный
  // коммит — это fsync, а холодный скан даёт снапшот на каждый новый файл.
  await dbHelpers.upsertFileSnapshots(
    hashed.map(({ filePath, size, mtime, sha1 }) => ({ path: filePath, size, mtime, sha1 })),
  )
  const sha1ByPath = new Map<string, string>()
  for (const { filePath } of valid) {
    sha1ByPath.set(filePath, snapshotByPath.get(filePath)?.sha1 ?? "")
  }
  for (const { filePath, sha1 } of hashed) {
    sha1ByPath.set(filePath, sha1)
  }

  const sha1s = [...new Set(sha1ByPath.values()).values()].filter(Boolean)
  const resources = await dbHelpers.getResources(sha1s)
  const resourceBySha1 = new Map(resources.map((resource) => [resource.sha1, resource]))

  // Heal cache entries written by the old resolver: it stored CurseForge
  // project info with version === "" and wiped description, so a file whose
  // project got hidden by CF moderation shows junk ("now"/"no"). Revalidate
  // those projects; hidden ones get their cache zeroed so the file re-parses
  // with its own embedded metadata on this very scan.
  const suspectCf = resources.filter(r => r.source === "curseforge" && r.version === "" && r.modId)
  if (suspectCf.length > 0) {
    try {
      const mods = await loadModsModule()
      const ids = [...new Set(suspectCf.map(r => r.modId!).filter(Boolean))]
      const projects = await mods.curseforgeGetProjectsByIds(ids)
      const deadIds = new Set(ids.filter(id => projects[id]?.isAvailable === false))
      const cleared: Array<Parameters<typeof dbHelpers.upsertResource>[0]> = []
      for (const r of suspectCf) {
        if (!r.modId || !deadIds.has(r.modId)) continue
        cleared.push({
          sha1: r.sha1,
          name: "",
          description: "",
          version: "",
          icon: "",
          author: "",
          source: "local",
          projectId: null,
          versionId: null,
          modId: null,
          fileId: null,
          cfChecked: 0,
        })
        resourceBySha1.delete(r.sha1)
      }
      await dbHelpers.upsertResources(cleared)
    } catch {}
  }

  const toParse: Array<{ filePath: string; sha1: string }> = []
  const cachedWithoutIcon: Array<{ filePath: string; resource: Awaited<ReturnType<typeof dbHelpers.getResources>>[number] }> = []
  for (const { filePath, stat } of valid) {
    const sha1 = sha1ByPath.get(filePath)
    if (!sha1) continue
    const resource = resourceBySha1.get(sha1)
    if (resource && resource.name) {
      result[filePath] = {
        sha1,
        name: resource.name,
        description: resource.description,
        version: resource.version,
        icon_url: resource.icon || undefined,
        author: resource.author || undefined,
        source: (resource.source as ResolvedContentEntry["source"]) ?? "local",
        projectId: resource.projectId ?? undefined,
        versionId: resource.versionId ?? undefined,
        modId: resource.modId ?? undefined,
        fileId: resource.fileId ?? undefined,
      }
      if (!resource.icon && resource.projectId) {
        cachedWithoutIcon.push({ filePath, resource })
      }
    } else {
      toParse.push({ filePath, sha1 })
    }
  }

  // Modrinth enrichment (icons for cache entries without one) runs in the
  // background: the UI must not wait for network calls. Data is picked up on
  // the next scan.
  enrichCachedIconsInBackground(cachedWithoutIcon)

  const parsed: Array<{ filePath: string; entry: ResolvedContentEntry }> = []
  // Ресурсы кэшируем одной транзакцией после разбора всей пачки: коммит на
  // каждый файл превращался в fsync на каждый файл.
  const resourcesToCache: Array<Parameters<typeof dbHelpers.upsertResource>[0]> = []
  /**
   * Файлы, которые нужно разобрать в main. Заполняется либо полным списком
   * (когда worker не используется), либо остатком после сбоя worker'а.
   */
  let toParseForLocalFallback: Array<{ filePath: string; sha1: string }> = []

  const entryFromMetadata = (
    sha1: string,
    metadata: { name?: string; description?: string; version?: string; icon_url?: string; author?: string },
  ): { entry: ResolvedContentEntry; cachePayload: Parameters<typeof dbHelpers.upsertResource>[0] | null } => {
    const entry: ResolvedContentEntry = {
      sha1,
      name: metadata.name || "",
      description: metadata.description || "",
      version: metadata.version || "local",
      icon_url: metadata.icon_url,
      author: metadata.author,
      source: "local",
    }
    const cachePayload = metadata.name
      ? {
          sha1,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          icon: entry.icon_url ?? "",
          author: entry.author ?? "",
          source: entry.source,
          projectId: null,
          versionId: null,
          modId: null,
          fileId: null,
          cfChecked: 0,
        }
      : null
    return { entry, cachePayload }
  }

  /**
   * Холодный скан пачки новых JAR: разбор уходит в worker-поток, чтобы не
   * морозить main (на 163 модах это было ~4 секунды занятого event loop).
   * Метаданные и отпечаток приходят готовыми, main только пишет их в БД.
   * Если воркер упал или не уложился в таймаут, возвращаются файлы, которые
   * он не успел обработать, — их разбирает локальный путь.
   */
  const parseViaWorker = async (files: Array<{ filePath: string; sha1: string }>): Promise<boolean> => {
    const statByPath = new Map(valid.map(({ filePath, stat }) => [filePath, stat]))
    const workerFiles = files
      .map(({ filePath }) => {
        const stat = statByPath.get(filePath)
        return stat ? { filePath, size: stat.size, mtime: Math.round(stat.mtimeMs) } : null
      })
      .filter((file): file is { filePath: string; size: number; mtime: number } => file !== null)

    if (workerFiles.length !== files.length) return false

    const { runJarScanWorker } = await import("./scan-worker-client.js")
    const outcome = await runJarScanWorker(workerFiles, ({ filePath, size, mtime, inspection }) => {
      // Кладём результат в общий кэш main: иначе зависимости и требования
      // загрузчика перечитают те же JAR повторно.
      primeJarInspectionCache(filePath, { size, mtimeMs: mtime }, inspection)
      const sha1 = inspection.sha1 ?? ""
      if (!sha1) return
      const { entry, cachePayload } = entryFromMetadata(sha1, inspection.metadata ?? {})
      parsed.push({ filePath, entry })
      if (cachePayload) resourcesToCache.push(cachePayload)
    })

    if (outcome.ok) {
      processed += files.length
      report(processed, totalFiles)
      return true
    }

    // Воркер не справился: обработанные файлы пропускаем (иначе дубли),
    // остаток разбирается в main локальным путём.
    const processedPaths = new Set(outcome.processedPaths)
    const remaining = files.filter(({ filePath }) => !processedPaths.has(filePath))
    toParseForLocalFallback = remaining
    logRuntime(`[Scan] Worker обработал ${processedPaths.size} из ${files.length} файлов, остаток — в main`)
    processed += processedPaths.size
    report(processed, totalFiles)
    return remaining.length === 0
  }

  const WORKER_SCAN_THRESHOLD = 24
  let handledByWorker = false
  if (toParse.length >= WORKER_SCAN_THRESHOLD) {
    try {
      handledByWorker = await parseViaWorker(toParse)
    } catch (error) {
      logRuntime(`[Scan] Worker недоступен, сканирую в main: ${error instanceof Error ? error.message : String(error)}`)
      toParseForLocalFallback = toParse
      handledByWorker = false
    }
  } else {
    toParseForLocalFallback = toParse
  }

  if (!handledByWorker) {
    const PARSE_CHUNK = 8
    for (let i = 0; i < toParseForLocalFallback.length; i += PARSE_CHUNK) {
      const chunk = toParseForLocalFallback.slice(i, i + PARSE_CHUNK)
      const chunkResults = await Promise.all(chunk.map(async ({ filePath, sha1 }) => {
        // Local resolve: метаданные из архива без сети. Отпечаток CurseForge
        // считается в этом же проходе и позже берётся из кэша инспектора —
        // раньше это было второе полное чтение файла и murmur по всем байтам.
        const inspection = await inspectJar(filePath, { metadata: true, curseforgeFingerprint: true })
        const { entry, cachePayload } = entryFromMetadata(sha1, inspection.metadata ?? {})
        return { filePath, entry, cachePayload }
      }))
      for (const { filePath, entry, cachePayload } of chunkResults) {
        parsed.push({ filePath, entry })
        if (cachePayload) resourcesToCache.push(cachePayload)
      }
      processed += chunk.length
      report(processed, totalFiles)
    }
  }

  await dbHelpers.upsertResources(resourcesToCache)

  for (const { filePath, entry } of parsed) {
    result[filePath] = entry
  }

  // Network enrichment (Modrinth/CurseForge) runs in the background so the
  // return is not blocked by API calls.
  enrichWithModrinthInBackground(toParse)
  // CurseForge-сопоставление читает содержимое файла целиком, чтобы посчитать
  // отпечаток. Раньше в него попадали все файлы папки при каждом скане, даже
  // уже сопоставленные: открытие сборки на 286 модов читало все JAR-ы с диска
  // и считало murmurhash по каждому байту — это и была основная задержка
  // открытия инстанса. Отпечаток нужен только для тех записей, про которые
  // ещё неизвестно, есть ли они на CurseForge.
  enrichWithCurseforgeInBackground(
    valid
      .map(({ filePath }) => ({ filePath, sha1: sha1ByPath.get(filePath) ?? "" }))
      .filter((candidate) => candidate.sha1 && needsCurseforgeCheck(candidate.sha1, resourceBySha1)),
  )

  return result
}

/**
 * Нужно ли перепроверять файл на CurseForge: только если он не сопоставлен с
 * проектом и ранее не был помечен как проверенный.
 */
function needsCurseforgeCheck(
  sha1: string,
  resourceBySha1: Map<string, { modId?: number | null; cfChecked?: number | null }>,
): boolean {
  const resource = resourceBySha1.get(sha1)
  if (!resource) return true
  if (resource.modId) return false
  return resource.cfChecked !== 1
}

/** Background Modrinth icon fetch for already-cached entries without an icon. */
function enrichCachedIconsInBackground(
  cachedWithoutIcon: Array<{ filePath: string; resource: Awaited<ReturnType<typeof dbHelpers.getResources>>[number] }>,
): void {
  if (cachedWithoutIcon.length === 0) return
  void (async () => {
    try {
      const mods = await loadModsModule()
      const projectIds = [...new Set(cachedWithoutIcon.map((c) => c.resource.projectId!).filter(Boolean))]
      if (projectIds.length === 0) return
      const projectInfoMap = await mods.modrinthGetProjectsByIds(projectIds)
      const updates: Array<Parameters<typeof dbHelpers.upsertResource>[0]> = []
      for (const { resource } of cachedWithoutIcon) {
        const info = projectInfoMap[resource.projectId!]
        if (!info?.iconUrl) continue
        updates.push({
          sha1: resource.sha1,
          name: resource.name,
          description: resource.description,
          version: resource.version,
          icon: info.iconUrl,
          author: info.author ?? resource.author ?? "",
          source: resource.source,
          projectId: resource.projectId,
          versionId: resource.versionId,
          modId: resource.modId,
          fileId: resource.fileId,
          cfChecked: resource.cfChecked,
        })
      }
      await dbHelpers.upsertResources(updates)
    } catch {}
  })()
}

/** Background CurseForge match resolution (fingerprint -> modId/fileId). */
function enrichWithCurseforgeInBackground(candidates: CfCandidate[]): void {
  const pending = candidates.filter(c => c.sha1)
  if (pending.length === 0) return
  void (async () => {
    try {
      const cfResolution = await resolveCurseforgeMatches(pending)
      const cfMap = cfResolution.matches
      const cfModIds = [...new Set(Object.values(cfMap).filter(m => m.isAvailable !== false).map(m => m.modId))]
      let cfProjectInfoMap: Record<number, { name: string; iconUrl: string; author?: string }> = {}
      if (cfModIds.length > 0) {
        try {
          const mods = await loadModsModule()
          cfProjectInfoMap = await mods.curseforgeGetProjectsByIds(cfModIds)
        } catch {}
      }

      // Три батча (прочитанные записи, отметки CF, обновления) вместо трёх
      // запросов на каждый файл.
      const existingBySha1 = new Map(
        (await dbHelpers.getResources([...new Set(pending.map(({ sha1 }) => sha1))]))
          .map((resource) => [resource.sha1, resource] as const),
      )
      const checkedSha1s: string[] = []
      const cfMatches: Array<{ sha1: string; modId: number; fileId: number }> = []
      const updates: Array<Parameters<typeof dbHelpers.upsertResource>[0]> = []

      for (const { sha1 } of pending) {
        const match = cfMap[sha1]
        if (match && match.isAvailable === false) {
          checkedSha1s.push(sha1)
          continue
        }
        if (match) {
          const existing = existingBySha1.get(sha1)
          const cfInfo = cfProjectInfoMap[match.modId]
          cfMatches.push({ sha1, modId: match.modId, fileId: match.fileId })
          if (cfInfo) {
            updates.push({
              sha1,
              name: existing?.name || cfInfo.name,
              description: existing?.description || "",
              version: existing?.version || "",
              icon: existing?.icon || cfInfo.iconUrl || "",
              author: existing?.author || cfInfo.author || "",
              source: "curseforge",
              projectId: null,
              versionId: null,
              modId: match.modId,
              fileId: match.fileId,
              cfChecked: 1,
            })
          }
        } else if (cfResolution.ok) {
          checkedSha1s.push(sha1)
        }
      }

      try { await dbHelpers.markResourcesCurseforgeChecked(checkedSha1s) } catch {}
      try { await dbHelpers.setResourcesCurseforge(cfMatches) } catch {}
      await dbHelpers.upsertResources(updates)
    } catch {}
  })()
}
