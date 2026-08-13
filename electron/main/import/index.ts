import { randomUUID } from "crypto"
import { dbHelpers } from "../../db"
import { ensureBuildIntentDir, scanIntentDir } from "../builds"
import { discoverGdLauncherInstances } from "./gdlauncher"
import { discoverMmcLikeInstances } from "./mmc-like"
import { discoverAstralRinthInstances } from "./astralrinth"
import { discoverXLauncherInstances } from "./xlauncher"
import { discoverModrinthAppInstances } from "./modrinthapp"
import type { LauncherInstance } from "./helpers"
import { fileExists, copyDirContents, readIconAsDataUrl, resolveMcDir } from "./helpers"

export type { LauncherInstance }
export { discoverGdLauncherInstances }

export async function discoverAllInstances(): Promise<LauncherInstance[]> {
  const [gd, mmcLike, astral, xlauncher, modrinthapp] = await Promise.all([
    discoverGdLauncherInstances(),
    discoverMmcLikeInstances(),
    discoverAstralRinthInstances(),
    discoverXLauncherInstances(),
    discoverModrinthAppInstances(),
  ])
  const all = [...gd, ...mmcLike, ...astral, ...xlauncher, ...modrinthapp].sort((a, b) => a.name.localeCompare(b.name, "ru"))
  console.log('[discoverAllInstances] Total instances:', all.length)
  console.log('[discoverAllInstances] Sources:', all.map(i => `${i.name} (${i.source})`))

  const hydrated = await Promise.all(
    all.map(async (instance) => ({
      ...instance,
      icon: await readIconAsDataUrl(instance.icon),
    }))
  )

  return hydrated
}

export async function importLauncherInstance(instance: LauncherInstance) {
  try {
    const intentPath = await ensureBuildIntentDir(instance.name)

    // Copy the entire minecraft directory contents into the intent (like Ctrl+C / Ctrl+V).
    const srcRoot = await resolveMcDir(instance.path)
    await copyDirContents([srcRoot], intentPath)
    const scanned = await scanIntentDir(intentPath)

    // Read icon
    const iconDataUrl = await readIconAsDataUrl(instance.icon)

    const sourceNames: Record<string, string> = {
      gdlauncher: "GDLauncher",
      prism: "Prism Launcher",
      multimc: "MultiMC",
      polymc: "PolyMC",
      astralrinth: "AstralRinth",
      xlauncher: "X Launcher",
      modrinthapp: "Modrinth App",
    }

    return {
      id: randomUUID(),
      name: instance.name,
      description: `Импортировано из ${sourceNames[instance.source] || instance.source}`,
      version: instance.version,
      modLoader: instance.modLoader,
      loaderVersion: instance.loaderVersion,
      icon: iconDataUrl,
      coverImage: iconDataUrl || undefined,
      mods: scanned.mods,
      resourcepacks: scanned.resourcepacks,
      shaders: scanned.shaders,
      createdAt: new Date().toISOString(),
      source: "local" as const,
      intentPath,
      installedMods: scanned.installedMods,
      playtime: 0,
    }
  } catch {
    return null
  }
}
