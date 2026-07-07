import { ipcMain } from "electron"
import { parseHost } from "./server-status"
import fs from "fs/promises"
import path from "path"

const HOTMC_API_BASE = "https://hotmc-parser.vercel.app"
const MCSKIN_API_BASE = "https://mcskinapi-three.vercel.app"
const HOTMC_SEARCH_TTL_MS = 5 * 60 * 1000
const HOTMC_SEARCH_LIMIT_DEFAULT = 12
const HOTMC_SEARCH_LIMIT_MAX = 30
const HOTMC_SEARCH_MAX_PAGES_DEFAULT = 0
const HOTMC_SEARCH_MAX_PAGES_MAX = 10
const STATUS_CACHE_TTL_MS = 10_000
const STATUS_CONCURRENCY = 3

let xnlcModulePromise: Promise<any> | null = null
const hotmcCache = new Map<string, { expiresAt: number; value: HotmcSearchResult[] }>()
const statusCache = new Map<string, { expiresAt: number; value: ServerStatusPayload }>()

function loadXnlcModule(): Promise<any> {
  if (!xnlcModulePromise) {
    xnlcModulePromise = import("@xnlc/core")
  }
  return xnlcModulePromise
}

async function getMinecraftRoot(): Promise<string> {
  const { getDefaultMinecraftRootFromEnv } = await loadXnlcModule()
  return getDefaultMinecraftRootFromEnv()
}

async function generateServersDat(servers: Array<{ name: string; ip: string }>): Promise<Buffer> {
  const { default: nbt } = await import("prismarine-nbt")
  const zlib = await import("zlib")
  const tag = nbt.comp({
    servers: nbt.list(
      nbt.comp(
        servers.map((server) => ({
          name: nbt.string(server.name),
          ip: nbt.string(server.ip),
        })),
      ),
    ),
  }, "") as any

  const uncompressed = nbt.writeUncompressed(tag)
  return new Promise<Buffer>((resolve, reject) => {
    zlib.gzip(uncompressed, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

type HotmcSearchResult = {
  name: string
  pageUrl: string
  description: string
  ip: string
  version: string
  playersOnline: number
  playersMax: number
  rank?: string
  country?: string
  avatarUrl?: string
  bannerUrl?: string
  isOnline: boolean
}

type HotmcApiSearchEntry = {
  found_name?: unknown
  page_url?: unknown
  description?: unknown
  ip_address?: unknown
  core?: unknown
  players?: unknown
  rank?: unknown
  country?: unknown
  avatar?: unknown
  banner?: unknown
  status?: unknown
}

type ServerStatusPayload = {
  online: boolean
  ip: string
  port: number
  players_online: number
  players_max: number
  motd_raw?: string
  motd_clean?: string
  version: string
  latency_ms: number
  icon?: string
  error?: string
}

type ServerStatusEntry = {
  ip: string
  result: ServerStatusPayload
  error?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeMinecraftVersionLabel(value: string | undefined): string {
  if (!value) {
    return ""
  }

  return value.replace(/^\s*minecraft\s+/i, "").trim()
}

function parsePlayers(value: unknown): { playersOnline: number; playersMax: number } {
  const text = typeof value === "string" ? value : ""
  const match = text.match(/(\d+)\s*РёР·\s*(\d+)/i)

  return {
    playersOnline: match ? Number(match[1]) : 0,
    playersMax: match ? Number(match[2]) : 0,
  }
}

function normalizeHotmcEntry(entry: HotmcApiSearchEntry): HotmcSearchResult | null {
  const name = asString(entry.found_name)
  const pageUrl = asString(entry.page_url)
  const ip = asString(entry.ip_address)

  if (!name || !pageUrl || !ip) {
    return null
  }

  const { playersOnline, playersMax } = parsePlayers(entry.players)
  const banner = entry.banner && typeof entry.banner === "object" ? entry.banner as { image_url?: unknown } : null
  const status = asString(entry.status)

  return {
    name,
    pageUrl,
    description: asString(entry.description) ?? "",
    ip,
    version: normalizeMinecraftVersionLabel(asString(entry.core)),
    playersOnline,
    playersMax,
    rank: asString(entry.rank),
    country: asString(entry.country),
    avatarUrl: asString(entry.avatar),
    bannerUrl: asString(banner?.image_url),
    isOnline: status?.toLowerCase().includes("онлайн") ?? false,
  }
}

async function fetchHotmcSearch(
  query: string,
  limit = HOTMC_SEARCH_LIMIT_DEFAULT,
  maxPages = HOTMC_SEARCH_MAX_PAGES_DEFAULT,
  exact = false,
): Promise<HotmcSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const safeLimit = clamp(limit, 1, HOTMC_SEARCH_LIMIT_MAX)
  const safeMaxPages = maxPages === 0 ? 0 : clamp(maxPages, 1, HOTMC_SEARCH_MAX_PAGES_MAX)
  const cacheKey = JSON.stringify({ trimmedQuery: trimmedQuery.toLowerCase(), safeLimit, safeMaxPages, exact })
  const cached = hotmcCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const url = new URL("/servers", HOTMC_API_BASE)
  url.searchParams.set("name", trimmedQuery)
  url.searchParams.set("limit", String(safeLimit))
  url.searchParams.set("max_pages", String(safeMaxPages))
  url.searchParams.set("exact", String(exact))

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) {
    throw new Error(`HotMC search failed with HTTP ${response.status}`)
  }

  const payload = await response.json() as { data?: unknown; detail?: unknown }
  if (typeof payload?.detail === "string") {
    throw new Error(payload.detail)
  }

  if (!Array.isArray(payload?.data)) {
    throw new Error("HotMC search returned an invalid payload")
  }

  const normalized = payload.data
    .map((entry) => normalizeHotmcEntry((entry ?? {}) as HotmcApiSearchEntry))
    .filter((entry): entry is HotmcSearchResult => entry !== null)

  hotmcCache.set(cacheKey, {
    expiresAt: Date.now() + HOTMC_SEARCH_TTL_MS,
    value: normalized,
  })

  return normalized
}

function createOfflineStatus(address: string, error?: string): ServerStatusPayload {
  const { host, port } = parseHost(address)
  return {
    online: false,
    ip: host,
    port,
    players_online: 0,
    players_max: 0,
    version: "",
    latency_ms: 0,
    motd_clean: "",
    error,
  }
}

async function fetchMcSkinStatus(address: string): Promise<ServerStatusPayload> {
  const { host, port } = parseHost(address)
  const url = new URL(`/status/${encodeURIComponent(host)}`, MCSKIN_API_BASE)
  url.searchParams.set("port", String(port))

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) {
    throw new Error(`mcskinapi responded with HTTP ${response.status}`)
  }

  const payload = await response.json() as Partial<ServerStatusPayload>
  return {
    ...createOfflineStatus(address),
    ...payload,
    ip: typeof payload.ip === "string" && payload.ip.trim() ? payload.ip : host,
    port: typeof payload.port === "number" ? payload.port : port,
    online: typeof payload.online === "boolean" ? payload.online : false,
    version: normalizeMinecraftVersionLabel(typeof payload.version === "string" ? payload.version : ""),
    latency_ms: typeof payload.latency_ms === "number" ? payload.latency_ms : 0,
    players_online: typeof payload.players_online === "number" ? payload.players_online : 0,
    players_max: typeof payload.players_max === "number" ? payload.players_max : 0,
    motd_raw: typeof payload.motd_raw === "string" ? payload.motd_raw : undefined,
    motd_clean: typeof payload.motd_clean === "string" ? payload.motd_clean : "",
    icon: typeof payload.icon === "string" ? payload.icon : undefined,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return []
  }

  const results = new Array<R>(items.length)
  let nextIndex = 0

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) {
        return
      }
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  await Promise.all(workers)
  return results
}

async function fetchServerStatuses(addresses: string[]): Promise<ServerStatusEntry[]> {
  return mapWithConcurrency(addresses, STATUS_CONCURRENCY, async (address) => {
    const cacheKey = address.trim().toLowerCase()
    const cached = statusCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return { ip: address, result: cached.value }
    }

    try {
      const result = await fetchMcSkinStatus(address)
      statusCache.set(cacheKey, {
        value: result,
        expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      })
      return { ip: address, result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ip: address,
        result: createOfflineStatus(address, message),
        error: message,
      }
    }
  })
}

export function registerServersHandlers() {
  ipcMain.handle(
    "servers:write-dat",
    async (_event, servers: Array<{ name: string; ip: string }>) => {
      try {
        const root = await getMinecraftRoot()
        await fs.mkdir(root, { recursive: true }).catch(() => {})
        const datPath = path.join(root, "servers.dat")
        await fs.writeFile(datPath, await generateServersDat(servers))
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(
    "servers:check-status",
    async (_event, ip: string) => {
      const [result] = await fetchServerStatuses([ip])
      return { success: !result.error, result: result.result, error: result.error }
    },
  )

  ipcMain.handle(
    "servers:check-statuses",
    async (_event, ips: string[]) => {
      const targets = Array.isArray(ips) ? ips.filter((ip) => typeof ip === "string" && ip.trim()) : []
      return {
        success: true,
        results: await fetchServerStatuses(targets),
      }
    },
  )

  ipcMain.handle(
    "servers:hotmc-search",
    async (_event, query: string, limit?: number, maxPages?: number, exact?: boolean) => {
      try {
        return {
          success: true,
          results: await fetchHotmcSearch(query, limit, maxPages, exact),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          results: [] as HotmcSearchResult[],
        }
      }
    },
  )
}
