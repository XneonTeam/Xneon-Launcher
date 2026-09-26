import { queryAll, run, prepare, transactionImmediate, isDbAvailable, inMemoryBuilds } from "./core"
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
  /** Аккаунт по умолчанию для этой сборки (поле живёт в типах @xnlc/types). */
  defaultAccountId?: string
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

/**
 * Точечный поиск сборки по имени: только id и имя, без чтения тяжёлого контента.
 * Нужен горячим путям вроде записи статистики при выходе из игры.
 */
export async function findBuildByName(name: string): Promise<{ id: string; name: string } | null> {
  if (!name) return null
  if (!isDbAvailable()) {
    for (const build of inMemoryBuilds.values()) {
      const candidate = build as BuildJson
      if (candidate.name === name) return { id: candidate.id, name: candidate.name }
    }
    return null
  }

  const rows = queryAll<{ id: string; name: string }>("SELECT id, name FROM builds WHERE name = ? LIMIT 1", [name])
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

/** Точечный поиск лёгких полей сборки по id (без mods/resourcepacks/shaders). */
export async function findBuildById(buildId: string): Promise<BuildLightJson | null> {
  if (!buildId) return null
  if (!isDbAvailable()) {
    const build = inMemoryBuilds.get(buildId) as BuildJson | undefined
    if (!build) return null
    return { ...build, mods: undefined as never, resourcepacks: undefined, shaders: undefined, installedMods: undefined, modsCount: 0, resourcepacksCount: 0, shadersCount: 0 } as BuildLightJson
  }

  const rows = queryAll<Record<string, unknown>>(
    `SELECT ${LIGHT_COLUMNS} FROM builds WHERE id = ? LIMIT 1`,
    [buildId],
  )
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return null
  const light = rowToBuild({ ...row, mods: "[]", resourcepacks: "[]", shaders: "[]", installedMods: "{}" } as unknown as BuildRow)
  return {
    ...light,
    mods: undefined as never,
    resourcepacks: undefined,
    shaders: undefined,
    installedMods: undefined,
    modsCount: 0,
    resourcepacksCount: 0,
    shadersCount: 0,
  } as BuildLightJson
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

export async function saveAllBuilds(builds: Array<BuildJson | BuildLightJson>): Promise<void> {
  if (!isDbAvailable()) {
    for (const build of builds) {
      inMemoryBuilds.set(build.id, build)
    }
    return
  }

  if (builds.length === 0) return

  // ВАЖНО: это upsert, а не «перезапись таблицы». Раньше здесь стоял
  // `DELETE FROM builds` перед вставкой, и сохранение списка, в котором чего-то
  // не хватало (устаревший список в renderer, сбой IPC, второй экземпляр),
  // стирало из БД все сборки, которых в этом списке не было. Удаление сборки —
  // всегда явное (`deleteBuild` / `build:delete-intent` / корзина), поэтому
  // массовое сохранение не имеет права ничего удалять.
  transactionImmediate(() => {
    // Тяжёлый контент уже сохранённых сборок: интерфейс может присылать «лёгкие»
    // сборки (списки грузятся по требованию), и тогда пустые
    // mods/resourcepacks/shaders означают «не загружено», а не «удалено».
    const previousContent = new Map<string, { mods: string; resourcepacks: string; shaders: string; installedMods: string }>()
    for (const row of queryAll<{ id: string; mods: string; resourcepacks: string; shaders: string; installedMods: string }>(
      "SELECT id, mods, COALESCE(resourcepacks,'[]') AS resourcepacks, COALESCE(shaders,'[]') AS shaders, COALESCE(installedMods,'{}') AS installedMods FROM builds",
    )) {
      previousContent.set(row.id, row)
    }
    const keepOr = (incoming: unknown, previous: string | undefined, fallback: string): string => {
      const isEmpty = Array.isArray(incoming)
        ? incoming.length === 0
        : !incoming || (typeof incoming === "object" && Object.keys(incoming as Record<string, unknown>).length === 0)
      if (isEmpty && previous) {
        try {
          const parsed = JSON.parse(previous)
          const parsedEmpty = Array.isArray(parsed) ? parsed.length === 0 : !parsed || Object.keys(parsed).length === 0
          if (!parsedEmpty) return previous
        } catch {
          // повреждённый JSON — пишем то, что пришло
        }
      }
      return JSON.stringify(incoming ?? JSON.parse(fallback))
    }
    // Принимаем и «лёгкие» сборки (без mods/resourcepacks/shaders/installedMods):
    // реальный контент подставляет keepOr из уже лежащего в БД previousContent.
    for (const build of builds) {
      INSERT_BUILD_STATEMENT.run(...buildInsertParams(build, previousContent.get(build.id), keepOr))
    }
  })
}

/**
 * Точки вставки строки `builds`: одна и та же колонка/порядок обязаны совпадать
 * у массового сохранения и у точечной вставки новой сборки.
 */
const INSERT_BUILD_SQL = `
  INSERT OR REPLACE INTO builds (id, name, description, version, modLoader, loaderVersion, icon, coverImage, mods, resourcepacks, shaders, intentPath, installedMods, createdAt, source, projectSlug, modpackVersion, modpackVersionId, locked, modId, fileId, playtime, javaOverride, javaPath, javaArgs, memoryMin, memoryMax, serverOverride, server, serverPort, [group], preLaunchCommand, postLaunchCommand, wrapperCommand, customEnv, windowOverride, windowWidth, windowHeight)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

/** Ленивое подготовленное выражение: `prepare` требует инициализированной БД. */
let insertBuildStatement: ReturnType<typeof prepare> | null = null
const INSERT_BUILD_STATEMENT = {
  run(...params: unknown[]): unknown {
    if (!insertBuildStatement) insertBuildStatement = prepare(INSERT_BUILD_SQL)
    return insertBuildStatement.run(...params)
  },
}

/** Параметры одной строки `builds`; `previous` — уже лежащий в БД контент. */
function buildInsertParams(
  build: BuildJson | BuildLightJson,
  previous: { mods: string; resourcepacks: string; shaders: string; installedMods: string } | undefined,
  keepOr: (incoming: unknown, previous: string | undefined, fallback: string) => string,
): unknown[] {
  const content = build as Partial<BuildJson>
  const params: unknown[] = [
    build.id,
    build.name,
    build.description,
    build.version,
    build.modLoader,
    build.loaderVersion ?? null,
    build.icon,
    build.coverImage ?? null,
    keepOr(content.mods, previous?.mods, "[]"),
    keepOr(content.resourcepacks, previous?.resourcepacks, "[]"),
    keepOr(content.shaders, previous?.shaders, "[]"),
    build.intentPath ?? "",
    keepOr(content.installedMods, previous?.installedMods, "{}"),
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
  return params
}

/**
 * Вставка одной новой сборки.
 *
 * Нужна там, где сборка появляется в интерфейсе впервые (создание с нуля,
 * создание копии): раньше такие сборки писались только через debounce-патчи,
 * а те делают `UPDATE ... WHERE id = ?` — по несуществующей строке это no-op.
 * Сборка жила в памяти до перезапуска и пропадала после него, хотя папка
 * интента уже была создана.
 */
export async function insertBuild(build: BuildJson): Promise<void> {
  if (!build?.id) return
  if (!isDbAvailable()) {
    inMemoryBuilds.set(build.id, build)
    return
  }

  // Контент существующей строки (повторная вставка того же id) не теряем.
  const previous = queryAll<{ mods: string; resourcepacks: string; shaders: string; installedMods: string }>(
    "SELECT COALESCE(mods,'[]') AS mods, COALESCE(resourcepacks,'[]') AS resourcepacks, COALESCE(shaders,'[]') AS shaders, COALESCE(installedMods,'{}') AS installedMods FROM builds WHERE id = ?",
    [build.id],
  )[0]
  const keepOr = (incoming: unknown, prev: string | undefined, fallback: string): string => {
    const isEmpty = Array.isArray(incoming)
      ? incoming.length === 0
      : !incoming || (typeof incoming === "object" && Object.keys(incoming as Record<string, unknown>).length === 0)
    if (isEmpty && prev) {
      try {
        const parsed = JSON.parse(prev)
        const parsedEmpty = Array.isArray(parsed) ? parsed.length === 0 : !parsed || Object.keys(parsed).length === 0
        if (!parsedEmpty) return prev
      } catch {
        // повреждённый JSON — пишем то, что пришло
      }
    }
    return JSON.stringify(incoming ?? JSON.parse(fallback))
  }

  transactionImmediate(() => {
    INSERT_BUILD_STATEMENT.run(...buildInsertParams(build, previous, keepOr))
  })
}

/**
 * Точечное удаление записи сборки.
 *
 * Полное удаление сборки (папка + статистика) должно убирать и её запись из БД:
 * список сборок читается из БД, поэтому оставшаяся запись возвращала удалённую
 * сборку в список при следующем reload (папка интента при этом создавалась пустой).
 */
export async function deleteBuild(buildId: string): Promise<void> {
  if (!buildId) return
  if (!isDbAvailable()) {
    inMemoryBuilds.delete(buildId)
    return
  }

  run("DELETE FROM builds WHERE id = ?", [buildId])
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
}

/**
 * Текстовые колонки `builds`, объявленные NOT NULL: сброс такого поля обязан
 * писать пустую строку, а не NULL (иначе UPDATE падает и патч правок теряется).
 */
const NOT_NULL_TEXT_COLUMNS = new Set([
  "name",
  "description",
  "version",
  "modLoader",
  "icon",
  "intentPath",
  "source",
  "javaPath",
  "javaArgs",
  "memoryMin",
  "memoryMax",
  "server",
  "serverPort",
  "preLaunchCommand",
  "postLaunchCommand",
  "wrapperCommand",
  "customEnv",
])

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
  const contentKeys = new Set(["mods", "resourcepacks", "shaders", "installedMods"])
  // Защита от затирания контента: интерфейс грузит список сборок без тяжёлых
  // списков (mods/resourcepacks/shaders), поэтому пустой массив в запросе почти
  // всегда означает «не загружено», а не «пользователь всё удалил». Если в БД
  // контент есть, а пришёл пустой — такой столбец не трогаем.
  //
  // Тяжёлые колонки читаем только тогда, когда запрос действительно их меняет:
  // смена иконки или описания не должна тянуть из БД десятки мегабайт JSON.
  const requestedContentKeys = Object.keys(fields).filter((key) => contentKeys.has(key))
  let existingRow: Record<string, string> | undefined
  if (requestedContentKeys.length > 0) {
    const selection = requestedContentKeys
      .map((key) => key === "installedMods"
        ? "COALESCE(installedMods,'{}') AS installedMods"
        : `COALESCE(${key},'[]') AS ${key}`)
      .join(", ")
    const existing = queryAll<Record<string, string>>(`SELECT ${selection} FROM builds WHERE id = ?`, [buildId])
    existingRow = Array.isArray(existing) ? existing[0] : undefined
  }
  const isEmptyPayload = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length === 0
    if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0
    return value === undefined || value === null
  }
  const hasStoredContent = (key: string): boolean => {
    if (!existingRow) return false
    const raw = existingRow[key] ?? ""
    try {
      const parsed = JSON.parse(raw || (key === "installedMods" ? "{}" : "[]"))
      return Array.isArray(parsed) ? parsed.length > 0 : parsed && Object.keys(parsed).length > 0
    } catch {
      return false
    }
  }

  for (const [key, value] of Object.entries(fields)) {
    const column = columnMap[key]
    if (!column) continue
    if (contentKeys.has(key) && isEmptyPayload(value) && hasStoredContent(key)) {
      logRuntime(`[db] updateBuildFields: пустой ${key} для ${buildId} поверх непустого — пропущено`)
      continue
    }
    let stored: unknown = value
    if (contentKeys.has(key)) {
      stored = JSON.stringify(value ?? (key === "installedMods" ? {} : []))
    } else if (key === "locked") {
      // undefined означает «по умолчанию» (для модпаков инстанс заблокирован)
      stored = value === undefined ? null : value ? 1 : 0
    } else if (key === "javaOverride" || key === "serverOverride" || key === "windowOverride") {
      stored = value ? 1 : 0
    } else if (value === undefined) {
      // Часть текстовых колонок объявлена NOT NULL DEFAULT '' (javaPath,
      // javaArgs, memory*, server, команды запуска). Запись NULL падала с
      // «NOT NULL constraint failed», причём падал весь патч целиком — правки
      // сборки молча не сохранялись (в логах «Debounced save failed»).
      // Пустая строка читается обратно как undefined (`row.x || undefined`),
      // поэтому смысл сброса сохраняется.
      stored = NOT_NULL_TEXT_COLUMNS.has(column) ? "" : null
    }
    sets.push(`${column === "group" ? "[group]" : column} = ?`)
    params.push(stored)
  }

  if (sets.length === 0) return
  params.push(buildId)
  // Чтение «existing» и запись идут по одному соединению без await между ними,
  // поэтому промежуточная правка из другого обработчика невозможна.
  run(`UPDATE builds SET ${sets.join(", ")} WHERE id = ?`, params)
}
