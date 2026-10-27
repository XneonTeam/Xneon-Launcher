import path from "path"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader, readSqliteDb, sqliteTableExists, discoverInstancesFromDirs, readVersionSelection } from "./helpers"

type ModrinthProfileRow = {
  path: string
  name: string
  icon_path: string | null
  game_version: string
  mod_loader: string
  mod_loader_version: string | null
}

type ModrinthAppLocations = {
  profilesDir: string
  dbPath: string
  dataDir: string
}

async function firstExisting(paths: string[]): Promise<string> {
  for (const candidate of paths) {
    if (await fileExists(candidate)) return candidate
  }
  return ""
}

async function getModrinthAppLocations(customPath?: string): Promise<ModrinthAppLocations> {
  if (customPath) {
    const isDb = path.basename(customPath).toLowerCase() === "app.db" && await fileExists(customPath)
    const baseDir = isDb ? path.dirname(customPath) : customPath
    const isProfilesDir = path.basename(baseDir).toLowerCase() === "profiles"
    const profilesDir = await firstExisting(isProfilesDir
      ? [baseDir]
      : [path.join(baseDir, "profiles"), baseDir])
    const dbPath = isDb ? customPath : await firstExisting([
      path.join(baseDir, "app.db"),
      ...(isProfilesDir ? [path.join(path.dirname(baseDir), "app.db")] : []),
    ])
    return {
      profilesDir,
      dbPath,
      dataDir: dbPath ? path.dirname(dbPath) : (isProfilesDir ? path.dirname(baseDir) : baseDir),
    }
  }
  const home = app.getPath("home")
  let dataDir: string
  if (process.platform === "win32") {
    dataDir = path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "ModrinthApp")
  } else if (process.platform === "darwin") {
    dataDir = path.join(home, "Library", "Application Support", "ModrinthApp")
  } else {
    dataDir = path.join(home, ".local", "share", "ModrinthApp")
  }
  return {
    profilesDir: await firstExisting([path.join(dataDir, "profiles")]),
    dbPath: await firstExisting([path.join(dataDir, "app.db")]),
    dataDir,
  }
}

function mapProfileRow(row: unknown[]): ModrinthProfileRow {
  return {
    path: String(row[0] ?? ""),
    name: String(row[1] ?? ""),
    icon_path: row[2] ? String(row[2]) : null,
    game_version: String(row[3] ?? ""),
    mod_loader: String(row[4] ?? ""),
    mod_loader_version: row[5] ? String(row[5]) : null,
  }
}

async function readModrinthDbProfiles(dbPath: string): Promise<ModrinthProfileRow[]> {
  if (await sqliteTableExists(dbPath, "instances")) {
    const rows = await readSqliteDb<ModrinthProfileRow>(
      dbPath,
      `SELECT i.path, i.name, i.icon_path, ics.game_version, ics.loader, ics.loader_version
       FROM instances i
       JOIN instance_content_sets ics
         ON ics.id = i.applied_content_set_id AND ics.instance_id = i.id`,
      mapProfileRow,
    )
    if (rows.length > 0 || !(await sqliteTableExists(dbPath, "profiles"))) return rows
  }

  // Modrinth App до миграции на content sets хранил всё в таблице profiles.
  return readSqliteDb<ModrinthProfileRow>(
    dbPath,
    `SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version FROM profiles`,
    mapProfileRow,
  )
}

export async function discoverModrinthAppInstances(customPath?: string): Promise<LauncherInstance[]> {
  const { profilesDir, dbPath, dataDir } = await getModrinthAppLocations(customPath)
  if (!profilesDir) return []

  const rows = dbPath ? await readModrinthDbProfiles(dbPath) : []
  const profileMap = new Map<string, ModrinthProfileRow>()
  const foundPaths = new Set<string>()
  const instances: LauncherInstance[] = []

  for (const row of rows) {
    const dir = path.isAbsolute(row.path) ? path.normalize(row.path) : path.join(profilesDir, row.path)
    const normalized = path.normalize(dir)
    profileMap.set(normalized, row)
    if (!(await fileExists(dir))) continue
    const instance = await readModrinthInstance(dir, row, dataDir, profilesDir, path.join(dataDir, "meta"))
    if (instance) instances.push(instance)
    foundPaths.add(normalized)
  }

  const fromDirs = await discoverInstancesFromDirs([profilesDir], async (dir) => {
    const normalized = path.normalize(dir)
    if (foundPaths.has(normalized)) return null
    return readModrinthInstance(dir, profileMap.get(normalized), dataDir, profilesDir, path.join(dataDir, "meta"))
  })

  return [...instances, ...fromDirs].sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

async function readModrinthInstance(
  dir: string,
  dbRow: ModrinthProfileRow | undefined,
  dataDir: string,
  profilesDir: string,
  gameDataRoot: string,
): Promise<LauncherInstance | null> {
  const dirName = path.basename(dir)
  const version = dbRow?.game_version || "unknown"
  const loaderRaw = (dbRow?.mod_loader || "").toLowerCase()
  const modLoader = ["fabric", "forge", "neoforge", "quilt"].includes(loaderRaw) ? loaderRaw : "vanilla"
  const loaderVersion = dbRow?.mod_loader_version || undefined
  const importedVersion = await readVersionSelection(path.join(gameDataRoot, "versions"), [modLoader, loaderVersion ?? ""])
  const iconPath = await resolveInstanceIconPath(dbRow?.icon_path, [
    dir,
    profilesDir,
    path.join(dataDir, "caches"),
    dataDir,
  ])

  if (!isSupportedImportedLoader(modLoader)) return null

  const modsDirs = await getInstanceContentDirs(dir, "mods")
  const rpDirs = await getInstanceContentDirs(dir, "resourcepacks")
  const spDirs = await getInstanceContentDirs(dir, "shaderpacks")

  return {
    id: `modrinthapp:${dirName}`,
    name: dbRow?.name?.trim() || dirName,
    version,
    modLoader,
    loaderVersion,
    icon: iconPath,
    path: dir,
    source: "modrinthapp",
    gameDataRoot,
    versionId: importedVersion?.id,
    modCount: await countFilesInDirs(modsDirs),
    resourcepackCount: await countFilesInDirs(rpDirs),
    shaderCount: await countFilesInDirs(spDirs),
  }
}
