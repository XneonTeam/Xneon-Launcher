import fs from "fs/promises"
import { readArchiveText, readArchiveEntryAsDataUrl, loadAdmZip, loadToml, AdmZipType } from "./helpers"

type ModMetadata = { name?: string; version?: string; description?: string; icon_url?: string; author?: string }

function resolveFabricIconPath(icon: unknown): string | undefined {
  if (typeof icon === "string") {
    return icon
  }

  if (icon && typeof icon === "object") {
    const sizedIcons = Object.entries(icon as Record<string, unknown>)
      .map(([size, iconPath]) => ({ size: Number(size), iconPath }))
      .filter((entry) => Number.isFinite(entry.size) && typeof entry.iconPath === "string")
      .sort((a, b) => b.size - a.size)

    const bestMatch = sizedIcons[0]
    if (bestMatch && typeof bestMatch.iconPath === "string") {
      return bestMatch.iconPath
    }
  }

  return undefined
}

function extractAuthors(data: unknown): string | undefined {
  if (!data) return undefined
  if (typeof data === "string") return data.trim() || undefined
  if (Array.isArray(data)) {
    const names = data.map((a: unknown) => {
      if (typeof a === "string") return a.trim()
      if (a && typeof a === "object" && "name" in (a as Record<string, unknown>)) return String((a as Record<string, unknown>).name).trim()
      return null
    }).filter(Boolean) as string[]
    return names.length > 0 ? names.join(", ") : undefined
  }
  return undefined
}

function extractTomlString(mod: Record<string, unknown>, key: string): string | undefined {
  const v = mod[key]
  return typeof v === "string" ? v.trim() || undefined : undefined
}

function extractTomlAuthors(mod: Record<string, unknown>): string | undefined {
  const v = mod["authors"]
  if (typeof v === "string") return v.trim() || undefined
  return undefined
}

function parseManifestMf(zip: AdmZipType): { version?: string } | null {
  const content = readArchiveText(zip, "META-INF/MANIFEST.MF")
  if (!content) return null
  const match = content.match(/^Implementation-Version:\s*(.+)$/m)
  if (!match) return null
  const v = match[1].trim()
  return v ? { version: v } : null
}

function parseMcmodInfo(zip: AdmZipType): ModMetadata | null {
  const content = readArchiveText(zip, "mcmod.info")
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    let list: Record<string, unknown>[]
    if (Array.isArray(parsed)) {
      list = parsed
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["modlist"])) {
      list = (parsed as Record<string, unknown>)["modlist"] as Record<string, unknown>[]
    } else {
      return null
    }
    const first = list[0]
    if (!first) return null
    const name = String(first["name"] ?? "").trim()
    if (!name || name === "Example Mod") return null
    const version = String(first["version"] ?? "").trim() || undefined
    const description = String(first["description"] ?? "").trim() || undefined
    const author = extractAuthors(first["authorList"] ?? first["authors"])
    const logoFile = String(first["logoFile"] ?? "").trim() || undefined
    return {
      name,
      version,
      description,
      icon_url: logoFile ? readArchiveEntryAsDataUrl(zip, logoFile) : undefined,
      author,
    }
  } catch {
    return null
  }
}

function parseLiteModJson(zip: AdmZipType): ModMetadata | null {
  const content = readArchiveText(zip, "litemod.json")
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as { name?: string; version?: string; revision?: number; author?: string; description?: string; mcversion?: string }
    const name = parsed.name?.trim()
    if (!name) return null
    return {
      name,
      version: parsed.version?.trim() ?? (parsed.revision ? String(parsed.revision) : undefined),
      description: parsed.description?.trim() || undefined,
      author: parsed.author?.trim() || undefined,
    }
  } catch {
    return null
  }
}

function parseFabricModJson(zip: AdmZipType): ModMetadata | null {
  const content = readArchiveText(zip, "fabric.mod.json")
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as { name?: string; version?: string; description?: string; icon?: unknown; authors?: unknown }
    const name = parsed.name?.trim()
    if (!name) return null
    return {
      name,
      version: parsed.version?.trim(),
      description: parsed.description?.trim(),
      icon_url: readArchiveEntryAsDataUrl(zip, resolveFabricIconPath(parsed.icon)),
      author: extractAuthors(parsed.authors),
    }
  } catch {
    return null
  }
}

function parseQuiltModJson(zip: AdmZipType): ModMetadata | null {
  const content = readArchiveText(zip, "quilt.mod.json")
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as {
      schema_version?: number
      quilt_loader?: {
        version?: string
        metadata?: {
          name?: string
          description?: string
          icon?: unknown
        }
        depends?: unknown
      }
      authors?: unknown
    }
    if (parsed.schema_version !== 1) return null
    const meta = parsed.quilt_loader?.metadata
    const name = meta?.name?.trim()
    if (!name) return null
    return {
      name,
      version: parsed.quilt_loader?.version?.trim(),
      description: meta?.description?.trim(),
      icon_url: readArchiveEntryAsDataUrl(zip, resolveFabricIconPath(meta?.icon)),
      author: extractAuthors(parsed.authors),
    }
  } catch {
    return null
  }
}

async function parseModsToml(zip: AdmZipType, tomlPath: string): Promise<ModMetadata | null> {
  const content = readArchiveText(zip, tomlPath)
  if (!content) return null
  try {
    const toml = await loadToml()
    const parsed = toml.parse(content) as { mods?: Record<string, unknown>[] }
    const modsList = parsed.mods
    if (!Array.isArray(modsList) || modsList.length === 0) return null
    const first = modsList[0]
    const name = extractTomlString(first, "displayName")
    if (!name) return null
    const modId = extractTomlString(first, "modId")
    let version = extractTomlString(first, "version")
    if (version === "${file.jarVersion}") {
      const man = parseManifestMf(zip)
      if (man?.version) version = man.version
    }
    return {
      name,
      version,
      description: extractTomlString(first, "description"),
      icon_url: (() => {
        const logoFile = extractTomlString(first, "logoFile")
        return logoFile ? readArchiveEntryAsDataUrl(zip, logoFile) : undefined
      })(),
      author: extractTomlAuthors(first),
    }
  } catch {
    return null
  }
}

async function parseNeoForgeModsToml(zip: AdmZipType): Promise<ModMetadata | null> {
  return parseModsToml(zip, "META-INF/neoforge.mods.toml")
}

async function parseForgeModsToml(zip: AdmZipType): Promise<ModMetadata | null> {
  return parseModsToml(zip, "META-INF/mods.toml")
}

export async function readModMetadataFromArchive(filePath: string): Promise<ModMetadata> {
  try {
    const AdmZip = await loadAdmZip()
    const data = await fs.readFile(filePath)
    const zip = new AdmZip(data)
    const parsers = [
      parseNeoForgeModsToml,
      parseForgeModsToml,
      parseMcmodInfo,
      parseQuiltModJson,
      parseFabricModJson,
      parseLiteModJson,
    ]
    for (const parser of parsers) {
      const result = await parser(zip)
      if (result) return result
    }
  } catch {
    // ignore unreadable archive
  }
  return {}
}
