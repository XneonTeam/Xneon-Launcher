import { APP_USER_AGENT } from "./app-meta"
// ============================================================
import { BoundedCache } from "./bounded-cache"
// Modrinth project metadata enrichment
// - Module-level cache: fetched names survive across reloads
// - Batched requests via the bulk /v2/projects endpoint
// ============================================================

export type EnrichableMod = {
  slug: string
  name: string
  source?: "local" | "modrinth" | "curseforge" | "ftb"
  projectId?: string
  author?: string
}

const MODRINTH_API = "https://api.modrinth.com/v2"
const BATCH_SIZE = 50
const USER_AGENT = APP_USER_AGENT

type CachedMeta = { name?: string; author?: string }

const enrichCache = new BoundedCache<string, CachedMeta>({ capacity: 1024, ttlMs: 5 * 60_000 })
const resourcepackOwners = new BoundedCache<string, string | undefined>({ capacity: 1024, ttlMs: 5 * 60_000 })
let cacheGeneration = 0
const pendingBatches = new Map<string, Promise<void>>()

function extractAuthor(project: Record<string, unknown>): string | undefined {
  const direct = project.author as string | undefined
  if (direct) return direct
  const authors = project.authors as Array<Record<string, unknown>> | undefined
  if (Array.isArray(authors)) {
    const names = authors
      .map((author) => ((author.user as Record<string, unknown>)?.username as string) ?? (author.name as string))
      .filter(Boolean)
    if (names.length > 0) return names.join(", ")
  }
  return undefined
}

async function fetchBatchUncached(ids: string[], includeOwners: boolean): Promise<void> {
  const generation = cacheGeneration
  try {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 15000)
    try {
      const res = await fetch(`${MODRINTH_API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, {
        headers: { "User-Agent": USER_AGENT }, signal: abort.signal,
      })
      if (!res.ok) throw new Error(`Modrinth metadata HTTP ${res.status}`)
      const projects = (await res.json()) as Array<Record<string, unknown>>
      const teamIds = includeOwners ? [...new Set(projects.filter(project => !extractAuthor(project) && typeof project.team === "string").map(project => project.team as string))] : []
      const owners = new Map<string, string>()
      if (teamIds.length) {
        const teams = await fetch(`${MODRINTH_API}/teams?ids=${encodeURIComponent(JSON.stringify(teamIds))}`, {
          headers: { "User-Agent": USER_AGENT }, signal: abort.signal,
        })
        if (!teams.ok) throw new Error(`Modrinth teams HTTP ${teams.status}`)
        const groups = await teams.json() as Array<Array<{ team_id?: string; role?: string; user?: { username?: string } }>>
        for (const members of groups) {
          if (!Array.isArray(members)) continue
          const owner = members.find(member => member.role?.toLowerCase() === "owner" && member.user?.username)
          if (owner?.team_id && owner.user?.username) owners.set(owner.team_id, owner.user.username)
        }
      }
      if (generation !== cacheGeneration) return
      for (const project of projects) {
        const id = project.id as string | undefined
        if (!id) continue
        const author = extractAuthor(project)
        enrichCache.set(id, { name: (project.title as string) ?? undefined, author })
        if (includeOwners) resourcepackOwners.set(id, author ?? (typeof project.team === "string" ? owners.get(project.team) : undefined))
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    if (generation !== cacheGeneration) return
    // Короткий отрицательный TTL допускает восстановление после сетевой ошибки.
    for (const id of ids) {
      if (!enrichCache.has(id)) enrichCache.set(id, {}, 30_000)
      if (includeOwners && !resourcepackOwners.has(id)) resourcepackOwners.set(id, undefined, 30_000)
    }
  }
}

function fetchBatch(ids: string[], includeOwners: boolean): Promise<void> {
  const key = `${cacheGeneration}:${includeOwners ? "owners" : "projects"}:${[...ids].sort().join(",")}`
  const current = pendingBatches.get(key)
  if (current) return current
  const pending = fetchBatchUncached(ids, includeOwners).finally(() => {
    if (pendingBatches.get(key) === pending) pendingBatches.delete(key)
  })
  pendingBatches.set(key, pending)
  return pending
}

export function clearModrinthEnrichCache(): void {
  cacheGeneration++
  pendingBatches.clear()
  enrichCache.clear()
  resourcepackOwners.clear()
}

export async function enrichBuildModNames<T extends EnrichableMod>(items: T[], options: { includeOwners?: boolean } = {}): Promise<T[]> {
  const uniqueIds = Array.from(new Set(
    items
      .filter(item => item.source === "modrinth" && item.projectId && (!item.name || !item.author))
      .map(item => item.projectId!),
  ))
  const missing = uniqueIds.filter(id => {
    const cached = enrichCache.get(id)
    return !cached || options.includeOwners && !resourcepackOwners.has(id)
  })

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    await fetchBatch(missing.slice(i, i + BATCH_SIZE), options.includeOwners === true)
  }

  return items.map(item => {
    if (item.source !== "modrinth" || !item.projectId) return item
    const cached = enrichCache.get(item.projectId)
    if (!cached) return item
    return {
      ...item,
      name: item.name || cached.name || item.projectId,
      author: item.author || (options.includeOwners ? resourcepackOwners.get(item.projectId) : undefined) || cached.author,
    }
  })
}
