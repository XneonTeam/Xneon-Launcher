import { queryAll, run, persistDatabase, isDbAvailable, inMemoryBuilds } from "./core"
import { logRuntime } from "../main/runtime"

export type BuildJson = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon: string
  coverImage?: string
  mods: unknown[]
  resourcepacks?: unknown[]
  shaders?: unknown[]
  createdAt: string
  source: "local" | "modrinth" | "curseforge"
  projectSlug?: string
  modpackVersion?: string
  modpackVersionId?: string
  locked?: boolean
  modId?: number
  fileId?: number
  intentPath?: string
  installedMods?: Record<string, string>
  playtime: number
  javaOverride?: boolean
  javaPath?: string
  javaArgs?: string
  memoryMin?: string
  memoryMax?: string
  serverOverride?: boolean
  server?: string
  serverPort?: string
  group?: string
  /** Команда перед запуском (поддерживает $INST_* плейсхолдеры). */
  preLaunchCommand?: string
  /** Команда после выхода из игры. */
  postLaunchCommand?: string
  /** Обёртка вокруг java (optirun, primusrun, ...). */
  wrapperCommand?: string
  /** Дополнительные переменные окружения, по одной KEY=VALUE в строке. */
  customEnv?: string
  /** Переопределение размера окна для этой сборки. */
  windowOverride?: boolean
  windowWidth?: number
  windowHeight?: number
}

type BuildRow = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  loaderVersion: string | null
  icon: string
  coverImage: string | null
  mods: string
  resourcepacks: string
  shaders: string
  intentPath: string
  installedMods: string
  createdAt: string
  source: string
  projectSlug: string | null
  modpackVersion: string | null
  modpackVersionId: string | null
  locked: number | null
  modId: number | null
  fileId: number | null
  playtime: number
  javaOverride: number | null
  javaPath: string | null
  javaArgs: string | null
  memoryMin: string | null
  memoryMax: string | null
  serverOverride: number | null
  server: string | null
  serverPort: string | null
  group: string | null
  preLaunchCommand: string | null
  postLaunchCommand: string | null
  wrapperCommand: string | null
  customEnv: string | null
  windowOverride: number | null
  windowWidth: number | null
  windowHeight: number | null
}

function rowToBuild(row: BuildRow): BuildJson {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    modLoader: row.modLoader,
    loaderVersion: row.loaderVersion ?? undefined,
    icon: row.icon,
    coverImage: row.coverImage ?? undefined,
    mods: JSON.parse(row.mods),
    resourcepacks: JSON.parse(row.resourcepacks || "[]"),
    shaders: JSON.parse(row.shaders || "[]"),
    createdAt: row.createdAt,
    source: row.source as BuildJson["source"],
    projectSlug: row.projectSlug ?? undefined,
    modpackVersion: row.modpackVersion ?? undefined,
    modpackVersionId: row.modpackVersionId ?? undefined,
    // null означает «по умолчанию»: для модпаков инстанс заблокирован
    locked: row.locked === null || row.locked === undefined ? undefined : row.locked === 1,
    modId: row.modId ?? undefined,
    fileId: row.fileId ?? undefined,
    intentPath: row.intentPath || undefined,
    installedMods: JSON.parse(row.installedMods || "{}"),
    playtime: row.playtime ?? 0,
    javaOverride: row.javaOverride === 1,
    javaPath: row.javaPath || undefined,
    javaArgs: row.javaArgs || undefined,
    memoryMin: row.memoryMin || undefined,
    memoryMax: row.memoryMax || undefined,
    serverOverride: row.serverOverride === 1,
    server: row.server || undefined,
    serverPort: row.serverPort || undefined,
    group: row.group || undefined,
    preLaunchCommand: row.preLaunchCommand || undefined,
    postLaunchCommand: row.postLaunchCommand || undefined,
    wrapperCommand: row.wrapperCommand || undefined,
    customEnv: row.customEnv || undefined,
    windowOverride: row.windowOverride === 1,
    windowWidth: row.windowWidth ?? undefined,
    windowHeight: row.windowHeight ?? undefined,
  }
}

export async function loadBuilds(): Promise<BuildJson[]> {
  if (!isDbAvailable()) {
    return Array.from(inMemoryBuilds.values()).sort((a, b) => (b as BuildJson).createdAt.localeCompare((a as BuildJson).createdAt)) as BuildJson[]
  }

  const rows = queryAll<BuildRow>("SELECT * FROM builds ORDER BY createdAt DESC")
  if (!Array.isArray(rows)) return []

  return rows.map(rowToBuild)
}

/**
 * Список сборок без тяжёлого контента: `mods`/`resourcepacks`/`shaders`/`installedMods`
 * у модпаков занимают десятки мегабайт (183 МБ текста на 17 сборок) — их чтение и
 * передача в renderer давали 1.5–2 секунды на каждый заход во вкладку.
 * Списку нужны только счётчики, сами списки грузятся по требованию через
 * {@link loadBuildContent}.
 */
export type BuildLightJson = Omit<BuildJson, "mods" | "resourcepacks" | "shaders" | "installedMods"> & {
  modsCount: number
  resourcepacksCount: number
  shadersCount: number
}

/** Колонки без тяжёлых JSON-полей. */
const LIGHT_COLUMNS = `id, name, description, version, modLoader, loaderVersion, icon, coverImage,
  createdAt, source, projectSlug, modpackVersion, modpackVersionId, locked, modId, fileId,
  intentPath, playtime, javaOverride, javaPath, javaArgs, memoryMin, memoryMax,
  serverOverride, server, serverPort, [group], preLaunchCommand, postLaunchCommand,
  wrapperCommand, customEnv, windowOverride, windowWidth, windowHeight`

export async function loadBuildsLight(): Promise<BuildLightJson[]> {
  if (!isDbAvailable()) {
    return Array.from(inMemoryBuilds.values())
      .sort((a, b) => (b as BuildJson).createdAt.localeCompare((a as BuildJson).createdAt))
      .map(build => {
        const full = build as BuildJson
        return {
          ...full,
          mods: undefined as never,
          resourcepacks: undefined,
          shaders: undefined,
          installedMods: undefined,
          modsCount: Array.isArray(full.mods) ? full.mods.length : 0,
          resourcepacksCount: Array.isArray(full.resourcepacks) ? full.resourcepacks.length : 0,
          shadersCount: Array.isArray(full.shaders) ? full.shaders.length : 0,
        } as BuildLightJson
      })
  }

  const rows = queryAll<Record<string, unknown>>(
    `SELECT ${LIGHT_COLUMNS} FROM builds ORDER BY createdAt DESC`,
  )
  if (!Array.isArray(rows)) return []

  return rows.map(row => {
    const light = rowToBuild({ ...row, mods: "[]", resourcepacks: "[]", shaders: "[]", installedMods: "{}" } as unknown as BuildRow)
    return {
      ...light,
      mods: undefined as never,
      resourcepacks: undefined,
      shaders: undefined,
      installedMods: undefined,
      // Счётчики не считаем в SQL: json_array_length заставляет SQLite парсить
      // все тяжёлые JSON (183 МБ) и съедает ~100 мс из 130. Реальные списки
      // приходят вместе с контентом сборки, а длина — из загруженного состояния.
      modsCount: 0,
      resourcepacksCount: 0,
      shadersCount: 0,
    } as BuildLightJson
  })
}

/** Тяжёлый контент одной сборки — по требованию, когда открыт её экран. */
export async function loadBuildContent(buildId: string): Promise<{
  mods: unknown[]
  resourcepacks: unknown[]
  shaders: unknown[]
  installedMods: Record<string, string>
} | null> {
  if (!isDbAvailable()) {
    const build = inMemoryBuilds.get(buildId) as BuildJson | undefined
    if (!build) return null
    return {
      mods: build.mods ?? [],
      resourcepacks: build.resourcepacks ?? [],
      shaders: build.shaders ?? [],
      installedMods: build.installedMods ?? {},
    }
  }

  const rows = queryAll<{ mods: string; resourcepacks: string; shaders: string; installedMods: string }>(
    "SELECT mods, COALESCE(resourcepacks, '[]') AS resourcepacks, COALESCE(shaders, '[]') AS shaders, COALESCE(installedMods, '{}') AS installedMods FROM builds WHERE id = ?",
    [buildId],
  )
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return null

  return {
    mods: safeParse(row.mods, []),
    resourcepacks: safeParse(row.resourcepacks, []),
    shaders: safeParse(row.shaders, []),
    installedMods: safeParse(row.installedMods, {}) as Record<string, string>,
  }
}

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(value || "null") ?? fallback
  } catch {
    return fallback
  }
}

export async function saveAllBuilds(builds: BuildJson[]): Promise<void> {
  if (!isDbAvailable()) {
    inMemoryBuilds.clear()
    for (const build of builds) {
      inMemoryBuilds.set(build.id, build)
    }
    return
  }

  // saveAllBuilds затирает таблицу целиком (DELETE + вставка), поэтому пустой
  // список от renderer'а со сбитым состоянием стирал все сборки. Пустую запись
  // поверх непустой таблицы игнорируем.
  if (builds.length === 0) {
    const existing = queryAll<BuildRow>("SELECT id FROM builds LIMIT 1")
    if (Array.isArray(existing) && existing.length > 0) {
      logRuntime("[db] saveAllBuilds: пустой список поверх непустой таблицы — запись пропущена")
      return
    }
  }

  run("BEGIN")
  try {
    run("DELETE FROM builds")
    for (const build of builds) {
      const params: unknown[] = [
        build.id,
        build.name,
        build.description,
        build.version,
        build.modLoader,
        build.loaderVersion ?? null,
        build.icon,
        build.coverImage ?? null,
        JSON.stringify(build.mods),
        JSON.stringify(build.resourcepacks ?? []),
        JSON.stringify(build.shaders ?? []),
        build.intentPath ?? "",
        JSON.stringify(build.installedMods ?? {}),
        build.createdAt,
        build.source,
        build.projectSlug ?? null,
        build.modpackVersion ?? null,
        build.modpackVersionId ?? null,
        build.locked === undefined ? null : (build.locked ? 1 : 0),
        build.modId ?? null,
        build.fileId ?? null,
        build.playtime ?? 0,
        build.javaOverride ? 1 : 0,
        build.javaPath ?? "",
        build.javaArgs ?? "",
        build.memoryMin ?? "",
        build.memoryMax ?? "",
        build.serverOverride ? 1 : 0,
        build.server ?? "",
        build.serverPort ?? "",
        build.group ?? "",
        build.preLaunchCommand ?? "",
        build.postLaunchCommand ?? "",
        build.wrapperCommand ?? "",
        build.customEnv ?? "",
        build.windowOverride ? 1 : 0,
        build.windowWidth ?? null,
        build.windowHeight ?? null,
      ]
      for (let i = 0; i < params.length; i++) {
        const v = params[i]
        if (v === undefined || (typeof v === "object" && v !== null) || typeof v === "boolean" || typeof v === "bigint") {
          console.error(`[DB] saveAllBuilds param ${i + 1} for build ${build.id} has unexpected type: ${typeof v}, value: ${JSON.stringify(v)}, coercing to null`)
          params[i] = null
        }
      }
      run(`
        INSERT OR REPLACE INTO builds (id, name, description, version, modLoader, loaderVersion, icon, coverImage, mods, resourcepacks, shaders, intentPath, installedMods, createdAt, source, projectSlug, modpackVersion, modpackVersionId, locked, modId, fileId, playtime, javaOverride, javaPath, javaArgs, memoryMin, memoryMax, serverOverride, server, serverPort, [group], preLaunchCommand, postLaunchCommand, wrapperCommand, customEnv, windowOverride, windowWidth, windowHeight)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, params)
    }
    run("COMMIT")
    persistDatabase()
  } catch (error) {
    try {
      run("ROLLBACK")
    } catch {
      // ignore rollback errors
    }
    throw error
  }
}

export async function updateBuildPlaytime(buildId: string, seconds: number): Promise<void> {
  if (!isDbAvailable()) {
    const build = inMemoryBuilds.get(buildId) as BuildJson | undefined
    if (build) {
      build.playtime = (build.playtime ?? 0) + seconds
    }
    return
  }

  run("UPDATE builds SET playtime = playtime + ? WHERE id = ?", [seconds, buildId])
  persistDatabase()
}

/**
 * Точечное обновление полей одной сборки без перезаписи всего массива.
 * Нужно для изменений, которые должны попасть в БД мгновенно (например,
 * отвязка/привязка модпака `locked`), иначе отложенный debounce-сейв и
 * параллельный reload успевают откатить правку.
 */
export async function updateBuildFields(buildId: string, fields: Partial<BuildJson>): Promise<void> {
  if (!isDbAvailable()) {
    const build = inMemoryBuilds.get(buildId) as BuildJson | undefined
    if (build) Object.assign(build, fields)
    return
  }

  const columnMap: Record<string, string> = {
    name: "name",
    description: "description",
    version: "version",
    modLoader: "modLoader",
    loaderVersion: "loaderVersion",
    icon: "icon",
    coverImage: "coverImage",
    mods: "mods",
    resourcepacks: "resourcepacks",
    shaders: "shaders",
    intentPath: "intentPath",
    installedMods: "installedMods",
    source: "source",
    projectSlug: "projectSlug",
    modpackVersion: "modpackVersion",
    modpackVersionId: "modpackVersionId",
    locked: "locked",
    modId: "modId",
    fileId: "fileId",
    playtime: "playtime",
    javaOverride: "javaOverride",
    javaPath: "javaPath",
    javaArgs: "javaArgs",
    memoryMin: "memoryMin",
    memoryMax: "memoryMax",
    serverOverride: "serverOverride",
    server: "server",
    serverPort: "serverPort",
    group: "group",
    preLaunchCommand: "preLaunchCommand",
    postLaunchCommand: "postLaunchCommand",
    wrapperCommand: "wrapperCommand",
    customEnv: "customEnv",
    windowOverride: "windowOverride",
    windowWidth: "windowWidth",
    windowHeight: "windowHeight",
  }

  const sets: string[] = []
  const params: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    const column = columnMap[key]
    if (!column) continue
    let stored: unknown = value
    if (key === "mods" || key === "resourcepacks" || key === "shaders" || key === "installedMods") {
      stored = JSON.stringify(value ?? (key === "installedMods" ? {} : []))
    } else if (key === "locked") {
      // undefined означает «по умолчанию» (для модпаков инстанс заблокирован)
      stored = value === undefined ? null : value ? 1 : 0
    } else if (key === "javaOverride" || key === "serverOverride" || key === "windowOverride") {
      stored = value ? 1 : 0
    } else if (value === undefined) {
      stored = null
    }
    sets.push(`${column === "group" ? "[group]" : column} = ?`)
    params.push(stored)
  }

  if (sets.length === 0) return
  params.push(buildId)
  run(`UPDATE builds SET ${sets.join(", ")} WHERE id = ?`, params)
  persistDatabase()
}
