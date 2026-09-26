// ============================================================
// XNLC — Storage Manager
// Reports per-build disk usage and cleans up logs, crash
// reports, caches, the trash bin and downloaded Java runtimes.
// ============================================================

import { ipcMain } from "electron"
import path from "path"
import fs from "fs/promises"
import { dbHelpers } from "../db"
import { getBuildIntentPath } from "./builds"
import { getInstancesRoot } from "./builds/helpers"
import { getGameDir } from "./minecraft-core"
import { getMcServerDir } from "./paths"
import type {
  BuildStorageEntry,
  ServerStorageEntry,
  JavaRuntimeEntry,
  StorageCleanResult,
  StorageCleanTarget,
  StorageScanResult,
} from "@xnlc/types" with { "resolution-mode": "import" }

const SIZE_CONCURRENCY = 8

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Recursive directory size. Symlinks/junctions are NOT followed — the shared
 * game cache is linked into every intent dir and would be counted N times.
 */
export async function getDirectorySize(root: string): Promise<number> {
  let total = 0
  const pending: string[] = [root]

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const fileSizes = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name)
      try {
        if (entry.isSymbolicLink()) return 0
        if (entry.isDirectory()) {
          pending.push(fullPath)
          return 0
        }
        const stat = await fs.stat(fullPath)
        return stat.size
      } catch {
        return 0
      }
    }))
    for (const size of fileSizes) total += size
  }

  // BFS with a small amount of parallelism via the entries-level Promise.all.
  while (pending.length > 0) {
    const batch = pending.splice(0, SIZE_CONCURRENCY)
    await Promise.all(batch.map(walk))
  }
  return total
}

async function sumSubdirs(root: string, names: string[]): Promise<number> {
  let total = 0
  for (const name of names) {
    const target = path.join(root, name)
    if (await pathExists(target)) {
      total += await getDirectorySize(target)
    }
  }
  return total
}

async function scanBuilds(): Promise<BuildStorageEntry[]> {
  // Лёгкий список: для подсчёта размеров нужны только id/имя/иконка/версия.
  const builds = await dbHelpers.loadBuildsLight()
  const entries: BuildStorageEntry[] = []

  for (const build of builds) {
    try {
      const intentPath = getBuildIntentPath(build.name)
      if (!(await pathExists(intentPath))) continue

      const [total, mods, resourcepacks, shaderpacks, saves, config, logs, crashReports, cache] = await Promise.all([
        getDirectorySize(intentPath),
        sumSubdirs(intentPath, ["mods"]),
        sumSubdirs(intentPath, ["resourcepacks"]),
        sumSubdirs(intentPath, ["shaderpacks"]),
        sumSubdirs(intentPath, ["saves"]),
        sumSubdirs(intentPath, ["config"]),
        sumSubdirs(intentPath, ["logs"]),
        sumSubdirs(intentPath, ["crash-reports"]),
        sumSubdirs(intentPath, [".cache", ".fabric", ".quilt"]),
      ])

      const accounted = mods + resourcepacks + shaderpacks + saves + config + logs + crashReports + cache
      entries.push({
        buildId: build.id,
        name: build.name,
        path: intentPath,
        icon: build.icon ?? "",
        version: build.version ?? "",
        modLoader: build.modLoader ?? "",
        total,
        mods,
        resourcepacks,
        shaderpacks,
        saves,
        config,
        logs,
        crashReports,
        cache,
        other: Math.max(0, total - accounted),
      })
    } catch (error) {
      console.warn(`[Storage] Failed to scan build "${build.name}":`, error)
    }
  }

  return entries.sort((a, b) => b.total - a.total)
}

const MOJANG_COMPONENT_TO_VERSION: Record<string, string> = {
  "java-runtime-alpha": "16",
  "java-runtime-beta": "17",
  "java-runtime-gamma": "17",
  "java-runtime-delta": "21",
  "java-runtime-epsilon": "21",
  "jre-legacy": "8",
}

function majorFromVersion(version: string): string {
  const match = version.match(/^(\d+)\./)
  if (match) return match[1]
  const plain = version.match(/^(\d+)$/)
  if (plain) return plain[1]
  return ""
}

/**
 * Resolves a human-readable Java label for a Mojang runtime component.
 * Prefers the `release` file (JAVA_VERSION="21.0.7") inside the runtime,
 * falling back to the well-known component→major map.
 */
async function describeJavaRuntime(componentPath: string, component: string): Promise<{ label: string; versionLabel: string }> {
  // Known component mapping first (cheap, exact).
  const mapped = MOJANG_COMPONENT_TO_VERSION[component]
  const mappedLabel = mapped ? `Java ${mapped}` : component
  const mappedVersion = mapped ? `${mapped}.x` : ""

  // Prefer the actual release file when present.
  try {
    const release = await fs.readFile(path.join(componentPath, "release"), "utf-8")
    const versionMatch = release.match(/JAVA_VERSION="([^"]+)"/)
    if (versionMatch) {
      const raw = versionMatch[1]
      const major = majorFromVersion(raw)
      // "1.8.x" → Java 8
      const normalized = raw.startsWith("1.") ? raw.split(".")[1] : major
      if (normalized) {
        return { label: `Java ${normalized}`, versionLabel: raw }
      }
    }
  } catch {
    // no release file — fall through to mapping
  }

  return { label: mappedLabel, versionLabel: mappedVersion }
}

async function scanJavaRuntimes(runtimeRoot: string): Promise<JavaRuntimeEntry[]> {
  const entries: JavaRuntimeEntry[] = []
  if (!(await pathExists(runtimeRoot))) return entries

  // Layout: <gameDir>/runtime/<platformKey>/<component>
  let platformDirs: string[] = []
  try {
    platformDirs = await fs.readdir(runtimeRoot)
  } catch {
    return entries
  }

  for (const platformDir of platformDirs) {
    const platformPath = path.join(runtimeRoot, platformDir)
    const stat = await fs.stat(platformPath).catch(() => null)
    if (!stat?.isDirectory()) continue

    let componentDirs: string[] = []
    try {
      componentDirs = await fs.readdir(platformPath)
    } catch {
      continue
    }

    for (const componentDir of componentDirs) {
      const componentPath = path.join(platformPath, componentDir)
      const componentStat = await fs.stat(componentPath).catch(() => null)
      if (!componentStat?.isDirectory()) continue
      const { label, versionLabel } = await describeJavaRuntime(componentPath, componentDir)
      entries.push({
        path: componentPath,
        component: componentDir,
        size: await getDirectorySize(componentPath),
        label,
        versionLabel,
      })
    }
  }

  return entries.sort((a, b) => b.size - a.size)
}

async function scanServers(): Promise<ServerStorageEntry[]> {
  const servers = await dbHelpers.listMcServers()
  const entries: ServerStorageEntry[] = []

  for (const server of servers) {
    try {
      const serverPath = getMcServerDir(server.id)
      if (!(await pathExists(serverPath))) continue

      const [total, mods, config, logs, world, plugins, cache] = await Promise.all([
        getDirectorySize(serverPath),
        sumSubdirs(serverPath, ["mods"]),
        sumSubdirs(serverPath, ["config", "defaultconfigs", "configs"]),
        sumSubdirs(serverPath, ["logs"]),
        sumSubdirs(serverPath, ["world", "world_nether", "world_the_end", "worlds"]),
        sumSubdirs(serverPath, ["plugins", "dynmap", "datapacks"]),
        sumSubdirs(serverPath, [".cache", "cache", "crash-reports"]),
      ])

      const accounted = mods + config + logs + world + plugins + cache
      entries.push({
        serverId: server.id,
        name: server.name,
        path: serverPath,
        icon: server.icon ?? "",
        gameVersion: server.gameVersion ?? "",
        modLoader: server.modloader ?? "",
        total,
        mods,
        config,
        logs,
        world,
        plugins,
        cache,
        other: Math.max(0, total - accounted),
      })
    } catch (error) {
      console.warn(`[Storage] Failed to scan server "${server.name}":`, error)
    }
  }

  return entries.sort((a, b) => b.total - a.total)
}

async function scanStorage(): Promise<StorageScanResult> {
  const gameDir = await getGameDir()
  const runtimeRoot = path.join(gameDir, "runtime")
  const trashPath = path.join(getInstancesRoot(), "intents", ".trash")

  const [builds, servers, javaEntries, trashSize, gameDirSize] = await Promise.all([
    scanBuilds(),
    scanServers(),
    scanJavaRuntimes(runtimeRoot),
    pathExists(trashPath).then((exists) => (exists ? getDirectorySize(trashPath) : 0)),
    pathExists(gameDir).then((exists) => (exists ? getDirectorySize(gameDir) : 0)),
  ])

  return {
    builds,
    servers,
    trash: { path: trashPath, size: trashSize },
    javaRuntimes: {
      path: runtimeRoot,
      size: javaEntries.reduce((sum, entry) => sum + entry.size, 0),
      entries: javaEntries,
    },
    gameDir: { path: gameDir, size: gameDirSize },
    scannedAt: Date.now(),
  }
}

async function removeContents(dirPath: string): Promise<void> {
  let entries: string[] = []
  try {
    entries = await fs.readdir(dirPath)
  } catch {
    return
  }
  await Promise.all(entries.map((entry) =>
    fs.rm(path.join(dirPath, entry), { recursive: true, force: true }).catch(() => {}),
  ))
}

async function cleanStorage(target: StorageCleanTarget): Promise<StorageCleanResult> {
  try {
    if (target.kind === "trash") {
      const trashPath = path.join(getInstancesRoot(), "intents", ".trash")
      const size = await getDirectorySize(trashPath).catch(() => 0)
      await removeContents(trashPath)
      return { success: true, freedBytes: size }
    }

    if (target.kind === "java-runtime") {
      // Safety: only allow deleting inside <gameDir>/runtime.
      const runtimeRoot = path.join(await getGameDir(), "runtime")
      const resolved = path.resolve(target.path)
      const resolvedRoot = path.resolve(runtimeRoot)
      if (!resolved.startsWith(resolvedRoot + path.sep)) {
        return { success: false, freedBytes: 0, error: "Путь вне директории Java-рантаймов" }
      }
      const size = await getDirectorySize(resolved).catch(() => 0)
      await fs.rm(resolved, { recursive: true, force: true })
      return { success: true, freedBytes: size }
    }

    // Точечное чтение: нужны только id и имя сборки.
    const build = await dbHelpers.findBuildById(target.buildId)
    if (!build) return { success: false, freedBytes: 0, error: "Сборка не найдена" }
    const intentPath = getBuildIntentPath(build.name)

    const dirs =
      target.kind === "build-logs" ? ["logs"]
        : target.kind === "build-crash-reports" ? ["crash-reports"]
          : [".cache", ".fabric", ".quilt"]

    let freed = 0
    for (const dir of dirs) {
      const fullPath = path.join(intentPath, dir)
      freed += await getDirectorySize(fullPath).catch(() => 0)
      await removeContents(fullPath)
    }
    return { success: true, freedBytes: freed }
  } catch (error) {
    return { success: false, freedBytes: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerStorageHandlers(): void {
  ipcMain.handle("storage:scan", async (): Promise<StorageScanResult> => scanStorage())
  ipcMain.handle("storage:clean", async (_event, target: StorageCleanTarget): Promise<StorageCleanResult> => cleanStorage(target))
}
