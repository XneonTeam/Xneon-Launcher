import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader } from "./helpers"

type ModrinthProfileRow = {
  path: string
  name: string
  icon_path: string | null
  game_version: string
  mod_loader: string
  mod_loader_version: string | null
}

let sqlJsModule: any = null

async function getModrinthAppProfilesDir(): Promise<string> {
  const home = app.getPath("home")
  const isWindows = process.platform === "win32"
  const appData = isWindows ? (process.env.APPDATA || "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming") : ""

  const candidates: string[] = []
  if (isWindows) {
    candidates.push(path.join(appData, "ModrinthApp", "profiles"))
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "ModrinthApp", "profiles"))
  } else {
    candidates.push(path.join(home, ".local", "share", "ModrinthApp", "profiles"))
  }

  for (const d of candidates) { if (await fileExists(d)) return d }
  return ""
}

async function getModrinthAppDbPath(): Promise<string> {
  const home = app.getPath("home")
  const isWindows = process.platform === "win32"
  const appData = isWindows ? (process.env.APPDATA || "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming") : ""

  const candidates: string[] = []
  if (isWindows) {
    candidates.push(path.join(appData, "ModrinthApp", "app.db"))
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "ModrinthApp", "app.db"))
  } else {
    candidates.push(path.join(home, ".local", "share", "ModrinthApp", "app.db"))
  }

  for (const d of candidates) { if (await fileExists(d)) return d }
  return ""
}

async function readModrinthDbProfiles(dbPath: string): Promise<ModrinthProfileRow[]> {
  try {
    if (!sqlJsModule) {
      const initSqlJs = await import("sql.js")
      sqlJsModule = initSqlJs.default || initSqlJs
    }
    const data = await fs.readFile(dbPath)
    const db = new sqlJsModule.Database(data)
    const results = db.exec("SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version FROM profiles")
    db.close()
    if (!results.length) return []
    const rows: ModrinthProfileRow[] = []
    for (const row of results[0].values) {
      rows.push({
        path: String(row[0] ?? ""),
        name: String(row[1] ?? ""),
        icon_path: row[2] ? String(row[2]) : null,
        game_version: String(row[3] ?? ""),
        mod_loader: String(row[4] ?? ""),
        mod_loader_version: row[5] ? String(row[5]) : null,
      })
    }
    return rows
  } catch {
    return []
  }
}

export async function discoverModrinthAppInstances(): Promise<LauncherInstance[]> {
  const profilesDir = await getModrinthAppProfilesDir()
  const dbPath = await getModrinthAppDbPath()
  if (!profilesDir) return []

  const profileMap = new Map<string, ModrinthProfileRow>()
  if (dbPath) {
    try {
      const rows = await readModrinthDbProfiles(dbPath)
      for (const row of rows) {
        profileMap.set(row.path, row)
      }
    } catch { /* ignore */ }
  }

  const instances: LauncherInstance[] = []
  let entries
  try { entries = await fs.readdir(profilesDir, { withFileTypes: true }) } catch { return [] }
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => path.join(profilesDir, entry.name))

  for (const dir of dirs) {
    const dirName = path.basename(dir)
    const dbRow = profileMap.get(dirName) || profileMap.get(dir)

    let version = "unknown"
    let modLoader = "vanilla"
    let loaderVersion: string | undefined
    let iconPath: string | undefined

    if (dbRow) {
      version = dbRow.game_version || "unknown"
      const loaderRaw = (dbRow.mod_loader || "").toLowerCase()
      if (loaderRaw === "fabric") modLoader = "fabric"
      else if (loaderRaw === "forge") modLoader = "forge"
      else if (loaderRaw === "neoforge") modLoader = "neoforge"
      else if (loaderRaw === "quilt") modLoader = "quilt"
      loaderVersion = dbRow.mod_loader_version || undefined
      iconPath = resolveInstanceIconPath(dbRow.icon_path, [dir, profilesDir, path.dirname(dbPath || profilesDir)])
    }

    if (!isSupportedImportedLoader(modLoader)) continue

    const modsDirs = await getInstanceContentDirs(dir, "mods")
    const rpDirs = await getInstanceContentDirs(dir, "resourcepacks")
    const spDirs = await getInstanceContentDirs(dir, "shaderpacks")

    instances.push({
      id: `modrinthapp:${dirName}`,
      name: dbRow?.name?.trim() || dirName,
      version,
      modLoader,
      loaderVersion,
      icon: iconPath,
      path: dir,
      source: "modrinthapp",
      modCount: await countFilesInDirs(modsDirs),
      resourcepackCount: await countFilesInDirs(rpDirs),
      shaderCount: await countFilesInDirs(spDirs),
    })
  }

  return instances.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}
