// ============================================================
// XNLC — зависимости мода из метаданных jar
// Author: MAINER4IK
// ============================================================
//
// CurseForge и Modrinth заполняют список зависимостей не у всех файлов. Живой
// пример: jei-26.2-fabric-30.32.0.221.jar — оба API отдают `dependencies: []`,
// хотя сам мод требует fabric-api >= 0.155.0+26.2 и без него игра падает с
// "Incompatible mods found". Достоверное место только одно — метаданные
// загрузчика внутри jar: fabric.mod.json, quilt.mod.json или mods.toml.
// Их и читаем, а найденные id сопоставляем с проектами источника.

import fs from "fs/promises"
import path from "path"
import { downloadBuffer, loadAdmZip, loadModsModule, loadToml, readArchiveText } from "./builds/helpers"
import { cacheJarFromUrl } from "./jar-cache"
import type { ModDependency } from "@xnlc/mods" with { "resolution-mode": "import" }

/** Идентификаторы, которые ставит не лаунчер: загрузчик, сама игра и рантайм. */
const NON_INSTALLABLE_IDS = new Set([
  "minecraft",
  "java",
  "fabricloader",
  "fabric-loader",
  "fabric",
  "quilt_loader",
  "quiltloader",
  "quilt",
  "forge",
  "neoforge",
  "liteloader",
  "bukkit",
  "spigot",
  "paper",
])

export interface JarDeclaredDependency {
  /** Идентификатор мода из метаданных (например, `fabric-api`). */
  modId: string
  /** Диапазон версий, как его объявил автор мода. */
  versionRange?: string
}

export interface JarDependencyInspection {
  /** id самого мода из метаданных (например, `jei`). */
  modId: string | null
  /** Зависимости, уже сопоставленные с проектами источника. */
  dependencies: ModDependency[]
  /** Все установимые id до сопоставления — по ним видно, что не нашлось. */
  declared: JarDeclaredDependency[]
}

/**
 * Резолв проекта по id зависимости. Итог кэшируем: один и тот же мод (fabric-api,
 * cloth-config, architectury) встречается в половине сборки.
 */
const projectCache = new Map<string, ModDependency | null>()

function stringifyVersionRange(value: unknown): string | undefined {
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
function collectJsonDependencies(raw: unknown): JarDeclaredDependency[] {
  if (!raw || typeof raw !== "object") return []
  return Object.entries(raw as Record<string, unknown>)
    .filter(([modId]) => Boolean(modId))
    .map(([modId, range]) => ({ modId, versionRange: stringifyVersionRange(range) }))
}

/** quilt.mod.json: `quilt_loader.depends` — массив объектов { id, versions }. */
function collectQuiltDependencies(raw: unknown): JarDeclaredDependency[] {
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
function collectTomlDependencies(parsed: Record<string, unknown>): JarDeclaredDependency[] {
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

function findEntryName(entries: { entryName: string }[], pattern: RegExp): string | null {
  const match = entries.find(entry => pattern.test(entry.entryName))
  return match?.entryName ?? null
}

/** Читает метаданные загрузчика и возвращает id мода и его объявленные зависимости. */
async function readDeclaredDependencies(
  jarPath: string,
): Promise<{ modId: string | null; declared: JarDeclaredDependency[] }> {
  const AdmZip = await loadAdmZip()
  const zip = new AdmZip(await fs.readFile(jarPath))
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

/** Убираем загрузчик, игру и сам мод — остаётся то, что реально можно поставить. */
function filterInstallable(
  declared: JarDeclaredDependency[],
  selfModId: string | null,
): JarDeclaredDependency[] {
  const seen = new Set<string>()
  const result: JarDeclaredDependency[] = []
  for (const dep of declared) {
    const key = dep.modId.toLowerCase()
    if (NON_INSTALLABLE_IDS.has(key) || key === selfModId?.toLowerCase() || seen.has(key)) continue
    seen.add(key)
    result.push(dep)
  }
  return result
}

async function resolveCurseForgeProject(modId: string): Promise<ModDependency | null> {
  try {
    const mods = await loadModsModule()
    // Обычный search у CurseForge мусорный, а точный резолв делает параметр slug.
    const data = (await mods.cfFetch("/mods/search", {
      gameId: "432",
      classId: "6",
      slug: modId,
    })) as { data?: Array<Record<string, unknown>> }
    const project = data?.data?.[0]
    const projectId = project?.["id"]
    if (typeof projectId !== "number") return null
    const logo = project?.["logo"] as Record<string, unknown> | undefined
    return {
      projectId: String(projectId),
      versionId: null,
      fileName: null,
      dependencyType: "required",
      name: typeof project?.["name"] === "string" ? String(project["name"]) : modId,
      slug: typeof project?.["slug"] === "string" ? String(project["slug"]) : modId,
      iconUrl: typeof logo?.["thumbnailUrl"] === "string" ? String(logo["thumbnailUrl"]) : "",
    }
  } catch (error) {
    console.warn(`[jar-deps] CurseForge: не удалось найти проект «${modId}»:`, error)
    return null
  }
}

async function resolveModrinthProject(modId: string): Promise<ModDependency | null> {
  try {
    const mods = await loadModsModule()
    // У Modrinth id мода почти всегда совпадает со slug проекта.
    const info = await mods.modrinthGetProjectInfo(modId)
    if (!info) return null
    return {
      projectId: modId,
      versionId: null,
      fileName: null,
      dependencyType: "required",
      name: info.name,
      slug: info.slug || modId,
      iconUrl: info.iconUrl ?? "",
    }
  } catch (error) {
    console.warn(`[jar-deps] Modrinth: не удалось найти проект «${modId}»:`, error)
    return null
  }
}

async function resolveProject(modId: string, source: "modrinth" | "curseforge"): Promise<ModDependency | null> {
  const key = `${source}:${modId.toLowerCase()}`
  if (!projectCache.has(key)) {
    projectCache.set(key, source === "curseforge" ? await resolveCurseForgeProject(modId) : await resolveModrinthProject(modId))
  }
  return projectCache.get(key) ?? null
}

/**
 * Скачивает файл версии (с переиспользованием кэша), читает зависимости из его
 * метаданных и сопоставляет их с проектами источника.
 */
export async function inspectJarDependencies(
  url: string,
  source: "modrinth" | "curseforge",
): Promise<JarDependencyInspection> {
  const fileName = path.basename(url.split("?")[0]) || "mod.jar"
  const jarPath = await cacheJarFromUrl(url, fileUrl => downloadBuffer(fileUrl, undefined, fileName))
  if (!jarPath) {
    return { modId: null, dependencies: [], declared: [] }
  }

  const { modId, declared } = await readDeclaredDependencies(jarPath)
  const installable = filterInstallable(declared, modId)
  if (installable.length === 0) {
    return { modId, dependencies: [], declared: [] }
  }

  const dependencies: ModDependency[] = []
  for (const candidate of installable) {
    const project = await resolveProject(candidate.modId, source)
    if (project) {
      dependencies.push({ ...project, versionId: null })
    } else {
      console.warn(`[jar-deps] проект для «${candidate.modId}» не найден в ${source} — пропускаем`)
    }
  }

  return { modId, dependencies, declared: installable }
}
