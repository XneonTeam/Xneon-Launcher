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
//
// Сам разбор архива живёт в builds/jar-dependencies.ts и выполняется единым
// инспектором JAR: файл читается один раз, а результат кладётся в общий кэш по
// (path, size, mtime) — повторная проверка того же jar диск не трогает.

import path from "path"
import { downloadBuffer, loadModsModule } from "./builds/helpers"
import { cacheJarFromUrl } from "./jar-cache"
import { inspectJar } from "./builds/jar-inspector"
import type { JarDeclaredDependency } from "./builds/jar-dependencies"
import type { ModDependency } from "@xnlc/mods" with { "resolution-mode": "import" }

export type { JarDeclaredDependency } from "./builds/jar-dependencies"

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

  const inspection = await inspectJar(jarPath, { dependencies: true })
  const { modId, declared } = inspection.dependencies ?? { modId: null, declared: [] as JarDeclaredDependency[] }
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
