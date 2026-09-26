// ============================================================
// XNLC — парсеры требований мода к версии загрузчика
// ============================================================
//
// Modrinth и CurseForge описывают мод только парой «загрузчик + версия
// Minecraft», поэтому требование к версии самого загрузчика известно
// исключительно из метаданных внутри JAR:
//   • Fabric   — fabric.mod.json → depends.fabricloader
//   • Quilt    — quilt.mod.json  → quilt_loader.depends[id=quilt_loader]
//   • Forge    — META-INF/mods.toml → loaderVersion / dependencies[modId=forge]
//   • NeoForge — META-INF/neoforge.mods.toml (или mods.toml) → neoforge
//
// Модуль не читает файлы сам: он разбирает уже открытый архив, чтобы единый
// инспектор JAR (builds/jar-inspector.ts) использовал один прочитанный буфер
// для метаданных, зависимостей, отпечатка и этих требований.

import { loadToml, readArchiveText, type AdmZipType } from "./archive-utils"

export interface DeclaredRequirement {
  loaderId: string
  requirement: string
}

export interface ModArchiveRequirements {
  modId?: string
  modName?: string
  requirements: DeclaredRequirement[]
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (Array.isArray(value)) {
    const found = value.find(item => typeof item === "string" && item.trim())
    return found ? String(found).trim() : undefined
  }
  return undefined
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  return []
}

function readFabricRequirements(zip: AdmZipType): ModArchiveRequirements | null {
  const raw = readArchiveText(zip, "fabric.mod.json")
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Record<string, any>
    const depends = (data.depends ?? {}) as Record<string, unknown>
    const requirements: DeclaredRequirement[] = []

    const loaderRequirement = asStringList(depends["fabricloader"] ?? depends["fabric-loader"])
    for (const requirement of loaderRequirement) {
      requirements.push({ loaderId: "fabric", requirement })
    }

    return {
      modId: firstString(data.id),
      modName: firstString(data.name),
      requirements,
    }
  } catch {
    return null
  }
}

function readQuiltRequirements(zip: AdmZipType): ModArchiveRequirements | null {
  const raw = readArchiveText(zip, "quilt.mod.json")
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Record<string, any>
    const quiltLoader = (data.quilt_loader ?? {}) as Record<string, any>
    const depends = Array.isArray(quiltLoader.depends) ? quiltLoader.depends : []
    const requirements: DeclaredRequirement[] = []

    for (const entry of depends) {
      const id = String(entry?.id ?? "").toLowerCase()
      if (id !== "quilt_loader" && id !== "quilt-loader") continue
      const range = firstString(entry?.versions ?? entry?.version)
      if (range) requirements.push({ loaderId: "quilt", requirement: range })
    }

    return {
      modId: firstString(quiltLoader.id),
      modName: firstString(quiltLoader.metadata?.name) ?? firstString(quiltLoader.id),
      requirements,
    }
  } catch {
    return null
  }
}

const LOADER_DEPENDENCY_IDS = new Set(["forge", "neoforge", "minecraft"])

async function parseTomlRequirementsAsync(raw: string, isNeoForgeFile: boolean): Promise<ModArchiveRequirements | null> {
  return parseTomlRequirementsWith(raw, isNeoForgeFile, await loadToml())
}

function parseTomlRequirementsWith(
  raw: string,
  isNeoForgeFile: boolean,
  toml: { parse(input: string): Record<string, unknown> },
): ModArchiveRequirements | null {
  try {
    const data = toml.parse(raw) as Record<string, any>
    const requirements: DeclaredRequirement[] = []

    const mods = Array.isArray(data.mods) ? data.mods : []
    const firstMod = mods[0] ?? {}

    const dependencies = (data.dependencies ?? {}) as Record<string, unknown>
    const coveredLoaders = new Set<string>()
    for (const ownerDeps of Object.values(dependencies)) {
      if (!Array.isArray(ownerDeps)) continue
      for (const dep of ownerDeps as Record<string, unknown>[]) {
        const modId = String(dep?.modId ?? "").toLowerCase()
        if (!LOADER_DEPENDENCY_IDS.has(modId) || modId === "minecraft") continue
        const range = firstString(dep?.versionRange)
        if (!range) continue
        requirements.push({ loaderId: modId === "forge" ? "forge" : "neoforge", requirement: range })
        coveredLoaders.add(modId)
      }
    }

    // `loaderVersion` — общее требование к загрузчику, если по зависимостям его нет
    const loaderVersionRange = firstString(data.loaderVersion)
    const fileLoader = isNeoForgeFile ? "neoforge" : "forge"
    if (loaderVersionRange && !coveredLoaders.has(fileLoader)) {
      requirements.push({ loaderId: fileLoader, requirement: loaderVersionRange })
    }

    return {
      modId: firstString(firstMod.modId),
      modName: firstString(firstMod.displayName) ?? firstString(firstMod.modId),
      requirements,
    }
  } catch {
    return null
  }
}

export function normalizeLoaderId(loaderId?: string): string {
  const value = (loaderId ?? "").trim().toLowerCase()
  if (value === "fabric-legacy" || value === "fabric-loader") return "fabric"
  if (value === "quilt-loader") return "quilt"
  return value
}

/** Ищет `META-INF/mods.toml` / `META-INF/neoforge.mods.toml` без учёта регистра. */
function findModsTomlEntry(zip: AdmZipType): string | null {
  let forgeEntry: string | null = null
  for (const entry of zip.getEntries()) {
    const name = entry.entryName
    if (!/^META-INF\/[^/]*mods\.toml$/i.test(name)) continue
    if (/neoforge.*mods\.toml$/i.test(name)) return name
    forgeEntry = forgeEntry ?? name
  }
  return forgeEntry
}

/**
 * Читает требования к загрузчику из уже открытого архива. Отделено от чтения
 * файла, чтобы единый инспектор JAR не читал один и тот же JAR повторно ради
 * метаданных и отпечатка.
 */
export async function readModLoaderRequirementsFromZip(zip: AdmZipType): Promise<ModArchiveRequirements | null> {
  const quilt = readQuiltRequirements(zip)
  if (quilt) return quilt

  const fabric = readFabricRequirements(zip)
  if (fabric) return fabric

  const entryName = findModsTomlEntry(zip)
  if (!entryName) return null

  const raw = readArchiveText(zip, entryName)
  if (!raw) return null

  return parseTomlRequirementsAsync(raw, /neoforge/i.test(entryName))
}
