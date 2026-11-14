// ============================================================
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
const USER_AGENT = "Xneon-Launcher/1.0.8"

type CachedMeta = { name?: string; author?: string }

const enrichCache = new Map<string, CachedMeta>()
const resourcepackOwners = new Map<string, string | undefined>()

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

async function fetchBatch(ids: string[], includeOwners: boolean): Promise<void> {
  try {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 15000)
    try {
      const res = await fetch(`${MODRINTH_API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, {
        headers: { "User-Agent": USER_AGENT }, signal: abort.signal,
      })
      if (!res.ok) return
      const projects = (await res.json()) as Array<Record<string, unknown>>
      const teamIds = includeOwners ? [...new Set(projects.filter(project => !extractAuthor(project) && typeof project.team === "string").map(project => project.team as string))] : []
      const owners = new Map<string, string>()
      if (teamIds.length) {
        const teams = await fetch(`${MODRINTH_API}/teams?ids=${encodeURIComponent(JSON.stringify(teamIds))}`, {
          headers: { "User-Agent": USER_AGENT }, signal: abort.signal,
        })
        if (teams.ok) {
          const groups = await teams.json() as Array<Array<{ team_id?: string; role?: string; user?: { username?: string } }>>
          for (const members of groups) {
            if (!Array.isArray(members)) continue
            const owner = members.find(member => member.role?.toLowerCase() === "owner" && member.user?.username)
            if (owner?.team_id && owner.user?.username) owners.set(owner.team_id, owner.user.username)
          }
        }
      }
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
    // mark as tried so we don't retry within the session
    for (const id of ids) {
      if (!enrichCache.has(id)) enrichCache.set(id, {})
    }
  }
}

export function clearModrinthEnrichCache(): void {
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
      name: cached.name && cached.name !== item.projectId ? cached.name : item.name,
      author: (options.includeOwners ? resourcepackOwners.get(item.projectId) : undefined) || cached.author || item.author,
    }
  })
}
