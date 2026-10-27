import { prepareInstanceStorageSync } from "../shared-game-cache"
import { randomUUID } from "crypto"
import path from "path"
import { dbHelpers } from "../../db"
import { ensureBuildIntentDir, scanIntentDir } from "../builds"
import { sendImportProgress } from "../builds/helpers"
import { discoverGdLauncherInstances } from "./gdlauncher"
import { discoverMmcLikeInstances } from "./mmc-like"
import { discoverXLauncherInstances } from "./xlauncher"
import { discoverModrinthAppInstances } from "./modrinthapp"
import { discoverMillidaInstances } from "./millida"
import { importInstanceVersions } from "./version-files"
import type { LauncherInstance } from "./helpers"
import { fileExists, copyDirContents, readIconAsDataUrl, resolveMcDir } from "./helpers"

export type { LauncherInstance }
export { discoverGdLauncherInstances }

const discoveredInstances = new Map<string, LauncherInstance>()

export async function discoverAllInstances(): Promise<LauncherInstance[]> {
  const [gd, mmcLike, xlauncher, modrinthapp, millida] = await Promise.all([
    discoverGdLauncherInstances(),
    discoverMmcLikeInstances(),
    discoverXLauncherInstances(),
    discoverModrinthAppInstances(),
    discoverMillidaInstances(),
  ])
  const all = [...gd, ...mmcLike, ...xlauncher, ...modrinthapp, ...millida].sort((a, b) => a.name.localeCompare(b.name, "ru"))
  console.log('[discoverAllInstances] Total instances:', all.length)
  console.log('[discoverAllInstances] Sources:', all.map(i => `${i.name} (${i.source})`))

  const hydrated = await Promise.all(
    all.map(async (instance) => ({
      ...instance,
      icon: await readIconAsDataUrl(instance.icon),
    }))
  )
  discoveredInstances.clear()
  for (const instance of hydrated) discoveredInstances.set(instance.id, instance)
  return hydrated
}

export type ImportSource = "gdlauncher" | "prism" | "multimc" | "polymc" | "xlauncher" | "modrinthapp" | "millida"

export async function discoverInstancesFromPath(source: ImportSource, customPath: string): Promise<LauncherInstance[]> {
  let instances: LauncherInstance[] = []

  switch (source) {
    case "gdlauncher":
      instances = await discoverGdLauncherInstances(customPath)
      break
    case "prism":
    case "multimc":
    case "polymc":
      instances = await discoverMmcLikeInstances(customPath, source)
      break
    case "xlauncher":
      instances = await discoverXLauncherInstances(customPath)
      break
    case "modrinthapp":
      instances = await discoverModrinthAppInstances(customPath)
      break
    case "millida":
      instances = await discoverMillidaInstances(customPath)
      break
  }

  const hydrated = await Promise.all(
    instances.map(async (instance) => ({
      ...instance,
      icon: await readIconAsDataUrl(instance.icon),
    }))
  )
  for (const [id, instance] of discoveredInstances) {
    if (instance.source === source) discoveredInstances.delete(id)
  }
  for (const instance of hydrated) discoveredInstances.set(instance.id, instance)
  return hydrated
}

export async function getDiscoveredInstancesByIds(selectedIds: Set<string>): Promise<LauncherInstance[]> {
  const cached = [...discoveredInstances.values()].filter((entry) => selectedIds.has(entry.id))
  if (cached.length > 0) return cached
  return (await discoverAllInstances()).filter((entry) => selectedIds.has(entry.id))
}

export async function importLauncherInstance(instance: LauncherInstance) {
  try {
    const intentPath = await ensureBuildIntentDir(instance.name)

    // При повторном импорте старой сборки снимаем только управляемые ссылки.
    if (process.env.XNLC_RESOURCE_DIR) prepareInstanceStorageSync(intentPath)
    const srcRoot = await resolveMcDir(instance.path)
    if (path.normalize(srcRoot) !== path.normalize(intentPath)) {
      // Copy the entire minecraft directory contents into the intent (like Ctrl+C / Ctrl+V).
      sendImportProgress(0, 100, "Копирование файлов...", instance.name, { operation: "launcher", source: "local", title: instance.name, phase: "copying" })
      await copyDirContents([srcRoot], intentPath, (copied, total) => {
        const percent = total > 0 ? Math.round((copied / total) * 85) : 90
        sendImportProgress(percent, 100, `Копирование файлов (${copied}/${total})...`, instance.name)
      })
    }
    const importedVersion = await importInstanceVersions(instance, srcRoot, intentPath)
    if (importedVersion.versionId) {
      sendImportProgress(90, 100, `Профиль версии ${importedVersion.versionId} импортирован`, instance.name)
    }
    sendImportProgress(90, 100, "Сканирование сборки...", instance.name)
    const scanned = await scanIntentDir(intentPath, (done, total) => {
      const fraction = total > 0 ? done / total : 0
      const percent = Math.round(90 + fraction * 10)
      sendImportProgress(percent, 100, `Сканирование сборки (${done}/${total})...`, instance.name)
    })

    sendImportProgress(100, 100, "Готово!", instance.name)

    // Read icon
    const iconDataUrl = await readIconAsDataUrl(instance.icon)

    const sourceNames: Record<string, string> = {
      gdlauncher: "GDLauncher",
      prism: "Prism Launcher",
      multimc: "MultiMC",
      polymc: "PolyMC",
      xlauncher: "X Launcher",
      modrinthapp: "Modrinth App",
      millida: "Millida Launcher",
    }

    return {
      id: randomUUID(),
      name: instance.name,
      description: `Импортировано из ${sourceNames[instance.source] || instance.source}`,
      version: instance.version,
      modLoader: instance.modLoader,
      loaderVersion: instance.loaderVersion,
      customVersionPath: importedVersion.versionId,
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
