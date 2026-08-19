import path from "path"
import fs from "fs/promises"
import { app } from "electron"
import type { LauncherInstance } from "./helpers"
import { fileExists, getInstanceContentDirs, countFilesInDirs, resolveInstanceIconPath, isSupportedImportedLoader, readSqliteDb } from "./helpers"

type AstralInstanceRow = {
  id: string
  path: string
  name: string
  icon_path: string | null
  applied_content_set_id: string | null
  last_played: number | null
}

type AstralContentSetRow = {
  id: string
  instance_id: string
  game_version: string | null
  loader: string | null
  loader_version: string | null
}

async function getAstralRinthDbPath(customPath?: string): Promise<string> {
  if (customPath) {
    const dbPath = path.join(customPath, "app.db")
    if (await fileExists(dbPath)) return dbPath
  }
  const home = app.getPath("home")
  const isWindows = process.platform === "win32"
  const appData = isWindows ? (process.env.APPDATA || "C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming") : ""

  const candidates: string[] = []
  if (isWindows) {
    candidates.push(path.join(appData, "AstralRinthApp", "app.db"))
  } else if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "AstralRinthApp", "app.db"))
  } else {
    candidates.push(path.join(home, ".local", "share", "AstralRinthApp", "app.db"))
  }

  for (const d of candidates) { if (await fileExists(d)) return d }
  return ""
}

async function getAstralRinthBasePath(dbPath: string): Promise<string> {
  return path.dirname(dbPath)
}

function readInstances(dbPath: string): Promise<AstralInstanceRow[]> {
  return readSqliteDb<AstralInstanceRow>(
    dbPath,
    "SELECT id, path, name, icon_path, applied_content_set_id, last_played FROM instances",
    (row) => ({
      id: String(row[0] ?? ""),
      path: String(row[1] ?? ""),
      name: String(row[2] ?? ""),
      icon_path: row[3] ? String(row[3]) : null,
      applied_content_set_id: row[4] ? String(row[4]) : null,
      last_played: row[5] != null ? Number(row[5]) : null,
    }),
  )
}

function readContentSets(dbPath: string): Promise<AstralContentSetRow[]> {
  return readSqliteDb<AstralContentSetRow>(
    dbPath,
    "SELECT id, instance_id, game_version, loader, loader_version FROM instance_content_sets",
    (row) => ({
      id: String(row[0] ?? ""),
      instance_id: String(row[1] ?? ""),
      game_version: row[2] ? String(row[2]) : null,
      loader: row[3] ? String(row[3]) : null,
      loader_version: row[4] ? String(row[4]) : null,
    }),
  )
}

function resolveLoader(raw: string | null): { modLoader: string; loaderVersion?: string } {
  const loader = (raw ?? "").toLowerCase()
  if (loader === "fabric") return { modLoader: "fabric" }
  if (loader === "quilt") return { modLoader: "quilt" }
  if (loader === "forge") return { modLoader: "forge" }
  if (loader === "neoforge") return { modLoader: "neoforge" }
  return { modLoader: "vanilla" }
}

export async function discoverAstralRinthInstances(customPath?: string): Promise<LauncherInstance[]> {
  const dbPath = await getAstralRinthDbPath(customPath)
  if (!dbPath) return []

  const basePath = await getAstralRinthBasePath(dbPath)

  const [instances, contentSets] = await Promise.all([
    readInstances(dbPath),
    readContentSets(dbPath),
  ])

  const contentSetById = new Map(contentSets.map(cs => [cs.id, cs]))
  const contentSetByInstance = new Map<string, AstralContentSetRow>()
  for (const cs of contentSets) {
    if (!contentSetByInstance.has(cs.instance_id)) {
      contentSetByInstance.set(cs.instance_id, cs)
    }
  }

  const result: LauncherInstance[] = []

  for (const inst of instances) {
    const cs = inst.applied_content_set_id
      ? contentSetById.get(inst.applied_content_set_id) ?? contentSetByInstance.get(inst.id)
      : contentSetByInstance.get(inst.id)

    const { modLoader, loaderVersion } = resolveLoader(cs?.loader ?? null)
    if (!isSupportedImportedLoader(modLoader)) continue

    // Путь к директории инстанса
    const instancePath = path.isAbsolute(inst.path)
      ? inst.path
      : path.join(basePath, "profiles", inst.path)

    if (!(await fileExists(instancePath))) continue

    // Иконка
    let iconPath: string | undefined
    if (inst.icon_path) {
      iconPath = await resolveInstanceIconPath(inst.icon_path, [instancePath, basePath])
    }

    const modsDirs = await getInstanceContentDirs(instancePath, "mods")
    const rpDirs = await getInstanceContentDirs(instancePath, "resourcepacks")
    const spDirs = await getInstanceContentDirs(instancePath, "shaderpacks")

    result.push({
      id: `astralrinth:${inst.id}`,
      name: inst.name?.trim() || path.basename(inst.path),
      version: cs?.game_version ?? "unknown",
      modLoader,
      loaderVersion: cs?.loader_version ?? loaderVersion,
      icon: iconPath,
      path: instancePath,
      source: "astralrinth",
      modCount: await countFilesInDirs(modsDirs),
      resourcepackCount: await countFilesInDirs(rpDirs),
      shaderCount: await countFilesInDirs(spDirs),
    })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}
