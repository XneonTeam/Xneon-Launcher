import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader, discoverInstancesFromDirs, readVersionSelection } from "./helpers"

type MillidaProfile = {
  name?: string
  version?: string
  fabric?: boolean
  loader?: string | null
  loader_version?: string | null
  icon?: string | null
}

type MillidaSettings = {
  name?: string
  version?: string
  loader?: string
  loaderVersion?: string
  icon?: string
}

type MillidaLocations = {
  dataDir: string
  gameRoot: string
  profilesDir: string
}

export function defaultDataDirs(): string[] {
  const home = app.getPath("home")
  if (process.platform === "win32") {
    return [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "net.millida.launcher")]
  }
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "net.millida.launcher")]
  }
  return [
    path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "net.millida.launcher"),
    path.join(home, ".var", "app", "net.millida.launcher", "data", "net.millida.launcher"),
  ]
}

async function resolveMillidaLocations(customPath?: string): Promise<MillidaLocations[]> {
  if (customPath) {
    if (await fileExists(path.join(customPath, "millida-settings.json"))) {
      return [{ dataDir: customPath, gameRoot: customPath, profilesDir: path.dirname(customPath) }]
    }
    if (path.basename(customPath).toLowerCase() === "profiles") {
      return [{ dataDir: customPath, gameRoot: path.dirname(customPath), profilesDir: customPath }]
    }
    let gameRoot = await fileExists(path.join(customPath, "profiles")) ? customPath : path.join(customPath, "minecraft")
    try {
      const configured = (await fs.readFile(path.join(customPath, "game-root.txt"), "utf-8")).trim()
      if (configured) gameRoot = configured
    } catch {}
    return [{
      dataDir: customPath,
      gameRoot,
      profilesDir: path.join(gameRoot, "profiles"),
    }]
  }

  const locations: MillidaLocations[] = []
  for (const dataDir of defaultDataDirs()) {
    let gameRoot = path.join(dataDir, "minecraft")
    try {
      const configured = (await fs.readFile(path.join(dataDir, "game-root.txt"), "utf-8")).trim()
      if (configured) gameRoot = configured
    } catch {}
    locations.push({ dataDir, gameRoot, profilesDir: path.join(gameRoot, "profiles") })
  }
  return locations
}

function millidaDirSlug(name: string): string {
  const safe = Array.from(name).filter((char) => /[\p{L}\p{N}_-]/u.test(char)).join("")
  return safe || "default"
}

function normalizedLoader(profile: MillidaProfile): string {
  const loader = profile.loader?.trim().toLowerCase()
  if (loader) return loader
  return profile.fabric ? "fabric" : "vanilla"
}

async function readMillidaInstance(
  instanceDir: string,
  listed: MillidaProfile | undefined,
  gameRoot: string,
): Promise<LauncherInstance | null> {
  let settings: MillidaSettings = {}
  try {
    settings = JSON.parse(await fs.readFile(path.join(instanceDir, "millida-settings.json"), "utf-8")) as MillidaSettings
  } catch {}

  if (!listed && !settings.version) return null
  const modLoader = normalizedLoader({
    loader: settings.loader ?? listed?.loader,
    fabric: listed?.fabric,
  })
  if (!isSupportedImportedLoader(modLoader)) return null
  const importedVersion = await readVersionSelection(path.join(gameRoot, "versions"), [modLoader, settings.loaderVersion ?? listed?.loader_version ?? ""])

  const name = settings.name?.trim() || listed?.name?.trim() || path.basename(instanceDir)
  const icon = await resolveInstanceIconPath(settings.icon || listed?.icon, [instanceDir])
  const modsDirs = await getInstanceContentDirs(instanceDir, "mods")
  const rpDirs = await getInstanceContentDirs(instanceDir, "resourcepacks")
  const spDirs = await getInstanceContentDirs(instanceDir, "shaderpacks")

  return {
    id: `millida:${path.basename(instanceDir)}`,
    name,
    version: settings.version?.trim() || listed?.version?.trim() || "unknown",
    modLoader,
    loaderVersion: settings.loaderVersion?.trim() || listed?.loader_version?.trim() || undefined,
    icon,
    path: instanceDir,
    source: "millida",
    versionId: importedVersion?.id,
    modCount: await countFilesInDirs(modsDirs),
    resourcepackCount: await countFilesInDirs(rpDirs),
    shaderCount: await countFilesInDirs(spDirs),
  }
}

async function readListedProfiles(dataDir: string): Promise<MillidaProfile[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dataDir, "profiles.json"), "utf-8")) as unknown
    return Array.isArray(parsed) ? parsed as MillidaProfile[] : []
  } catch {
    return []
  }
}

export async function discoverMillidaInstances(customPath?: string): Promise<LauncherInstance[]> {
  if (customPath && await fileExists(path.join(customPath, "millida-settings.json"))) {
    const gameRoot = path.basename(path.dirname(customPath)).toLowerCase() === "profiles"
      ? path.dirname(path.dirname(customPath))
      : customPath
    const instance = await readMillidaInstance(customPath, undefined, gameRoot)
    return instance ? [{ ...instance, gameDataRoot: gameRoot }] : []
  }
  const locations = await resolveMillidaLocations(customPath)
  const instances: LauncherInstance[] = []
  const seenPaths = new Set<string>()
  for (const { dataDir, gameRoot, profilesDir } of locations) {
    if (!(await fileExists(profilesDir))) continue
    const listedProfiles = await readListedProfiles(dataDir)
    const bySlug = new Map(listedProfiles.map((profile) => [millidaDirSlug(profile.name?.trim() || ""), profile]))
    const found = await discoverInstancesFromDirs<LauncherInstance>([profilesDir], async (dir): Promise<LauncherInstance | null> => {
      const normalized = path.normalize(dir)
      if (seenPaths.has(normalized)) return null
      seenPaths.add(normalized)
      const slug = path.basename(dir)
      const listed = bySlug.get(slug)
        ?? listedProfiles.find((profile) => millidaDirSlug(profile.name?.trim() || "") === slug)
      const instance = await readMillidaInstance(dir, listed, gameRoot)
      return instance ? { ...instance, gameDataRoot: gameRoot } : null
    })
    instances.push(...found)
  }
  return instances.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}
