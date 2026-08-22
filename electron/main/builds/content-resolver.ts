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

  const missingSha1s = [...new Set(toParse.map((entry) => entry.sha1))]
  let mrMap: Record<string, { projectId: string; versionId: string }> = {}
  try {
    const mods = await loadModsModule()
    mrMap = await mods.modrinthGetFilesByHash(missingSha1s)
  } catch {}

  const uniqueProjectIds = [...new Set([
    ...Object.values(mrMap).map((m) => m.projectId),
    ...cachedWithoutIcon.map((c) => c.resource.projectId!).filter(Boolean),
  ])]
  const projectIconMap: Record<string, string> = {}
  try {
    const mods = await loadModsModule()
    await Promise.all(uniqueProjectIds.map(async (pid) => {
      const info = await mods.modrinthGetProjectInfo(pid)
      if (info?.iconUrl) projectIconMap[pid] = info.iconUrl
    }))
  } catch {}

  for (const { filePath, resource } of cachedWithoutIcon) {
    const icon = projectIconMap[resource.projectId!]
    if (icon) {
      result[filePath].icon_url = icon
      await dbHelpers.upsertResource({
        sha1: resource.sha1,
        name: resource.name,
        description: resource.description,
        version: resource.version,
        icon,
        author: resource.author ?? "",
        source: resource.source,
        projectId: resource.projectId,
        versionId: resource.versionId,
        modId: resource.modId,
        fileId: resource.fileId,
        cfChecked: resource.cfChecked,
      })
    }
  }

  const parsed: Array<{ filePath: string; entry: ResolvedContentEntry }> = []
  const PARSE_CHUNK = 8
  for (let i = 0; i < toParse.length; i += PARSE_CHUNK) {
    const chunk = toParse.slice(i, i + PARSE_CHUNK)
    const chunkResults = await Promise.all(chunk.map(async ({ filePath, sha1 }) => {
      const metadata = await readModMetadataFromArchive(filePath)
      const found = mrMap[sha1]
      const mrIcon = found?.projectId ? projectIconMap[found.projectId] : undefined
      const entry: ResolvedContentEntry = {
        sha1,
        name: metadata.name || "",
        description: metadata.description || "",
        version: metadata.version || "local",
        icon_url: metadata.icon_url || mrIcon,
        author: metadata.author,
        source: found ? "modrinth" : "local",
        projectId: found?.projectId,
        versionId: found?.versionId,
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
          projectId: entry.projectId ?? null,
          versionId: entry.versionId ?? null,
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

  const cfCandidates: CfCandidate[] = []
  for (const { filePath, stat } of valid) {
    const sha1 = sha1ByPath.get(filePath)
    if (!sha1) continue
    const resource = resourceBySha1.get(sha1)
    if (!resource || resource.cfChecked === 0) {
      cfCandidates.push({ filePath, sha1 })
    }
  }

  if (cfCandidates.length > 0) {
    const cfResolution = await resolveCurseforgeMatches(cfCandidates)
    const cfMap = cfResolution.matches
    for (const { filePath, sha1 } of cfCandidates) {
      const match = cfMap[sha1]
      if (match) {
        const entry = result[filePath]
        if (entry) {
          entry.modId = match.modId
          entry.fileId = match.fileId
          if (entry.source !== "modrinth") entry.source = "curseforge"
        }
        await dbHelpers.setResourceCurseforge(sha1, match.modId, match.fileId)
      } else if (cfResolution.ok) {
        await dbHelpers.markResourcesCurseforgeChecked([sha1])
      }
    }
  }

  return result
}