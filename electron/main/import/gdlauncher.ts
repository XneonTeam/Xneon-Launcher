import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader, discoverInstancesFromDirs, readVersionSelection } from "./helpers"

type GdLauncherInstanceJson = {
  name?: string
  icon?: string | null
  created_at?: string
  modpack?: { platform?: string; project_id?: string | null } | null
  game_configuration?: {
    version?: string | {
      release?: string
      modloaders?: Array<{ type?: string; version?: string }>
    }
  }
}

async function getGdLauncherInstancesDir(customPath?: string): Promise<string> {
  if (customPath) {
    if (await fileExists(path.join(customPath, "instance.json"))) return path.dirname(customPath)
    const candidates = path.basename(customPath).toLowerCase() === "instances"
      ? [customPath]
      : [path.join(customPath, "instances"), path.join(customPath, "data", "instances"), customPath]
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate
    }
    return candidates[0]
  }
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
    const gameVersion = parsed.game_configuration?.version
    const loaders = typeof gameVersion === "object" ? gameVersion.modloaders ?? [] : []
    const firstLoader = loaders[0]
    const loaderType = firstLoader?.type?.toLowerCase() ?? "vanilla"
    const loaderVersion = firstLoader?.version?.trim() || undefined
    const version = typeof gameVersion === "string" ? gameVersion : gameVersion?.release ?? "unknown"
    if (!isSupportedImportedLoader(loaderType)) return null
    const importedVersion = await readVersionSelection(path.join(instanceDir, "instance", "versions"), [loaderType, loaderVersion ?? ""])
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
      gameDataRoot: path.join(instanceDir, "instance"),
      versionId: importedVersion?.id,
      modCount: await countFilesInDirs(modsDirs),
      resourcepackCount: await countFilesInDirs(rpDirs),
      shaderCount: await countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

export async function discoverGdLauncherInstances(customPath?: string): Promise<LauncherInstance[]> {
  const instancesDir = await getGdLauncherInstancesDir(customPath)
  if (!(await fileExists(instancesDir))) return []
  return discoverInstancesFromDirs([instancesDir], readGdLauncherInstance)
}
