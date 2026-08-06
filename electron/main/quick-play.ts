import path from "path"
import fs from "fs/promises"
import type { QuickPlayEntry } from "@xnlc/types" with { "resolution-mode": "import" }
import { registerIpcHandlers, rawHandler } from "./ipc-router"
import { logRuntimeDebug } from "./runtime"
import { getBuildIntentPath } from "./builds"

// Minecraft 26.2+ writes a JSON file at logs/quick_play
// Older versions used logs/quick_play/latest.log with "S label" / "M address" lines
function getQuickPlayLogPath(gameDir: string): string {
  return path.join(gameDir, "logs", "quick_play")
}

function getLegacyQuickPlayLogPath(gameDir: string): string {
  return path.join(gameDir, "logs", "quick_play", "latest.log")
}

interface MinecraftQuickPlayJson {
  type?: string
  id?: string
  name?: string
  lastPlayedTime?: string
  gamemode?: string
  address?: string
}

function parseJsonFormat(content: string): QuickPlayEntry[] {
  try {
    const parsed = JSON.parse(content)
    const items: MinecraftQuickPlayJson[] = Array.isArray(parsed) ? parsed : [parsed]
    const entries: QuickPlayEntry[] = []
    const seen = new Set<string>()

    for (const item of items) {
      if (!item.type || !item.id) continue
      const type = item.type === "multiplayer" ? "multiplayer" : "singleplayer"
      const key = `${type}:${item.id}`
      if (seen.has(key)) continue
      seen.add(key)

      const label = item.name || item.id
      const address = type === "multiplayer" ? (item.address || item.id) : item.id
      const lastPlayed = item.lastPlayedTime ? new Date(item.lastPlayedTime).getTime() : Date.now()

      entries.push({ type, label, address, lastPlayed })
    }

    return entries
  } catch {
    return []
  }
}

function parseLegacyFormat(content: string): QuickPlayEntry[] {
  const lines = content.split(/\r?\n/).filter(Boolean)
  const entries: QuickPlayEntry[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    if (line.startsWith("S ")) {
      const label = line.slice(2).trim()
      if (!label || seen.has(`singleplayer:${label}`)) continue
      seen.add(`singleplayer:${label}`)
      entries.push({
        type: "singleplayer",
        label,
        address: label,
        lastPlayed: Date.now(),
      })
    } else if (line.startsWith("M ")) {
      const address = line.slice(2).trim()
      if (!address || seen.has(`multiplayer:${address}`)) continue
      seen.add(`multiplayer:${address}`)
      entries.push({
        type: "multiplayer",
        label: address,
        address,
        lastPlayed: Date.now(),
      })
    }
  }

  return entries
}

async function readQuickPlayLog(gameDir: string): Promise<QuickPlayEntry[]> {
  // Try new JSON format first (Minecraft 26.2+)
  const jsonPath = getQuickPlayLogPath(gameDir)
  try {
    const stat = await fs.stat(jsonPath)
    if (stat.isFile()) {
      const content = await fs.readFile(jsonPath, "utf-8")
      if (content.trim().startsWith("[")) {
        return parseJsonFormat(content)
      }
    }
  } catch {
    // file doesn't exist or can't be read
  }

  // Fallback to legacy format
  const legacyPath = getLegacyQuickPlayLogPath(gameDir)
  try {
    const content = await fs.readFile(legacyPath, "utf-8")
    return parseLegacyFormat(content)
  } catch {
    return []
  }
}

async function clearQuickPlayLog(gameDir: string): Promise<void> {
  // Clear JSON file
  const jsonPath = getQuickPlayLogPath(gameDir)
  try {
    await fs.writeFile(jsonPath, "[]", "utf-8")
  } catch {
    // ignore
  }
  // Also clear legacy file
  const legacyPath = getLegacyQuickPlayLogPath(gameDir)
  try {
    await fs.writeFile(legacyPath, "", "utf-8")
  } catch {
    // ignore
  }
}

async function removeQuickPlayEntry(gameDir: string, entry: QuickPlayEntry): Promise<void> {
  // Try JSON format first
  const jsonPath = getQuickPlayLogPath(gameDir)
  try {
    const stat = await fs.stat(jsonPath)
    if (stat.isFile()) {
      const content = await fs.readFile(jsonPath, "utf-8")
      if (content.trim().startsWith("[")) {
        const items: MinecraftQuickPlayJson[] = JSON.parse(content)
        const filtered = items.filter(item => {
          if (!item.id) return true
          const type = item.type === "multiplayer" ? "multiplayer" : "singleplayer"
          return !(type === entry.type && item.id === entry.address)
        })
        await fs.writeFile(jsonPath, JSON.stringify(filtered, null, 2), "utf-8")
        return
      }
    }
  } catch {
    // ignore
  }

  // Fallback to legacy format
  const legacyPath = getLegacyQuickPlayLogPath(gameDir)
  try {
    const content = await fs.readFile(legacyPath, "utf-8")
    const prefix = entry.type === "singleplayer" ? "S " : "M "
    const target = `${prefix}${entry.address}`
    const lines = content.split(/\r?\n/).filter(line => line !== target)
    await fs.writeFile(legacyPath, lines.join("\n"), "utf-8")
  } catch {
    // ignore
  }
}

function resolveGameDir(buildName?: string, gameDir?: string): string {
  if (gameDir) return gameDir
  if (buildName) return getBuildIntentPath(buildName)
  return ""
}

export function registerQuickPlayHandlers(): void {
  registerIpcHandlers([
    rawHandler("quickplay:list", async (...args: unknown[]): Promise<QuickPlayEntry[]> => {
      const [buildName, gameDir] = args as [string?, string?]
      const resolved = resolveGameDir(buildName, gameDir)
      if (!resolved) return []
      logRuntimeDebug(`[QuickPlay] Listing entries for gameDir=${resolved}`)
      return readQuickPlayLog(resolved)
    }),

    rawHandler("quickplay:clear", async (...args: unknown[]): Promise<void> => {
      const [buildName, gameDir] = args as [string?, string?]
      const resolved = resolveGameDir(buildName, gameDir)
      if (!resolved) return
      logRuntimeDebug(`[QuickPlay] Clearing log for gameDir=${resolved}`)
      await clearQuickPlayLog(resolved)
    }),

    rawHandler("quickplay:remove", async (...args: unknown[]): Promise<void> => {
      const [buildName, gameDir, entry] = args as [string?, string?, QuickPlayEntry?]
      if (!entry) return
      const resolved = resolveGameDir(buildName, gameDir)
      if (!resolved) return
      logRuntimeDebug(`[QuickPlay] Removing entry type=${entry.type} address=${entry.address}`)
      await removeQuickPlayEntry(resolved, entry)
    }),
  ])

  logRuntimeDebug("[QuickPlay] Handlers registered")
}
