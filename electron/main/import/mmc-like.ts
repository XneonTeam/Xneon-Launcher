import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, isSupportedImportedLoader } from "./helpers"

type MmcLikeType = "multimc" | "polymc" | "prism"

async function getMmcLikeInstancesDirs(): Promise<{ type: MmcLikeType; dirs: string[] }[]> {
  const home = app.getPath("home")
  const isWindows = process.platform === "win32"
  const isMacOS = process.platform === "darwin"
  const appData = isWindows ? (process.env.APPDATA || "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming") : ""
  const result: { type: MmcLikeType; dirs: string[] }[] = []

  // MultiMC
  const mmcDirs: string[] = []
  if (isWindows) {
    mmcDirs.push(
      path.join(appData, "MultiMC", "instances"),
    )
  } else if (isMacOS) {
    mmcDirs.push(
      path.join(home, "Library", "Application Support", "multimc", "instances"),
    )
  } else {
    mmcDirs.push(
      path.join(home, ".local", "share", "MultiMC", "instances"),
      path.join(home, ".var", "app", "org.multimc.MultiMC", "data", "MultiMC", "instances"),
    )
  }
  const mmcExisting = (await Promise.all(mmcDirs.map(async d => (await fileExists(d)) ? d : null))).filter(Boolean) as string[]
  if (mmcExisting.length) result.push({ type: "multimc", dirs: mmcExisting })

  // PolyMC
  const pmcDirs: string[] = []
  if (isWindows) {
    pmcDirs.push(
      path.join(appData, "PolyMC", "instances"),
    )
  } else if (isMacOS) {
    pmcDirs.push(
      path.join(home, "Library", "Application Support", "PolyMC", "instances"),
    )
  } else {
    pmcDirs.push(
      path.join(home, ".local", "share", "PolyMC", "instances"),
      path.join(home, ".var", "app", "org.polymc.PolyMC", "data", "PolyMC", "instances"),
    )
  }
  const pmcExisting = (await Promise.all(pmcDirs.map(async d => (await fileExists(d)) ? d : null))).filter(Boolean) as string[]
  if (pmcExisting.length) result.push({ type: "polymc", dirs: pmcExisting })

  // Prism Launcher
  const prismDirs: string[] = []
  if (isWindows) {
    prismDirs.push(
      path.join(appData, "PrismLauncher", "instances"),
    )
  } else if (isMacOS) {
    prismDirs.push(
      path.join(home, "Library", "Application Support", "PrismLauncher", "instances"),
    )
  } else {
    prismDirs.push(
      path.join(home, ".var", "app", "org.prismlauncher.PrismLauncher", "data", "PrismLauncher", "instances"),
      path.join(home, ".local", "share", "PrismLauncher", "instances"),
      path.join(home, ".PrismLauncher", "instances"),
    )
  }
  const prismExisting = (await Promise.all(prismDirs.map(async d => (await fileExists(d)) ? d : null))).filter(Boolean) as string[]
  if (prismExisting.length) result.push({ type: "prism", dirs: prismExisting })

  return result
}

async function getMmcLikeIconsDir(type: MmcLikeType): Promise<string> {
  const home = app.getPath("home")
  const isMacOS = process.platform === "darwin"
  const candidates: string[] = []

  if (type === "multimc") {
    if (isMacOS) {
      candidates.push(
        path.join(home, "Library", "Application Support", "multimc", "icons"),
      )
    }
    candidates.push(
      path.join(home, ".local", "share", "MultiMC", "icons"),
      path.join(home, ".var", "app", "org.polymc.PolyMC", "data", "MultiMC", "icons"),
    )
  } else if (type === "polymc") {
    if (isMacOS) {
      candidates.push(
        path.join(home, "Library", "Application Support", "PolyMC", "icons"),
      )
    }
    candidates.push(
      path.join(home, ".local", "share", "PolyMC", "icons"),
      path.join(home, ".var", "app", "org.polymc.PolyMC", "data", "PolyMC", "icons"),
    )
  } else if (type === "prism") {
    if (isMacOS) {
      candidates.push(
        path.join(home, "Library", "Application Support", "PrismLauncher", "icons"),
      )
    }
    candidates.push(
      path.join(home, ".var", "app", "org.prismlauncher.PrismLauncher", "data", "PrismLauncher", "icons"),
      path.join(home, ".local", "share", "PrismLauncher", "icons"),
      path.join(home, ".PrismLauncher", "icons"),
    )
  }

  for (const c of candidates) {
    if (await fileExists(c)) return c
  }
  return ""
}

function parseIniValue(iniContent: string, key: string): string | undefined {
  const lines = iniContent.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith(key + "=")) {
      return trimmed.slice(key.length + 1).trim()
    }
  }
  return undefined
}

async function readMmcLikeInstance(instanceDir: string, iconsDir: string, type: MmcLikeType): Promise<LauncherInstance | null> {
  try {
    const cfgPath = path.join(instanceDir, "instance.cfg")
    if (!(await fileExists(cfgPath))) return null

    const cfgRaw = await fs.readFile(cfgPath, "utf-8")
    const cfgName = parseIniValue(cfgRaw, "name")
    const cfgIconKey = parseIniValue(cfgRaw, "iconKey")

    let version = "unknown"
    let modLoader: string = "vanilla"
    let loaderVersion: string | undefined

    // Try mmc-pack.json first (newer format)
    const mmcPackPath = path.join(instanceDir, "mmc-pack.json")
    if (await fileExists(mmcPackPath)) {
      try {
        const mmcPack = JSON.parse(await fs.readFile(mmcPackPath, "utf-8"))
        const components: Array<{ uid: string; version: string }> = mmcPack.components ?? []
        for (const comp of components) {
          if (comp.uid === "net.minecraft") version = comp.version
          else if (comp.uid === "net.fabricmc.fabric-loader") { modLoader = "fabric"; loaderVersion = comp.version }
          else if (comp.uid === "org.quiltmc.quilt-loader") { modLoader = "quilt"; loaderVersion = comp.version }
          else if (comp.uid === "net.neoforged") { modLoader = "neoforge"; loaderVersion = comp.version }
        }
      } catch {}
    }

    // Fallback: try minecraft.json (older format)
    if (version === "unknown") {
      const mcJsonPath = path.join(instanceDir, "minecraft.json")
      if (await fileExists(mcJsonPath)) {
        try {
          const mcJson = JSON.parse(await fs.readFile(mcJsonPath, "utf-8"))
          if (mcJson.baseVersion) version = mcJson.baseVersion
          if (mcJson.javaArguments) {
            const args = mcJson.javaArguments as string
            if (args.includes("fabric")) modLoader = "fabric"
            else if (args.includes("quilt")) modLoader = "quilt"
            else if (args.includes("neoforge")) modLoader = "neoforge"
          }
        } catch {}
      }
    }

    if (!isSupportedImportedLoader(modLoader)) return null

    let iconPath: string | undefined
    if (cfgIconKey && iconsDir) {
      for (const ext of ["png", "jpg", "jpeg", "svg", "webp", "bmp", "ico"]) {
        const candidate = path.join(iconsDir, `${cfgIconKey}.${ext}`)
        if (await fileExists(candidate)) { iconPath = candidate; break }
      }
    }

    // Also check for icon.png in instance dir
    if (!iconPath) {
      const localIcon = path.join(instanceDir, "icon.png")
      if (await fileExists(localIcon)) iconPath = localIcon
    }

    const modsDirs = await getInstanceContentDirs(instanceDir, "mods")
    const rpDirs = await getInstanceContentDirs(instanceDir, "resourcepacks")
    const spDirs = await getInstanceContentDirs(instanceDir, "shaderpacks")

    return {
      id: `${type}:${path.basename(instanceDir)}`,
      name: cfgName?.trim() || path.basename(instanceDir),
      version,
      modLoader,
      loaderVersion,
      icon: iconPath,
      path: instanceDir,
      source: type,
      modCount: await countFilesInDirs(modsDirs),
      resourcepackCount: await countFilesInDirs(rpDirs),
      shaderCount: await countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

export async function discoverMmcLikeInstances(): Promise<LauncherInstance[]> {
  const instances: LauncherInstance[] = []
  const mmcLikeConfigs = await getMmcLikeInstancesDirs()

  console.log('[MultiMC/PolyMC/Prism] Found configs:', mmcLikeConfigs)

  for (const { type, dirs } of mmcLikeConfigs) {
    const iconsDir = await getMmcLikeIconsDir(type)
    console.log(`[${type}] Checking dirs:`, dirs, `iconsDir:`, iconsDir)
    for (const instancesDir of dirs) {
      if (!(await fileExists(instancesDir))) continue
      let entries
      try { entries = await fs.readdir(instancesDir, { withFileTypes: true }) } catch { continue }
      const dirs2 = entries.filter(e => e.isDirectory()).map(e => path.join(instancesDir, e.name))

      console.log(`[${type}] Found dirs in ${instancesDir}:`, dirs2.length)

      for (const dir of dirs2) {
        const inst = await readMmcLikeInstance(dir, iconsDir, type)
        if (inst) {
          console.log(`[${type}] Found instance:`, inst.name, inst.id)
          instances.push(inst)
        }
      }
    }
  }

  console.log('[MultiMC/PolyMC/Prism] Total instances found:', instances.length)
  return instances.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}
