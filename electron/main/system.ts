import { app, dialog, ipcMain, shell } from "electron"
import path from "path"
import fs from "fs"
import { execSync } from "child_process"
import { randomUUID } from "crypto"
import { dbHelpers, isUsingFallbackStorage } from "../db"
import { getMainWindow } from "./runtime"
import { ensureBuildIntentDir, getBuildIntentDirName, scanIntentDir, sendImportProgress } from "./builds"

const MOJANG_BASE = "https://launchercontent.mojang.com"

function resolveImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  return `${MOJANG_BASE}${url.startsWith("/") ? "" : "/"}${url}`
}

function isSupportedImportedLoader(modLoader: string): boolean {
  return !!modLoader
}

function getJavaVersion(javaExe: string): string | null {
  try {
    const out = execSync(`"${javaExe}" -version 2>&1`, { timeout: 4000, encoding: "utf-8" })
    const m = out.match(/version "([^"]+)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function makeJavaLabel(version: string): string {
  const parts = version.split(".")
  const major = parts[0] === "1" ? parseInt(parts[1]) : parseInt(parts[0])
  return `Java ${major} (${version})`
}

type LauncherInstance = {
  id: string
  name: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon?: string
  path: string
  source: "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher"
  modCount?: number
  resourcepackCount?: number
  shaderCount?: number
}

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
  return path.join(app.getPath("home"), ".local", "share", "gdlauncher_carbon", "data", "instances")
}

function resolveInstanceIconPath(iconPath: string | null | undefined, searchRoots: string[]): string | undefined {
  const raw = iconPath?.trim()
  if (!raw) return undefined
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) return raw

  const normalizedRaw = raw.startsWith("file://") ? raw.slice("file://".length) : raw
  const candidates = normalizedRaw.startsWith("/")
    ? [normalizedRaw]
    : searchRoots.flatMap((root) => [
      path.join(root, normalizedRaw),
      path.join(root, path.basename(normalizedRaw)),
    ])

  for (const candidate of uniqPaths(candidates)) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

function readGdLauncherInstance(instanceDir: string): LauncherInstance | null {
  try {
    const configPath = path.join(instanceDir, "instance.json")
    if (!fs.existsSync(configPath)) return null

    const raw = fs.readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(raw) as GdLauncherInstanceJson
    const loaders = parsed.game_configuration?.version?.modloaders ?? []
    const firstLoader = loaders[0]
    const loaderType = firstLoader?.type?.toLowerCase() ?? "vanilla"
    const loaderVersion = firstLoader?.version?.trim() || undefined
    const version = parsed.game_configuration?.version?.release ?? "unknown"
    if (!isSupportedImportedLoader(loaderType)) return null
    const iconFile = resolveInstanceIconPath(parsed.icon, [
      instanceDir,
      path.join(instanceDir, "instance"),
      path.dirname(instanceDir),
    ])

    const modsDirs = getInstanceContentDirs(instanceDir, "mods")
    const rpDirs = getInstanceContentDirs(instanceDir, "resourcepacks")
    const spDirs = getInstanceContentDirs(instanceDir, "shaderpacks")

    return {
      id: `gdlauncher:${path.basename(instanceDir)}`,
      name: parsed.name?.trim() || path.basename(instanceDir),
      version,
      modLoader: loaderType,
      loaderVersion,
      icon: iconFile && fs.existsSync(iconFile) ? iconFile : undefined,
      path: instanceDir,
      source: "gdlauncher",
      modCount: countFilesInDirs(modsDirs),
      resourcepackCount: countFilesInDirs(rpDirs),
      shaderCount: countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

// ── MultiMC / PolyMC / Prism Launcher ──────────────────────

type MmcLikeType = "multimc" | "polymc" | "prism"

function getMmcLikeInstancesDirs(): { type: MmcLikeType; dirs: string[] }[] {
  const home = app.getPath("home")
  const isWindows = process.platform === "win32"
  const appData = isWindows ? (process.env.APPDATA || "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming") : ""
  const result: { type: MmcLikeType; dirs: string[] }[] = []

  // MultiMC
  const mmcDirs: string[] = []
  if (isWindows) {
    mmcDirs.push(
      path.join(appData, "MultiMC", "instances"),
    )
  } else {
    mmcDirs.push(
      path.join(home, ".local", "share", "MultiMC", "instances"),
      path.join(home, ".var", "app", "org.multimc.MultiMC", "data", "MultiMC", "instances"),
    )
  }
  if (mmcDirs.filter(d => fs.existsSync(d)).length) result.push({ type: "multimc", dirs: mmcDirs.filter(d => fs.existsSync(d)) })

  // PolyMC
  const pmcDirs: string[] = []
  if (isWindows) {
    pmcDirs.push(
      path.join(appData, "PolyMC", "instances"),
    )
  } else {
    pmcDirs.push(
      path.join(home, ".local", "share", "PolyMC", "instances"),
      path.join(home, ".var", "app", "org.polymc.PolyMC", "data", "PolyMC", "instances"),
    )
  }
  if (pmcDirs.filter(d => fs.existsSync(d)).length) result.push({ type: "polymc", dirs: pmcDirs.filter(d => fs.existsSync(d)) })

  // Prism Launcher
  const prismDirs: string[] = []
  if (isWindows) {
    prismDirs.push(
      path.join(appData, "PrismLauncher", "instances"),
    )
  } else {
    prismDirs.push(
      path.join(home, ".var", "app", "org.prismlauncher.PrismLauncher", "data", "PrismLauncher", "instances"),
      path.join(home, ".local", "share", "PrismLauncher", "instances"),
      path.join(home, ".PrismLauncher", "instances"),
    )
  }
  if (prismDirs.filter(d => fs.existsSync(d)).length) result.push({ type: "prism", dirs: prismDirs.filter(d => fs.existsSync(d)) })

  return result
}

function getMmcLikeIconsDir(type: MmcLikeType): string {
  const home = app.getPath("home")
  const candidates: string[] = []

  if (type === "multimc") {
    candidates.push(
      path.join(home, ".local", "share", "MultiMC", "icons"),
      path.join(home, ".var", "app", "org.polymc.PolyMC", "data", "MultiMC", "icons"),
    )
  } else if (type === "polymc") {
    candidates.push(
      path.join(home, ".local", "share", "PolyMC", "icons"),
      path.join(home, ".var", "app", "org.polymc.PolyMC", "data", "PolyMC", "icons"),
    )
  } else if (type === "prism") {
    candidates.push(
      path.join(home, ".var", "app", "org.prismlauncher.PrismLauncher", "data", "PrismLauncher", "icons"),
      path.join(home, ".local", "share", "PrismLauncher", "icons"),
      path.join(home, ".PrismLauncher", "icons"),
    )
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c
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

function readMmcLikeInstance(instanceDir: string, iconsDir: string, type: MmcLikeType): LauncherInstance | null {
  try {
    const cfgPath = path.join(instanceDir, "instance.cfg")
    if (!fs.existsSync(cfgPath)) return null

    const cfgRaw = fs.readFileSync(cfgPath, "utf-8")
    const cfgName = parseIniValue(cfgRaw, "name")
    const cfgIconKey = parseIniValue(cfgRaw, "iconKey")

    let version = "unknown"
    let modLoader: string = "vanilla"
    let loaderVersion: string | undefined

    // Try mmc-pack.json first (newer format)
    const mmcPackPath = path.join(instanceDir, "mmc-pack.json")
    if (fs.existsSync(mmcPackPath)) {
      try {
        const mmcPack = JSON.parse(fs.readFileSync(mmcPackPath, "utf-8"))
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
      if (fs.existsSync(mcJsonPath)) {
        try {
          const mcJson = JSON.parse(fs.readFileSync(mcJsonPath, "utf-8"))
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
        if (fs.existsSync(candidate)) { iconPath = candidate; break }
      }
    }

    // Also check for icon.png in instance dir
    if (!iconPath) {
      const localIcon = path.join(instanceDir, "icon.png")
      if (fs.existsSync(localIcon)) iconPath = localIcon
    }

    const modsDirs = getInstanceContentDirs(instanceDir, "mods")
    const rpDirs = getInstanceContentDirs(instanceDir, "resourcepacks")
    const spDirs = getInstanceContentDirs(instanceDir, "shaderpacks")

    return {
      id: `${type}:${path.basename(instanceDir)}`,
      name: cfgName?.trim() || path.basename(instanceDir),
      version,
      modLoader,
      loaderVersion,
      icon: iconPath,
      path: instanceDir,
      source: type,
      modCount: countFilesInDirs(modsDirs),
      resourcepackCount: countFilesInDirs(rpDirs),
      shaderCount: countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

function discoverMmcLikeInstances(): LauncherInstance[] {
  const instances: LauncherInstance[] = []
  const mmcLikeConfigs = getMmcLikeInstancesDirs()

  console.log('[MultiMC/PolyMC/Prism] Found configs:', mmcLikeConfigs)

  for (const { type, dirs } of mmcLikeConfigs) {
    const iconsDir = getMmcLikeIconsDir(type)
    console.log(`[${type}] Checking dirs:`, dirs, `iconsDir:`, iconsDir)
    for (const instancesDir of dirs) {
      if (!fs.existsSync(instancesDir)) continue
      const entries = fs.readdirSync(instancesDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => path.join(instancesDir, e.name))

      console.log(`[${type}] Found dirs in ${instancesDir}:`, entries.length)

      for (const dir of entries) {
        const inst = readMmcLikeInstance(dir, iconsDir, type)
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

// ── AstralRinth ─────────────────────────────────────────────

function getAstralRinthProfilesDir(): string {
  const home = app.getPath("home")
  const dir = path.join(home, ".local", "share", "AstralRinthApp", "profiles")
  return fs.existsSync(dir) ? dir : ""
}

function getAstralRinthDbPath(): string {
  const home = app.getPath("home")
  const dbPath = path.join(home, ".local", "share", "AstralRinthApp", "app.db")
  return fs.existsSync(dbPath) ? dbPath : ""
}

type AstralProfileRow = {
  path: string
  name: string
  icon_path: string | null
  game_version: string
  mod_loader: string
  mod_loader_version: string | null
}

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

function discoverAstralRinthInstances(): LauncherInstance[] {
  const profilesDir = getAstralRinthProfilesDir()
  const dbPath = getAstralRinthDbPath()
  if (!profilesDir && !dbPath) return []

  const profileMap = new Map<string, AstralProfileRow>()

  // Try reading from SQLite
  if (dbPath) {
    try {
      const rows = readAstralDbProfiles(dbPath)
      for (const row of rows) {
        profileMap.set(row.path, row)
      }
    } catch { /* ignore */ }
  }

  // Scan profile directories
  const instances: LauncherInstance[] = []
  if (profilesDir) {
    const dirs = fs.readdirSync(profilesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(profilesDir, entry.name))

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
        else if (loaderRaw === "neoforge") modLoader = "neoforge"
        loaderVersion = dbRow.mod_loader_version || undefined
        iconPath = resolveInstanceIconPath(dbRow.icon_path, [
          dir,
          profilesDir,
          path.dirname(dbPath || profilesDir),
        ])
      }

      if (!isSupportedImportedLoader(modLoader)) {
        continue
      }

      const modsDirs = getInstanceContentDirs(dir, "mods")
      const rpDirs = getInstanceContentDirs(dir, "resourcepacks")
      const spDirs = getInstanceContentDirs(dir, "shaderpacks")

      instances.push({
        id: `astralrinth:${dirName}`,
        name: dbRow?.name?.trim() || dirName,
        version,
        modLoader,
        loaderVersion,
        icon: iconPath,
        path: dir,
        source: "astralrinth",
        modCount: countFilesInDirs(modsDirs),
        resourcepackCount: countFilesInDirs(rpDirs),
        shaderCount: countFilesInDirs(spDirs),
      })
    }
  }

  return instances.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

// ── X Launcher / XMCL-style instances ──────────────────────

function getXLauncherInstancesDirs(): string[] {
  const home = app.getPath("home")
  return uniqPaths([
    path.join(home, ".minecraftx", "instances"),
    path.join(home, ".xmcl", "instances"),
  ]).filter((dir) => fs.existsSync(dir))
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

function readXLauncherInstance(instanceDir: string): LauncherInstance | null {
  try {
    const instanceJsonPath = path.join(instanceDir, "instance.json")
    if (!fs.existsSync(instanceJsonPath)) return null

    const parsed = JSON.parse(fs.readFileSync(instanceJsonPath, "utf-8")) as XLauncherInstanceJson
    const modsDirs = getInstanceContentDirs(instanceDir, "mods")
    const rpDirs = getInstanceContentDirs(instanceDir, "resourcepacks")
    const spDirs = getInstanceContentDirs(instanceDir, "shaderpacks")

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
      modCount: countFilesInDirs(modsDirs),
      resourcepackCount: countFilesInDirs(rpDirs),
      shaderCount: countFilesInDirs(spDirs),
    }
  } catch {
    return null
  }
}

function discoverXLauncherInstances(): LauncherInstance[] {
  const instances: LauncherInstance[] = []
  for (const instancesDir of getXLauncherInstancesDirs()) {
    const dirs = fs.readdirSync(instancesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(instancesDir, entry.name))

    for (const dir of dirs) {
      const instance = readXLauncherInstance(dir)
      if (instance) instances.push(instance)
    }
  }

  return instances.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

function readAstralDbProfiles(dbPath: string): AstralProfileRow[] {
  // Use better-sqlite3 or fall back to raw sqlite3 CLI
  try {
    const result = execSync(`sqlite3 "${dbPath}" "SELECT path, name, icon_path, game_version, mod_loader, mod_loader_version FROM profiles;" -json`, {
      timeout: 5000,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    })
    if (!result.trim()) return []
    return JSON.parse(result) as AstralProfileRow[]
  } catch {
    return []
  }
}

// ── Helpers ─────────────────────────────────────────

function countFilesInDir(dir: string): number {
  try {
    if (!fs.existsSync(dir)) return 0
    return fs.readdirSync(dir).filter(f => {
      try { return fs.statSync(path.join(dir, f)).isFile() } catch { return false }
    }).length
  } catch { return 0 }
}

function uniqPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((item) => path.normalize(item))))
}

function getInstanceContentDirs(instancePath: string, contentDirName: "mods" | "resourcepacks" | "shaderpacks"): string[] {
  const dotMc = path.join(instancePath, ".minecraft")
  const mc = path.join(instancePath, "minecraft")
  const gdInstance = path.join(instancePath, "instance")
  return uniqPaths([
    path.join(resolveMcDir(instancePath), contentDirName),
    path.join(dotMc, contentDirName),
    path.join(mc, contentDirName),
    path.join(gdInstance, contentDirName),
    path.join(instancePath, contentDirName),
  ]).filter((dir) => fs.existsSync(dir))
}

function countFilesInDirs(dirs: string[]): number {
  const entries = new Set<string>()
  const collectFiles = (dir: string, parentPath = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relativePath = parentPath ? path.posix.join(parentPath, entry.name) : entry.name
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        collectFiles(filePath, relativePath)
        continue
      }
      if (entry.isFile()) {
        entries.add(relativePath)
      }
    }
  }
  for (const dir of dirs) {
    try {
      collectFiles(dir)
    } catch { /* skip dir read errors */ }
  }
  return entries.size
}

function copyEntryRecursive(srcPath: string, destPath: string): number {
  try {
    const stat = fs.statSync(srcPath)
    if (stat.isDirectory()) {
      if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true })
      let copied = 0
      for (const entry of fs.readdirSync(srcPath)) {
        copied += copyEntryRecursive(path.join(srcPath, entry), path.join(destPath, entry))
      }
      return copied
    }

    if (fs.existsSync(destPath)) return 0
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcPath, destPath)
    return 1
  } catch {
    return 0
  }
}

function copyDirContents(srcDirs: string[], destDir: string): number {
  if (!srcDirs.length) return 0
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
  let copied = 0
  for (const srcDir of srcDirs) {
    try {
      for (const entry of fs.readdirSync(srcDir)) {
        copied += copyEntryRecursive(path.join(srcDir, entry), path.join(destDir, entry))
      }
    } catch { /* skip dir read errors */ }
  }
  return copied
}

function isImportedContentEntry(filePath: string, type: "mod" | "resourcepack" | "shader"): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) return type !== "mod"
    const lowerName = path.basename(filePath).toLowerCase()
    if (type === "mod") return lowerName.endsWith(".jar") || lowerName.endsWith(".zip")
    return lowerName.endsWith(".zip") || lowerName.endsWith(".jar")
  } catch {
    return false
  }
}

function buildImportedContentList(dir: string, type: "mod" | "resourcepack" | "shader", source: LauncherInstance["source"]) {
  const items: Array<{ id: string; slug: string; name: string; description: string; version: string }> = []
  if (!fs.existsSync(dir)) return items

  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file)
    if (!isImportedContentEntry(filePath, type)) continue
    items.push({
      id: randomUUID(),
      slug: file,
      name: file.replace(/\.jar$|\.zip$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      description: `Импортировано из ${source}`,
      version: "local",
    })
  }

  return items
}

function readIconAsDataUrl(iconPath: string | undefined): string {
  if (!iconPath) return ""
  if (iconPath.startsWith("http://") || iconPath.startsWith("https://")) return iconPath
  if (!fs.existsSync(iconPath)) return ""
  try {
    const ext = path.extname(iconPath).toLowerCase()
    const mimeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
      ".bmp": "image/bmp", ".ico": "image/x-icon",
    }
    const mime = mimeMap[ext] || "image/png"
    const data = fs.readFileSync(iconPath)
    return `data:${mime};base64,${data.toString("base64")}`
  } catch { return "" }
}

// ── Unified discovery ───────────────────────────────────────

function discoverAllInstances(): LauncherInstance[] {
  const gd = discoverGdLauncherInstances()
  const mmcLike = discoverMmcLikeInstances()
  const astral = discoverAstralRinthInstances()
  const xlauncher = discoverXLauncherInstances()
  const all = [...gd, ...mmcLike, ...astral, ...xlauncher].sort((a, b) => a.name.localeCompare(b.name, "ru"))
  console.log('[discoverAllInstances] Total instances:', all.length)
  console.log('[discoverAllInstances] Sources:', all.map(i => `${i.name} (${i.source})`))
  return all
}

function discoverGdLauncherInstances(): LauncherInstance[] {
  const instancesDir = getGdLauncherInstancesDir()
  if (!fs.existsSync(instancesDir)) return []

  const dirs = fs.readdirSync(instancesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(instancesDir, entry.name))

  return dirs
    .map(readGdLauncherInstance)
    .filter((entry): entry is LauncherInstance => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

function resolveMcDir(instancePath: string): string {
  // Prism Launcher uses "minecraft/" (no dot), GDLauncher Carbon uses "instance/",
  // and other launchers usually use ".minecraft/" or the instance root itself.
  const gdInstance = path.join(instancePath, "instance")
  if (fs.existsSync(gdInstance)) return gdInstance
  const dotMc = path.join(instancePath, ".minecraft")
  if (fs.existsSync(dotMc)) return dotMc
  const mc = path.join(instancePath, "minecraft")
  if (fs.existsSync(mc)) return mc
  return instancePath
}

function importLauncherInstance(instance: LauncherInstance): { id: string; name: string; description: string; version: string; modLoader: string; loaderVersion?: string; icon: string; coverImage?: string; mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; createdAt: string; source: "local"; projectSlug?: string; intentPath: string; installedMods: Record<string, string> } | null {
  try {
    const intentPath = ensureBuildIntentDir(instance.name)

    // Copy mods
    const srcMods = getInstanceContentDirs(instance.path, "mods")
    const destMods = path.join(intentPath, "mods")
    copyDirContents(srcMods, destMods)

    // Copy resourcepacks
    const srcRp = getInstanceContentDirs(instance.path, "resourcepacks")
    const destRp = path.join(intentPath, "resourcepacks")
    copyDirContents(srcRp, destRp)

    // Copy shaderpacks
    const srcSp = getInstanceContentDirs(instance.path, "shaderpacks")
    const destSp = path.join(intentPath, "shaderpacks")
    copyDirContents(srcSp, destSp)
    const scanned = scanIntentDir(intentPath)

    // Read icon
    const iconDataUrl = readIconAsDataUrl(instance.icon)

    const sourceNames: Record<string, string> = {
      gdlauncher: "GDLauncher",
      prism: "Prism Launcher",
      multimc: "MultiMC",
      polymc: "PolyMC",
      astralrinth: "AstralRinth",
      xlauncher: "X Launcher",
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
      source: "local",
      intentPath,
      installedMods: scanned.installedMods,
    }
  } catch {
    return null
  }
}

export function registerSystemHandlers() {
  ipcMain.handle("fetch:minecraft-news", async () => {
    try {
      const res = await fetch(`${MOJANG_BASE}/v2/news.json`)
      const data = await res.json() as { entries?: Record<string, unknown>[] }
      const entries = data.entries ?? []
      return entries.map(e => ({
        ...e,
        playPageImage: e.playPageImage ? { ...(e.playPageImage as Record<string, unknown>), url: resolveImageUrl((e.playPageImage as { url?: string }).url) } : e.playPageImage,
        newsPageImage: e.newsPageImage ? { ...(e.newsPageImage as Record<string, unknown>), url: resolveImageUrl((e.newsPageImage as { url?: string }).url) } : e.newsPageImage,
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle("db:load-accounts", async () => dbHelpers.loadAccounts())
  ipcMain.handle("db:save-account", async (_event, account) => dbHelpers.saveAccount(account))
  ipcMain.handle("db:remove-account", async (_event, id: string) => dbHelpers.removeAccount(id))
  ipcMain.handle("db:load-builds", async () => dbHelpers.loadBuilds())
  ipcMain.handle("db:save-builds", async (_event, builds) => dbHelpers.saveAllBuilds(builds))
  ipcMain.handle("db:is-fallback-storage", async () => ({ isFallback: isUsingFallbackStorage() }))
  ipcMain.handle("launcher:discover-importable-instances", async () => discoverAllInstances())
  ipcMain.handle("launcher:import-gdlauncher-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const sourceInstances = discoverGdLauncherInstances().filter((entry) => selectedIds.has(entry.id))
    if (sourceInstances.length === 0) return { success: true, imported: 0 }

    const existingBuilds = await dbHelpers.loadBuilds()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds = sourceInstances
      .filter((entry) => !existingNames.has(entry.name.trim().toLowerCase()))
      .map((entry) => importLauncherInstance(entry))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds([...importedBuilds, ...existingBuilds])
    return { success: true, imported: importedBuilds.length }
  })
  ipcMain.handle("launcher:import-instances", async (_event, ids: string[]) => {
    const selectedIds = Array.isArray(ids) ? new Set(ids) : new Set<string>()
    const allInstances = discoverAllInstances().filter((entry) => selectedIds.has(entry.id))
    if (allInstances.length === 0) return { success: true, imported: 0 }

    const existingBuilds = await dbHelpers.loadBuilds()
    const existingNames = new Set(existingBuilds.map((build) => build.name.trim().toLowerCase()))

    const importedBuilds = allInstances
      .filter((entry) => !existingNames.has(entry.name.trim().toLowerCase()))
      .map((entry) => importLauncherInstance(entry))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    if (importedBuilds.length === 0) {
      return { success: true, imported: 0 }
    }

    await dbHelpers.saveAllBuilds([...importedBuilds, ...existingBuilds])
    return { success: true, imported: importedBuilds.length }
  })
  ipcMain.handle("settings:get", async (_event, key: string) => dbHelpers.getSetting(key))
  ipcMain.handle("settings:set", async (_event, key: string, value: string) => dbHelpers.setSetting(key, value))

  ipcMain.handle("shell:open-external", (_event, url: string) => shell.openExternal(url))
  ipcMain.handle("shell:open-launcher-folder", async (): Promise<void> => {
    const launcherDir = await dbHelpers.getLauncherDirectory()
    await shell.openPath(launcherDir)
  })

  ipcMain.handle("shell:open-path", async (_event, dirPath: string): Promise<void> => {
    await shell.openPath(dirPath)
  })

  ipcMain.handle("java:detect", async (): Promise<{ path: string; version: string; label: string }[]> => {
    const found: { path: string; version: string; label: string }[] = []
    const visited = new Set<string>()
    const tryJava = (javaExe: string) => {
      const normalized = path.normalize(javaExe)
      if (visited.has(normalized)) return
      visited.add(normalized)
      if (!fs.existsSync(normalized)) return
      const version = getJavaVersion(normalized)
      if (!version) return
      found.push({ path: normalized, version, label: makeJavaLabel(version) })
    }

    if (process.platform === "win32") {
      const bases = [
        "C:\\Program Files\\Java",
        "C:\\Program Files\\Eclipse Adoptium",
        "C:\\Program Files\\Microsoft",
        "C:\\Program Files\\Zulu",
        "C:\\Program Files\\BellSoft",
        "C:\\Program Files\\Amazon Corretto",
        "C:\\Program Files\\OpenJDK",
      ]
      for (const base of bases) {
        if (!fs.existsSync(base)) continue
        for (const dir of fs.readdirSync(base)) tryJava(path.join(base, dir, "bin", "java.exe"))
      }
      try {
        const whereOut = execSync("where java 2>nul", { timeout: 3000, encoding: "utf-8" })
        for (const line of whereOut.split("\n")) {
          const p = line.trim()
          if (p) tryJava(p)
        }
      } catch {}
    } else if (process.platform === "darwin") {
      const jvmBase = "/Library/Java/JavaVirtualMachines"
      if (fs.existsSync(jvmBase)) {
        for (const dir of fs.readdirSync(jvmBase)) tryJava(path.join(jvmBase, dir, "Contents", "Home", "bin", "java"))
      }
      for (const p of ["/opt/homebrew/opt/openjdk/bin/java", "/usr/local/opt/openjdk/bin/java"]) tryJava(p)
      try {
        const homeOut = execSync("/usr/libexec/java_home -V 2>&1", { timeout: 3000, encoding: "utf-8" })
        for (const m of homeOut.matchAll(/^\s+(\/\S+)/gm)) tryJava(path.join(m[1], "bin", "java"))
      } catch {}
    } else {
      const jvmBase = "/usr/lib/jvm"
      if (fs.existsSync(jvmBase)) {
        for (const dir of fs.readdirSync(jvmBase)) tryJava(path.join(jvmBase, dir, "bin", "java"))
      }
      for (const p of ["/usr/bin/java", "/usr/local/bin/java"]) tryJava(p)
      try {
        const which = execSync("which java 2>/dev/null", { timeout: 3000, encoding: "utf-8" }).trim()
        if (which) tryJava(which)
      } catch {}
    }

    return found
  })

  ipcMain.handle("java:pick-file", async (): Promise<string | null> => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: "Выбрать исполняемый файл Java",
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Java", extensions: ["exe"] }] : [{ name: "Все файлы", extensions: ["*"] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle("logs:share-to-mclogs", async (_event, content: string): Promise<{ success: boolean; url?: string; error?: string }> => {
    try {
      const res = await fetch("https://api.mclo.gs/1/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source: "XNeon Launcher" }),
      })
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
      const data = await res.json() as { success: boolean; url?: string; error?: string }
      if (!data.success) return { success: false, error: data.error ?? "Ошибка mclo.gs" }
      if (data.url) await shell.openExternal(data.url)
      return { success: true, url: data.url }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
