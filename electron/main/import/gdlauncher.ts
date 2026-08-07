import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader } from "./helpers"

type GdLauncherInstanceJson = {
  name?: string
  icon?: string | null
  created_at?: string
  modpack?: { platform?: string; project_id?: string | null } | null
  game_configuration?: {
    version?: {
      release?: string
      modloaders?: Array<{ type?: string; version?: string }>
    }
  }
}

function getGdLauncherInstancesDir() {
  const home = app.getPath("home")
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
    return path.join(appData, "gdlauncher_carbon", "data", "instances")
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "gdlauncher_carbon", "data", "instances")
  }
  return path.join(home, ".local", "share", "gdlauncher_carbon", "data", "instances")
}

async function readGdLauncherInstance(instanceDir: string): Promise<LauncherInstance | null> {
  try {
    const configPath = path.join(instanceDir, "instance.json")
    if (!(await fileExists(configPath))) return null

    const raw = await fs.readFile(configPath, "utf-8")
    const parsed = JSON.parse(raw) as GdLauncherInstanceJson
    const loaders = parsed.game_configuration?.version?.modloaders ?? []
    const firstLoader = loaders[0]
    const loaderType = firstLoader?.type?.toLowerCase() ?? "vanilla"
    const loaderVersion = firstLoader?.version?.trim() || undefined
    const version = parsed.game_configuration?.version?.release ?? "unknown"
    if (!isSupportedImportedLoader(loaderType)) return null
    const iconFile = await resolveInstanceIconPath(parsed.icon, [
      instanceDir,
      path.join(instanceDir, "instance"),
      path.dirname(instanceDir),
    ])

    const modsDirs = await getInstanceContentDirs(instanceDir, "mods")
    const rpDirs = await getInstanceContentDirs(instanceDir, "resourcepacks")
    const spDirs = await getInstanceContentDirs(instanceDir, "shaderpacks")

    return {
      id: `gdlauncher:${path.basename(instanceDir)}`,
      name: parsed.name?.trim() || path.basename(instanceDir),
      version,
      modLoader: loaderType,
      loaderVersion,
      icon: iconFile,
      path: instanceDir,
      source: "gdlauncher",
      modCount: await countFilesInDirs(modsDirs),
      resourcepackCount: await countFilesInDirs(rpDirs),
      shaderCount: await countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

export async function discoverGdLauncherInstances(): Promise<LauncherInstance[]> {
  const instancesDir = getGdLauncherInstancesDir()
  if (!(await fileExists(instancesDir))) return []

  let entries
  try { entries = await fs.readdir(instancesDir, { withFileTypes: true }) } catch { return [] }
  const dirs = entries.filter(e => e.isDirectory()).map(e => path.join(instancesDir, e.name))

  const results: LauncherInstance[] = []
  for (const dir of dirs) {
    const instance = await readGdLauncherInstance(dir)
    if (instance) results.push(instance)
  }
  return results.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}
