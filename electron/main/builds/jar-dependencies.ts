// ============================================================
// XNLC — парсеры объявленных зависимостей мода из метаданных JAR
// ============================================================
//
// CurseForge и Modrinth заполняют список зависимостей не у всех файлов, поэтому
// достоверное место — метаданные загрузчика внутри jar: fabric.mod.json,
// quilt.mod.json или mods.toml.
//
// Парсеры вынесены из mods-jar-deps.ts отдельным модулем без собственного
// чтения файла: так единый инспектор JAR (builds/jar-inspector.ts) переиспользует
// их на уже прочитанном буфере, а публичный API mods-jar-deps — общий кэш
// инспектора, и циклических импортов не возникает.

import { loadToml, readArchiveText, type AdmZipType } from "./archive-utils"

export interface JarDeclaredDependency {
  /** Идентификатор мода из метаданных (например, `fabric-api`). */
  modId: string
  /** Диапазон версий, как его объявил автор мода. */
  versionRange?: string
}

export function stringifyVersionRange(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (Array.isArray(value)) {
    const parts = value.map(item => stringifyVersionRange(item)).filter(Boolean)
    return parts.length > 0 ? parts.join(" || ") : undefined
  }
  if (value && typeof value === "object") {
    // Fabric допускает объектную форму: {"any": [...]}, {"all": [...]} и подобные.
    const parts = Object.values(value as Record<string, unknown>)
      .map(item => stringifyVersionRange(item))
      .filter(Boolean)
    return parts.length > 0 ? parts.join(" || ") : undefined
  }
  return undefined
}

/** fabric.mod.json: `depends` — объект вида { "fabric-api": ">=0.155.0+26.2" }. */
export function collectJsonDependencies(raw: unknown): JarDeclaredDependency[] {
  if (!raw || typeof raw !== "object") return []
  return Object.entries(raw as Record<string, unknown>)
    .filter(([modId]) => Boolean(modId))
    .map(([modId, range]) => ({ modId, versionRange: stringifyVersionRange(range) }))
}

/** quilt.mod.json: `quilt_loader.depends` — массив объектов { id, versions }. */
export function collectQuiltDependencies(raw: unknown): JarDeclaredDependency[] {
  const depends = (raw as { quilt_loader?: { depends?: unknown } } | null)?.quilt_loader?.depends
  if (Array.isArray(depends)) {
    return depends.flatMap((entry) => {
      const modId = typeof (entry as { id?: unknown })?.id === "string" ? String((entry as { id: string }).id) : ""
      if (!modId) return []
      return [{ modId, versionRange: stringifyVersionRange((entry as { versions?: unknown }).versions) }]
    })
  }
  return collectJsonDependencies(depends)
}

/**
 * Forge/NeoForge mods.toml: `[[dependencies.<modid>]]` — массив записей с
 * `modId`, `mandatory`, `versionRange`. Необязательные пропускаем: их отсутствие
 * игру не ломает.
 */
export function collectTomlDependencies(parsed: Record<string, unknown>): JarDeclaredDependency[] {
  const dependencies = parsed["dependencies"]
  if (!dependencies || typeof dependencies !== "object") return []

  const result: JarDeclaredDependency[] = []
  for (const entries of Object.values(dependencies as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const record = entry as Record<string, unknown>
      if (record?.["mandatory"] === false) continue
      const modId = typeof record?.["modId"] === "string" ? record["modId"].trim() : ""
      if (!modId) continue
      const range = typeof record?.["versionRange"] === "string" ? record["versionRange"].trim() : ""
      result.push({ modId, versionRange: range || undefined })
    }
  }
  return result
}

export function findEntryName(entries: { entryName: string }[], pattern: RegExp): string | null {
  const match = entries.find(entry => pattern.test(entry.entryName))
  return match?.entryName ?? null
}

/** Читает метаданные загрузчика из уже открытого архива (без повторного чтения файла). */
export async function readDeclaredDependenciesFromZip(
  zip: AdmZipType,
): Promise<{ modId: string | null; declared: JarDeclaredDependency[] }> {
  const entries = zip.getEntries()
  const empty = { modId: null, declared: [] as JarDeclaredDependency[] }

  const fabricRaw = readArchiveText(zip, "fabric.mod.json")
  if (fabricRaw) {
    try {
      const parsed = JSON.parse(fabricRaw) as { id?: unknown; depends?: unknown }
      const modId = typeof parsed.id === "string" ? parsed.id : null
      return { modId, declared: collectJsonDependencies(parsed.depends) }
    } catch {
      return empty
    }
  }

  const quiltRaw = readArchiveText(zip, "quilt.mod.json")
  if (quiltRaw) {
    try {
      const parsed = JSON.parse(quiltRaw) as { quilt_loader?: { id?: unknown } }
      const modId = typeof parsed.quilt_loader?.id === "string" ? parsed.quilt_loader.id : null
      return { modId, declared: collectQuiltDependencies(parsed) }
    } catch {
      return empty
    }
  }

  const tomlName = findEntryName(entries, /^META-INF\/(neoforge\.)?mods\.toml$/i)
  if (tomlName) {
    try {
      const raw = readArchiveText(zip, tomlName)
      if (!raw) return empty
      const toml = await loadToml()
      const parsed = toml.parse(raw) as Record<string, unknown>
      const modsList = parsed["mods"]
      const first = Array.isArray(modsList) ? (modsList[0] as Record<string, unknown> | undefined) : undefined
      const modId = typeof first?.["modId"] === "string" ? String(first["modId"]) : null
      return { modId, declared: collectTomlDependencies(parsed) }
    } catch {
      return empty
    }
  }

  return empty
}
