import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader, readSqliteDb } from "./helpers"

type AstralProfileRow = {
  path: string
  name: string
  icon_path: string | null
  game_version: string
  mod_loader: string
  mod_loader_version: string | null
}

async function getAstralRinthProfilesDir(): Promise<string> {
  const home = app.getPath("home")
  const isWindows = process.platform === "win32"
  const appData = isWindows ? (process.env.APPDATA || "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming") : ""

  const candidates: string[] = []
  if (isWindows) {
    candidates.push(path.join(appData, "AstralRinthApp", "profiles"))
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "AstralRinthApp", "profiles"))
  } else {
    candidates.push(path.join(home, ".local", "share", "AstralRinthApp", "profiles"))
  }

  for (const d of candidates) { if (await fileExists(d)) return d }
  return ""
}

async function getAstralRinthDbPath(): Promise<string> {
  const home = app.getPath("home")
  const isWindows = process.platform === "win32"
  const appData = isWindows ? (process.env.APPDATA || "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming") : ""

  const candidates: string[] = []
  if (isWindows) {
    candidates.push(path.join(appData, "AstralRinthApp", "app.db"))
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "AstralRinthApp", "app.db"))
  } else {
    candidates.push(path.join(home, ".local", "share", "AstralRinthApp", "app.db"))
  }

  for (const d of candidates) { if (await fileExists(d)) return d }
  return ""
}

async function readAstralDbProfiles(dbPath: string): Promise<AstralProfileRow[]> {
  return readSqliteDb<AstralProfileRow>(
    dbPath,
    "SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version FROM profiles",
    (row) => ({
      path: String(row[0] ?? ""),
      name: String(row[1] ?? ""),
      icon_path: row[2] ? String(row[2]) : null,
      game_version: String(row[3] ?? ""),
      mod_loader: String(row[4] ?? ""),
      mod_loader_version: row[5] ? String(row[5]) : null,
    }),
  )
}

export async function discoverAstralRinthInstances(): Promise<LauncherInstance[]> {
  const profilesDir = await getAstralRinthProfilesDir()
  const dbPath = await getAstralRinthDbPath()
  if (!profilesDir && !dbPath) return []

  const profileMap = new Map<string, AstralProfileRow>()

  // Try reading from SQLite
  if (dbPath) {
    try {
      const rows = await readAstralDbProfiles(dbPath)
      for (const row of rows) {
        profileMap.set(row.path, row)
      }
    } catch { /* ignore */ }
  }

  // Scan profile directories
  const instances: LauncherInstance[] = []
  if (profilesDir) {
    let dirs: string[]
    try {
      const entries = await fs.readdir(profilesDir, { withFileTypes: true })
      dirs = entries.filter(entry => entry.isDirectory()).map(entry => path.join(profilesDir, entry.name))
    } catch { return [] }

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
        else if (loaderRaw === "quilt") modLoader = "quilt"
        else if (loaderRaw === "forge") modLoader = "forge"
        else if (loaderRaw === "neoforge") modLoader = "neoforge"
        loaderVersion = dbRow.mod_loader_version || undefined

        iconPath = await resolveInstanceIconPath(dbRow.icon_path, [
          dir,
          profilesDir,
          path.dirname(dbPath || profilesDir),
        ])
      }

      if (!isSupportedImportedLoader(modLoader)) {
        continue
      }

      const modsDirs = await getInstanceContentDirs(dir, "mods")
      const rpDirs = await getInstanceContentDirs(dir, "resourcepacks")
      const spDirs = await getInstanceContentDirs(dir, "shaderpacks")

      instances.push({
        id: `astralrinth:${dirName}`,
        name: dbRow?.name?.trim() || dirName,
        version,
        modLoader,
        loaderVersion,
        icon: iconPath,
        path: dir,
        source: "astralrinth",
        modCount: await countFilesInDirs(modsDirs),
        resourcepackCount: await countFilesInDirs(rpDirs),
        shaderCount: await countFilesInDirs(spDirs),
      })
    }
  }

  return instances.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}
