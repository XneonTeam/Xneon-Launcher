import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, uniqPaths, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath } from "./helpers"

type XLauncherInstanceJson = {
  name?: string
  description?: string
  icon?: string
  path?: string
  runtime?: {
    minecraft?: string
    fabricLoader?: string
    quiltLoader?: string
    forgeLoader?: string
    neoforgeLoader?: string
    optifine?: string
  }
}

async function getXLauncherInstancesDirs(): Promise<string[]> {
  const home = app.getPath("home")
  const isMacOS = process.platform === "darwin"
  const candidates = uniqPaths([
    ...(isMacOS
      ? [
        path.join(home, "Library", "Application Support", "xmcl", "instances"),
        path.join(home, "Library", "Application Support", ".minecraftx", "instances"),
      ]
      : [
        path.join(home, ".xmcl", "instances"),
        path.join(home, ".minecraftx", "instances"),
      ]
    ),
  ])
  const results: string[] = []
  for (const dir of candidates) {
    if (await fileExists(dir)) results.push(dir)
  }
  return results
}

function detectXLauncherModLoader(runtime: XLauncherInstanceJson["runtime"]): string {
  if (!runtime) return "vanilla"
  if (runtime.fabricLoader) return "fabric"
  if (runtime.quiltLoader) return "quilt"
  if (runtime.neoforgeLoader) return "neoforge"
  if (runtime.optifine) return "optifine"
  return "vanilla"
}

function detectXLauncherLoaderVersion(runtime: XLauncherInstanceJson["runtime"]): string | undefined {
  if (!runtime) return undefined
  return runtime.fabricLoader?.trim()
    || runtime.quiltLoader?.trim()
    || runtime.forgeLoader?.trim()
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

    return {
      id: `xlauncher:${path.basename(instanceDir)}`,
      name: parsed.name?.trim() || path.basename(instanceDir),
      version: parsed.runtime?.minecraft?.trim() || "unknown",
      modLoader: detectXLauncherModLoader(parsed.runtime),
      loaderVersion: detectXLauncherLoaderVersion(parsed.runtime),
      icon: resolveInstanceIconPath(parsed.icon, [
        instanceDir,
        path.join(instanceDir, ".minecraft"),
        path.dirname(instanceDir),
      ]),
      path: parsed.path?.trim() || instanceDir,
      source: "xlauncher",
      modCount: await countFilesInDirs(modsDirs),
      resourcepackCount: await countFilesInDirs(rpDirs),
      shaderCount: await countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

export async function discoverXLauncherInstances(): Promise<LauncherInstance[]> {
  const instances: LauncherInstance[] = []
  for (const instancesDir of await getXLauncherInstancesDirs()) {
    let entries
    try { entries = await fs.readdir(instancesDir, { withFileTypes: true }) } catch { continue }
    const dirs = entries.filter(e => e.isDirectory()).map(e => path.join(instancesDir, e.name))

    for (const dir of dirs) {
      const instance = await readXLauncherInstance(dir)
      if (instance) instances.push(instance)
    }
  }

  return instances.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}
