import { contentMetadataEvents } from "./content-metadata-events"
import { normalizeContentIcon } from "./content-icon"
import fs from "fs/promises"
import { loadModsModule } from "./helpers"
import { runScanWorker, type JarInspection } from "@xnlc/parser"
import parserPackage from "../../../packages/xnlc-parser/package.json"
import { dbHelpers } from "../../db"

const parserVersion = `@xnlc/parser@${parserPackage.version}`

export type ResolvedContentEntry = {
  diagnostics?: import("@xnlc/parser").ParserDiagnostic[]
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
  size: number
  mtimeMs: number
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

  // Отпечаток читается по тому же снимку файла, которому принадлежит SHA-1.
  const fingerprints = new Map<string, number>()
  const candidatesByPath = new Map(candidates.map(candidate => [candidate.filePath, candidate]))
  try {
    await runScanWorker(candidates, { curseforgeFingerprint: true }, result => {
      const candidate = candidatesByPath.get(result.filePath)
      const fingerprint = result.inspection?.curseforgeFingerprint
      if (candidate && typeof fingerprint === "number") fingerprints.set(candidate.sha1, fingerprint)
    })
  } catch { return { ok: false, matches } }

  const values = [...new Set([...fingerprints.values()])].filter(n => Number.isFinite(n) && n > 0)
  if (values.length === 0) return { ok: false, matches }

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

  return { ok: fingerprints.size === candidates.length, matches }
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
        const updated = {
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
        }
        if (!existing || Object.entries(updated).some(([key, value]) => existing[key as keyof typeof existing] !== value)) updates.push(updated)
      }
      await dbHelpers.upsertResources(updates)
      if (updates.length) contentMetadataEvents.emit("updated", toParse.map(item => item.filePath))
    } catch {
      // Background Modrinth enrichment is best-effort: fail silently.
    }
  })()
}

export async function resolveContentEntries(filePaths: string[], onProgress?: (processed: number, total: number) => void, signal?: AbortSignal): Promise<Record<string, ResolvedContentEntry>> {
  signal?.throwIfAborted()
  const result: Record<string, ResolvedContentEntry> = {}
  if (filePaths.length === 0) return result
  const markUnreadable = (filePath: string, message: string) => {
    result[filePath] = {
      sha1: "", name: "", description: "", version: "local", source: "local",
      diagnostics: [{ code: "SCAN_ERROR", message }],
    }
  }

  const report = (processed: number, total: number) => {
    try { onProgress?.(Math.max(0, Math.min(processed, total)), total) } catch {}
  }
  let processed = 0

  const stats = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const stat = await fs.stat(filePath)
      return { filePath, stat }
    } catch (error) {
      markUnreadable(filePath, String(error))
      return null
    }
  }))
  const valid = stats.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const fileStats = new Map(valid.map(({ filePath, stat }) => [filePath, stat]))
  signal?.throwIfAborted()
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

  // Сначала SHA-1. Метаданные известного содержимого уже есть в SQLite:
  // новый путь/mtime не повод повторно распаковывать PNG внутри каждого JAR.
  const coldInspections = new Map<string, JarInspection>()
  const hashed: Array<{ filePath: string; sha1: string; size: number; mtime: number }> = []
  const hashFiles = new Map(toHash.map(file => [file.filePath, file]))
  try {
    await runScanWorker(toHash.map(file => ({ filePath: file.filePath, size: file.size, mtimeMs: file.mtime })), { sha1: true, cacheMetadata: false }, item => {
      const file = hashFiles.get(item.filePath)
      if (!file) return
      hashFiles.delete(item.filePath)
      const sha1 = item.inspection?.sha1
      if (sha1 && item.inspection) {
        hashed.push({ ...file, sha1 })
        // SQLite сохраняет metadata, поэтому парсер не держит второй набор
        // оригинальных PNG. Здесь тоже сохраняем только готовое превью, а не
        // собираем полноразмерные иконки всей папки до конца холодного прохода.
        const metadata = item.inspection.metadata
        if (metadata) coldInspections.set(file.filePath, metadata.icon_url ? {
          ...item.inspection, metadata: { ...metadata, icon_url: normalizeContentIcon(metadata.icon_url) },
        } : item.inspection)
      }
      else markUnreadable(file.filePath, item.error ?? item.inspection?.diagnostics?.[0]?.message ?? "Cannot hash content file")
      report(++processed, totalFiles)
    }, signal)
  } catch (error) {
    signal?.throwIfAborted()
    for (const file of hashFiles.values()) markUnreadable(file.filePath, String(error))
    hashFiles.clear()
  }
  for (const file of hashFiles.values()) markUnreadable(file.filePath, "Scan worker did not return a result")
  signal?.throwIfAborted()
  // Снапшоты пишем одной транзакцией: при `synchronous` каждый отдельный
  // коммит — это fsync, а холодный скан даёт снапшот на каждый новый файл.
  await dbHelpers.upsertFileSnapshots(
    hashed.map(({ filePath, size, mtime, sha1 }) => ({ path: filePath, size, mtime, sha1 })),
  )
  const sha1ByPath = new Map<string, string>()
  for (const { filePath } of valid) {
    sha1ByPath.set(filePath, result[filePath] ? "" : snapshotByPath.get(filePath)?.sha1 ?? "")
  }
  for (const { filePath, sha1 } of hashed) {
    sha1ByPath.set(filePath, sha1)
  }

  const sha1s = [...new Set(sha1ByPath.values()).values()].filter(Boolean)
  const resources = await dbHelpers.getResources(sha1s)
  // Старые БД содержат полноразмерные PNG. Нормализуем лениво при чтении:
  // иначе каждый rescan снова сериализует мегабайты base64 в renderer.
  const iconUpdates: Array<{ sha1: string; previous: string; icon: string }> = []
  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i], icon = normalizeContentIcon(resource.icon)
    if (icon !== resource.icon) {
      iconUpdates.push({ sha1: resource.sha1, previous: resource.icon, icon })
      resource.icon = icon
    }
    if (i % 4 === 3) await new Promise<void>(resolve => setImmediate(resolve))
    signal?.throwIfAborted()
  }
  if (iconUpdates.length) await dbHelpers.updateResourceIcons(iconUpdates)
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
    const staleLocalParser = resource?.source === "local" && resource.parserVersion !== parserVersion
    if (resource && (resource.name || resource.source === "modrinth" || resource.source === "curseforge" || resource.parserVersion === parserVersion) && !staleLocalParser) {
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
  const entryFromMetadata = (
    sha1: string,
    metadata: { name?: string; description?: string; version?: string; icon_url?: string; author?: string },
    cacheable = false,
  ): { entry: ResolvedContentEntry; cachePayload: Parameters<typeof dbHelpers.upsertResource>[0] | null } => {
    const existing = resourceBySha1.get(sha1)
    const entry: ResolvedContentEntry = {
      sha1,
      name: metadata.name || existing?.name || "",
      description: metadata.description || existing?.description || "",
      version: metadata.version || existing?.version || "local",
      icon_url: normalizeContentIcon(metadata.icon_url || existing?.icon || "") || undefined,
      author: metadata.author || existing?.author || undefined,
      source: (existing?.source as ResolvedContentEntry["source"]) ?? "local",
      projectId: existing?.projectId ?? undefined,
      versionId: existing?.versionId ?? undefined,
      modId: existing?.modId ?? undefined,
      fileId: existing?.fileId ?? undefined,
    }
    const cachePayload = cacheable
      ? {
          sha1,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          icon: entry.icon_url ?? "",
          author: entry.author ?? "",
          source: entry.source,
          projectId: existing?.projectId ?? null,
          versionId: existing?.versionId ?? null,
          modId: existing?.modId ?? null,
          fileId: existing?.fileId ?? null,
          cfChecked: existing?.cfChecked ?? 0,
          parserVersion,
        }
      : null
    return { entry, cachePayload }
  }

  const acceptInspection = (file: typeof toParse[number], inspection?: JarInspection, error?: string, counted = false) => {
    const { entry, cachePayload } = entryFromMetadata(file.sha1, inspection?.metadata ?? {}, !!inspection?.metadata && !inspection.diagnostics?.length)
    const diagnostics = error ? [{ code: "SCAN_ERROR", message: error }] : inspection?.diagnostics
    parsed.push({ filePath: file.filePath, entry: { ...entry, diagnostics } })
    if (cachePayload) resourcesToCache.push(cachePayload)
    if (!counted) report(++processed, totalFiles)
    signal?.throwIfAborted()
  }
  const parseFiles = new Map<string, typeof toParse[number]>()
  for (const file of toParse) {
    const inspection = coldInspections.get(file.filePath)
    if (inspection) acceptInspection(file, inspection, undefined, true)
    else parseFiles.set(file.filePath, file)
  }
  try {
    await runScanWorker([...parseFiles.values()].map(file => {
      const stat = fileStats.get(file.filePath)
      return { ...file, size: stat?.size, mtimeMs: stat ? Math.round(stat.mtimeMs) : undefined }
    }), { metadata: true, cacheMetadata: false }, item => {
      const file = parseFiles.get(item.filePath)
      if (!file) return
      parseFiles.delete(item.filePath)
      acceptInspection(file, item.inspection, item.error)
    }, signal)
  } catch (error) {
    signal?.throwIfAborted()
    for (const file of parseFiles.values()) parsed.push({ filePath: file.filePath, entry: { ...entryFromMetadata(file.sha1, {}).entry, diagnostics: [{ code: "SCAN_ERROR", message: String(error) }] } })
    parseFiles.clear()
  }
  for (const file of parseFiles.values()) parsed.push({ filePath: file.filePath, entry: { ...entryFromMetadata(file.sha1, {}).entry, diagnostics: [{ code: "SCAN_ERROR", message: "Scan worker did not return a result" }] } })

  signal?.throwIfAborted()
  await dbHelpers.upsertResources(resourcesToCache)
  signal?.throwIfAborted()

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
      .map(({ filePath, stat }) => ({ filePath, sha1: sha1ByPath.get(filePath) ?? "", size: stat.size, mtimeMs: Math.round(stat.mtimeMs) }))
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
      if (updates.length) contentMetadataEvents.emit("updated", cachedWithoutIcon.map(item => item.filePath))
    } catch {}
  })()
}

/** Background CurseForge match resolution (fingerprint -> modId/fileId). */
const pendingFingerprints = new Set<string>()

function enrichWithCurseforgeInBackground(candidates: CfCandidate[]): void {
  const keys: string[] = []
  const pending = candidates.filter(candidate => {
    if (!candidate.sha1) return false
    const key = JSON.stringify([candidate.filePath, candidate.sha1, candidate.size, candidate.mtimeMs])
    if (pendingFingerprints.has(key)) return false
    pendingFingerprints.add(key)
    keys.push(key)
    return true
  })
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
      if (updates.length) contentMetadataEvents.emit("updated", pending.map(item => item.filePath))
    } catch {} finally {
      for (const key of keys) pendingFingerprints.delete(key)
    }
  })()
}
