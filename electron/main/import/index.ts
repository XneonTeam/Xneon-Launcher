import { randomUUID } from "crypto"
import { dbHelpers } from "../../db"
import { ensureBuildIntentDir, scanIntentDir } from "../builds"
import { sendImportProgress } from "../builds/helpers"
import { unlinkSharedGameLinksSync } from "../shared-game-cache"
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

export type ImportSource = "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher" | "modrinthapp"

export async function discoverInstancesFromPath(source: ImportSource, customPath: string): Promise<LauncherInstance[]> {
  let instances: LauncherInstance[] = []

  switch (source) {
    case "gdlauncher":
      instances = await discoverGdLauncherInstances(customPath)
      break
    case "prism":
    case "multimc":
    case "polymc":
      instances = await discoverMmcLikeInstances(customPath)
      break
    case "astralrinth":
      instances = await discoverAstralRinthInstances(customPath)
      break
    case "xlauncher":
      instances = await discoverXLauncherInstances(customPath)
      break
    case "modrinthapp":
      instances = await discoverModrinthAppInstances(customPath)
      break
  }

  const hydrated = await Promise.all(
    instances.map(async (instance) => ({
      ...instance,
      icon: await readIconAsDataUrl(instance.icon),
    }))
  )

  return hydrated
}

export async function importLauncherInstance(instance: LauncherInstance) {
  try {
    const intentPath = await ensureBuildIntentDir(instance.name)

    // Imported instances keep their own versions/libraries/assets — drop any
    // shared-cache links created by ensureBuildIntentDir so the copy lands
    // inside the per-instance layout.
    unlinkSharedGameLinksSync(intentPath)

    // Copy the entire minecraft directory contents into the intent (like Ctrl+C / Ctrl+V).
    const srcRoot = await resolveMcDir(instance.path)
    sendImportProgress(0, 100, "Копирование файлов...", instance.name)
    await copyDirContents([srcRoot], intentPath, (copied, total) => {
      const percent = total > 0 ? Math.round((copied / total) * 100) : 90
      sendImportProgress(percent, 100, `Копирование файлов (${copied}/${total})...`, instance.name)
    })
    sendImportProgress(90, 100, "Сканирование сборки...", instance.name)
    const scanned = await scanIntentDir(intentPath, (done, total) => {
      const fraction = total > 0 ? done / total : 0
      const percent = Math.round(90 + fraction * 10)
      sendImportProgress(percent, 100, `Сканирование сборки (${done}/${total})...`, instance.name)
    })

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
