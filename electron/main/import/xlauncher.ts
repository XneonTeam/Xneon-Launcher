import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, uniqPaths, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader, discoverInstancesFromDirs, readVersionSelection } from "./helpers"

type XLauncherInstanceJson = {
  name?: string
  description?: string
  icon?: string
  path?: string
  runtime?: {
    minecraft?: string
    fabricLoader?: string
    quiltLoader?: string
    forge?: string
    forgeLoader?: string
    neoForged?: string
    neoforgeLoader?: string
    optifine?: string
  }
}

async function getXLauncherInstancesDirs(customPath?: string): Promise<string[]> {
  const autoDiscover = !customPath
  if (customPath) {
    const instances = path.join(customPath, "instances")
    if (await fileExists(instances)) return [instances]
    if (await fileExists(path.join(customPath, "instance.json"))) return [path.dirname(customPath)]
    if (await fileExists(customPath)) return [customPath]
  }
  const home = app.getPath("home")
  const isMacOS = process.platform === "darwin"
  const appData = process.platform === "win32"
    ? process.env.APPDATA || path.join(home, "AppData", "Roaming")
    : isMacOS
      ? path.join(home, "Library", "Application Support")
      : path.join(home, ".config")
  const appDirs = uniqPaths([
    path.join(appData, "xmcl"),
    ...(!isMacOS ? [path.join(home, ".xmcl"), path.join(home, ".minecraftx")] : []),
    ...(isMacOS ? [path.join(appData, ".minecraftx")] : []),
  ])
  const candidates = uniqPaths([
    ...appDirs.map((dir) => path.join(dir, "instances")),
  ])
  const results: string[] = []
  for (const dir of candidates) {
    if (await fileExists(dir)) results.push(dir)
  }

  // Новый XMCL хранит внешние сборки отдельно от каталога managed instances.
  for (const appDir of autoDiscover ? appDirs : []) {
    try {
      const registry = JSON.parse(await fs.readFile(path.join(appDir, "instances.json"), "utf-8")) as { instances?: string[] }
      for (const item of registry.instances ?? []) {
        if (typeof item !== "string" || !path.isAbsolute(item)) continue
        if (await fileExists(path.join(item, "instance.json"))) results.push(path.dirname(item))
      }
      const customRoot = (await fs.readFile(path.join(appDir, "root"), "utf-8")).trim()
      if (customRoot) {
        const customInstances = path.join(customRoot, "instances")
        if (await fileExists(customInstances)) results.push(customInstances)
      }
    } catch {}
  }
  return uniqPaths(results)
}

function detectXLauncherModLoader(runtime: XLauncherInstanceJson["runtime"]): string {
  if (!runtime) return "vanilla"
  if (runtime.fabricLoader) return "fabric"
  if (runtime.quiltLoader) return "quilt"
  if (runtime.forge || runtime.forgeLoader) return "forge"
  if (runtime.neoForged || runtime.neoforgeLoader) return "neoforge"
  if (runtime.optifine) return "optifine"
  return "vanilla"
}

function detectXLauncherLoaderVersion(runtime: XLauncherInstanceJson["runtime"]): string | undefined {
  if (!runtime) return undefined
  return runtime.fabricLoader?.trim()
    || runtime.quiltLoader?.trim()
    || runtime.forge?.trim()
    || runtime.forgeLoader?.trim()
    || runtime.neoForged?.trim()
    || runtime.neoforgeLoader?.trim()
    || runtime.optifine?.trim()
    || undefined
}

async function readXLauncherInstance(instanceDir: string): Promise<LauncherInstance | null> {
  try {
    const instanceJsonPath = path.join(instanceDir, "instance.json")
    if (!(await fileExists(instanceJsonPath))) return null

    const parsed = JSON.parse(await fs.readFile(instanceJsonPath, "utf-8")) as XLauncherInstanceJson
    const modsDirs = await getInstanceContentDirs(instanceDir, "mods")
    const rpDirs = await getInstanceContentDirs(instanceDir, "resourcepacks")
    const spDirs = await getInstanceContentDirs(instanceDir, "shaderpacks")

    const iconPath = await resolveInstanceIconPath(parsed.icon, [
      instanceDir,
      path.join(instanceDir, "minecraft"),
      path.join(instanceDir, ".minecraft"),
    ])
    const modLoader = detectXLauncherModLoader(parsed.runtime)
    if (!isSupportedImportedLoader(modLoader)) return null
    const loaderVersion = detectXLauncherLoaderVersion(parsed.runtime)
    const importedVersion = await readVersionSelection(path.join(instanceDir, "versions"), [modLoader, loaderVersion ?? ""])

    return {
      id: `xlauncher:${path.basename(instanceDir)}`,
      name: parsed.name?.trim() || path.basename(instanceDir),
      version: parsed.runtime?.minecraft?.trim() || "unknown",
      modLoader,
      loaderVersion,
      icon: iconPath,
      path: instanceDir,
      source: "xlauncher",
      gameDataRoot: instanceDir,
      versionId: importedVersion?.id,
      modCount: await countFilesInDirs(modsDirs),
      resourcepackCount: await countFilesInDirs(rpDirs),
      shaderCount: await countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

export async function discoverXLauncherInstances(customPath?: string): Promise<LauncherInstance[]> {
  const dirs = await getXLauncherInstancesDirs(customPath)
  if (customPath && await fileExists(path.join(customPath, "instance.json"))) {
    const instance = await readXLauncherInstance(customPath)
    return instance ? [instance] : []
  }
  return discoverInstancesFromDirs(dirs, readXLauncherInstance)
}
