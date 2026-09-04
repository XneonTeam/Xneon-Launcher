import { queryAll, run, persistDatabase, isDbAvailable, inMemoryBuilds } from "./core"

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

export async function saveAllBuilds(builds: BuildJson[]): Promise<void> {
  if (!isDbAvailable()) {
    inMemoryBuilds.clear()
    for (const build of builds) {
      inMemoryBuilds.set(build.id, build)
    }
    return
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
      ]
      for (let i = 0; i < params.length; i++) {
        const v = params[i]
        if (v === undefined || (typeof v === "object" && v !== null) || typeof v === "boolean" || typeof v === "bigint") {
          console.error(`[DB] saveAllBuilds param ${i + 1} for build ${build.id} has unexpected type: ${typeof v}, value: ${JSON.stringify(v)}, coercing to null`)
          params[i] = null
        }
      }
      run(`
        INSERT OR REPLACE INTO builds (id, name, description, version, modLoader, loaderVersion, icon, coverImage, mods, resourcepacks, shaders, intentPath, installedMods, createdAt, source, projectSlug, modpackVersion, playtime, javaOverride, javaPath, javaArgs, memoryMin, memoryMax, serverOverride, server, serverPort, [group])
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
