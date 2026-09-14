import fs from "fs/promises"
import crypto from "crypto"
import { loadModsModule } from "./helpers"
import { readModMetadataFromArchive } from "./metadata"
import { computeFingerprint } from "./fingerprint"
import { dbHelpers } from "../../db"

const STREAM_THRESHOLD = 65536 * 20

export async function hashResource(filePath: string, size: number): Promise<string> {
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
  const hash = crypto.createHash("sha1")
  hash.update(await fs.readFile(filePath))
  return hash.digest("hex")
}

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

  const fingerprints = new Map<string, number>()
  await Promise.all(candidates.map(async (candidate) => {
    try {
      fingerprints.set(candidate.sha1, await computeFingerprint(candidate.filePath))
    } catch {}
  }))

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

export async function resolveContentEntry(filePath: string): Promise<ResolvedContentEntry | null> {
  try {
    const stat = await fs.stat(filePath)
    const [snapshot] = await dbHelpers.getFileSnapshots([filePath])

    let sha1: string
    if (snapshot && snapshot.size === stat.size && snapshot.mtime === Math.round(stat.mtimeMs)) {
      sha1 = snapshot.sha1
    } else {
      sha1 = await hashResource(filePath, stat.size)
      await dbHelpers.upsertFileSnapshot({ path: filePath, size: stat.size, mtime: Math.round(stat.mtimeMs), sha1 })
    }

    const [cached] = await dbHelpers.getResources([sha1])
    if (cached && (cached.name || cached.icon)) {
      return {
        sha1,
        name: cached.name,
        description: cached.description,
        version: cached.version,
        icon_url: cached.icon || undefined,
        author: cached.author || undefined,
        source: (cached.source as ResolvedContentEntry["source"]) ?? "local",
        projectId: cached.projectId ?? undefined,
        versionId: cached.versionId ?? undefined,
        modId: cached.modId ?? undefined,
        fileId: cached.fileId ?? undefined,
      }
    }

    const metadata = await readModMetadataFromArchive(filePath)
    const name = metadata.name || ""
    const entry: ResolvedContentEntry = {
      sha1,
      name,
      description: metadata.description || "",
      version: metadata.version || "local",
      icon_url: metadata.icon_url,
      author: metadata.author,
      source: "local",
    }

    let cfChecked = 0
    if (name) {
      try {
        const mods = await loadModsModule()
        const found = await mods.modrinthGetFileByHash(sha1)
        if (found) {
          entry.source = "modrinth"
          entry.projectId = found.projectId
          entry.versionId = found.versionId

          try {
            const projectInfo = await mods.modrinthGetProjectsByIds([found.projectId])
            const info = projectInfo[found.projectId]
            if (info) {
              entry.icon_url = entry.icon_url || info.iconUrl || undefined
              entry.author = entry.author || info.author
            }
          } catch {}
        }
      } catch {}

      try {
        const cf = await resolveCurseforgeMatches([{ filePath, sha1 }])
        const match = cf.matches[sha1]
        if (match) {
          entry.modId = match.modId
          entry.fileId = match.fileId
          if (entry.source !== "modrinth") entry.source = "curseforge"
          cfChecked = 1

          try {
            const mods = await loadModsModule()
            const cfInfo = await mods.curseforgeGetProjectsByIds([match.modId])
            const info = cfInfo[match.modId]
            if (info) {
              entry.icon_url = entry.icon_url || info.iconUrl || undefined
              entry.author = entry.author || info.author
            }
          } catch {}
        } else {
          cfChecked = cf.ok ? 1 : 0
        }
      } catch {
        cfChecked = 0
      }
    }

    await dbHelpers.upsertResource({
      sha1,
      name: entry.name,
      description: entry.description,
      version: entry.version,
      icon: entry.icon_url ?? "",
      author: entry.author ?? "",
      source: entry.source,
      projectId: entry.projectId ?? null,
      versionId: entry.versionId ?? null,
      modId: entry.modId ?? null,
      fileId: entry.fileId ?? null,
      cfChecked,
    })
    return entry
  } catch {
    return null
  }
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

      for (const { filePath, sha1 } of toParse) {
        const found = mrMap[sha1]
        if (!found) continue
        const mrInfo = found.projectId ? projectInfoMap[found.projectId] : undefined
        const verInfo = found.versionId ? versionInfoMap[found.versionId] : undefined

        const [existing] = await dbHelpers.getResources([sha1])
        try {
          // Never overwrite a source that is already known (e.g. CurseForge):
          // many mods exist on both platforms, so a hash match here is only a
          // guess and must not clobber an authoritative platform identity.
          if (existing?.source === "curseforge" || existing?.cfChecked === 1 || existing?.modId) continue

          // At this point the record has no conflicting source, so claiming
          // Modrinth is safe. Missing fields are filled from Modrinth data.
          await dbHelpers.upsertResource({
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
        } catch {}
        void filePath
      }
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

  const hashed = await Promise.all(toHash.map(async ({ filePath, size, mtime }) => {
    const sha1 = await hashResource(filePath, size)
    await dbHelpers.upsertFileSnapshot({ path: filePath, size, mtime, sha1 })
    return { filePath, sha1 }
  }))
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
      for (const r of suspectCf) {
        if (!r.modId || !deadIds.has(r.modId)) continue
        await dbHelpers.upsertResource({
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
  const PARSE_CHUNK = 8
  for (let i = 0; i < toParse.length; i += PARSE_CHUNK) {
    const chunk = toParse.slice(i, i + PARSE_CHUNK)
    const chunkResults = await Promise.all(chunk.map(async ({ filePath, sha1 }) => {
      // Local resolve: read metadata from the archive only, no network.
      const metadata = await readModMetadataFromArchive(filePath)
      const entry: ResolvedContentEntry = {
        sha1,
        name: metadata.name || "",
        description: metadata.description || "",
        version: metadata.version || "local",
        icon_url: metadata.icon_url,
        author: metadata.author,
        source: "local",
      }
      if (metadata.name) {
        await dbHelpers.upsertResource({
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
        })
      }
      return { filePath, entry }
    }))
    parsed.push(...chunkResults)
    processed += chunk.length
    report(processed, totalFiles)
  }

  for (const { filePath, entry } of parsed) {
    result[filePath] = entry
  }

  // Network enrichment (Modrinth/CurseForge) runs in the background so the
  // return is not blocked by API calls.
  enrichWithModrinthInBackground(toParse)
  enrichWithCurseforgeInBackground(valid.map(({ filePath }) => ({ filePath, sha1: sha1ByPath.get(filePath) ?? "" })).filter(c => c.sha1))

  return result
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
      for (const { resource } of cachedWithoutIcon) {
        const info = projectInfoMap[resource.projectId!]
        if (!info?.iconUrl) continue
        try {
          await dbHelpers.upsertResource({
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
        } catch {}
      }
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

      for (const { sha1 } of pending) {
        const match = cfMap[sha1]
        if (match && match.isAvailable === false) {
          try { await dbHelpers.markResourcesCurseforgeChecked([sha1]) } catch {}
          continue
        }
        if (match) {
          const [existing] = await dbHelpers.getResources([sha1])
          const cfInfo = cfProjectInfoMap[match.modId]
          try { await dbHelpers.setResourceCurseforge(sha1, match.modId, match.fileId) } catch {}
          if (cfInfo) {
            try {
              await dbHelpers.upsertResource({
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
            } catch {}
          }
        } else if (cfResolution.ok) {
          try { await dbHelpers.markResourcesCurseforgeChecked([sha1]) } catch {}
        }
      }
    } catch {}
  })()
}
