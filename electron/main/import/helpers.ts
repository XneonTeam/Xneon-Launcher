import path from "path"
import fs from "fs/promises"
import { exec } from "child_process"
import Database from "better-sqlite3"

export type BufferEncoding = "utf-8" | "utf8" | "cp866" | "cp1251" | string

/**
 * Общий скелет обхода инстансов другого лаунчера: пройти по каталогам, взять
 * только подкаталоги, прочитать каждый и отсортировать по имени.
 *
 * До этого одинаковый цикл (readdir → filter(isDirectory) → readInstance →
 * push → sort) был скопирован в импортёрах GDLauncher, MultiMC-подобных,
 * Modrinth App и XLauncher — с мелкими расхождениями в обработке ошибок.
 */
export async function discoverInstancesFromDirs<T extends { name: string }>(
  dirs: string[],
  readInstance: (instanceDir: string) => Promise<T | null>,
): Promise<T[]> {
  const found: T[] = []
  for (const instancesDir of dirs) {
    let entries
    try { entries = await fs.readdir(instancesDir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const instance = await readInstance(path.join(instancesDir, entry.name))
      if (instance) found.push(instance)
    }
  }
  // Единый порядок для всех источников импорта: по имени, в русской локали.
  return found.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

export function execAsync(cmd: string, options?: { timeout?: number; encoding?: BufferEncoding; maxBuffer?: number }): Promise<{ stdout: string; stderr: string }> {
  const outputEncoding = options?.encoding
  return new Promise((resolve, reject) => {
    exec(cmd, { ...options, encoding: "buffer" } as import("child_process").ExecOptions, (error, stdout, stderr) => {
      if (error) reject(error)
      else {
        const decode = (buf: Buffer) => outputEncoding ? new TextDecoder(outputEncoding).decode(buf) : buf.toString("utf-8")
        resolve({ stdout: decode(stdout as Buffer), stderr: decode(stderr as Buffer) })
      }
    })
  })
}

export function isSupportedImportedLoader(modLoader: string): boolean {
  return !!modLoader
}

export type LauncherInstance = {
  id: string
  name: string
  version: string
  modLoader: string
  loaderVersion?: string
  icon?: string
  path: string
  source: "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher" | "modrinthapp"
  modCount?: number
  resourcepackCount?: number
  shaderCount?: number
}

export async function fileExists(fp: string): Promise<boolean> {
  try { await fs.access(fp); return true } catch { return false }
}

export function uniqPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((item) => path.normalize(item))))
}

export async function getInstanceContentDirs(instancePath: string, contentDirName: "mods" | "resourcepacks" | "shaderpacks"): Promise<string[]> {
  const dotMc = path.join(instancePath, ".minecraft")
  const mc = path.join(instancePath, "minecraft")
  const gdInstance = path.join(instancePath, "instance")
  const candidates = uniqPaths([
    path.join(await resolveMcDir(instancePath), contentDirName),
    path.join(dotMc, contentDirName),
    path.join(mc, contentDirName),
    path.join(gdInstance, contentDirName),
    path.join(instancePath, contentDirName),
  ])
  const results: string[] = []
  for (const dir of candidates) {
    if (await fileExists(dir)) results.push(dir)
  }
  return results
}

export async function countFilesInDirs(dirs: string[]): Promise<number> {
  const entries = new Set<string>()
  const collectFiles = async (dir: string, parentPath = "") => {
    let dirEntries
    try { dirEntries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of dirEntries) {
      const relativePath = parentPath ? path.posix.join(parentPath, entry.name) : entry.name
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await collectFiles(filePath, relativePath)
        continue
      }
      if (entry.isFile()) {
        entries.add(relativePath)
      }
    }
  }
  for (const dir of dirs) {
    try {
      await collectFiles(dir)
    } catch {}
  }
  return entries.size
}

export async function copyEntryRecursive(srcPath: string, destPath: string, onCopy?: (copied: number) => void): Promise<number> {
  try {
    const stat = await fs.stat(srcPath)
    if (stat.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true }).catch(() => {})
      let copied = 0
      let entries
      try { entries = await fs.readdir(srcPath) } catch { return copied }
      for (const entry of entries) {
        copied += await copyEntryRecursive(path.join(srcPath, entry), path.join(destPath, entry), onCopy)
      }
      return copied
    }

    try { await fs.access(destPath); return 0 } catch {}
    await fs.mkdir(path.dirname(destPath), { recursive: true }).catch(() => {})
    await fs.copyFile(srcPath, destPath)
    onCopy?.(1)
    return 1
  } catch {
    return 0
  }
}

export async function copyDirContents(srcDirs: string[], destDir: string, onCopy?: (copied: number, total: number) => void): Promise<number> {
  if (!srcDirs.length) return 0
  await fs.mkdir(destDir, { recursive: true }).catch(() => {})
  let total = 0
  let copied = 0
  for (const srcDir of srcDirs) {
    if (!(await fileExists(srcDir))) continue
    total += await countFilesInDirs([srcDir])
  }
  for (const srcDir of srcDirs) {
    let entries
    try { entries = await fs.readdir(srcDir) } catch { continue }
    for (const entry of entries) {
      await copyEntryRecursive(path.join(srcDir, entry), path.join(destDir, entry), () => {
        copied++
        try { onCopy?.(copied, total) } catch {}
      })
    }
  }
  return copied
}

export async function readIconAsDataUrl(iconPath: string | undefined): Promise<string> {
  if (!iconPath) return ""
  if (iconPath.startsWith("data:") || iconPath.startsWith("http://") || iconPath.startsWith("https://")) return iconPath
  if (!(await fileExists(iconPath))) return ""
  try {
    const ext = path.extname(iconPath).toLowerCase()
    const mimeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
      ".bmp": "image/bmp", ".ico": "image/x-icon",
    }
    const mime = mimeMap[ext] || "image/png"
    const data = await fs.readFile(iconPath)
    return `data:${mime};base64,${data.toString("base64")}`
  } catch { return "" }
}

export async function resolveMcDir(instancePath: string): Promise<string> {
  const gdInstance = path.join(instancePath, "instance")
  if (await fileExists(gdInstance)) return gdInstance
  const dotMc = path.join(instancePath, ".minecraft")
  if (await fileExists(dotMc)) return dotMc
  const mc = path.join(instancePath, "minecraft")
  if (await fileExists(mc)) return mc
  return instancePath
}

async function resolveInstanceIconPath(iconPath: string | null | undefined, searchRoots: string[]): Promise<string | undefined> {
  const raw = iconPath?.trim()
  if (!raw) return undefined
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) return raw

  const normalizedRaw = raw.startsWith("file://") ? raw.slice("file://".length) : raw
  const candidates = path.isAbsolute(normalizedRaw)
    ? [normalizedRaw]
    : searchRoots.flatMap((root) => [
      path.join(root, normalizedRaw),
      path.join(root, path.basename(normalizedRaw)),
    ])

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}

export { resolveInstanceIconPath }

/**
 * Чтение чужой SQLite-базы (Modrinth App / AstralRinth `app.db`) в режиме только
 * для чтения: файл не наш, поэтому его нельзя ни пересоздавать, ни оставлять
 * рядом WAL/SHM. Соединение открывается на время запроса и сразу закрывается,
 * чтобы не держать дескриптор на чужой файл.
 */
export async function readSqliteDb<T>(dbPath: string, query: string, mapRow: (row: unknown[]) => T): Promise<T[]> {
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db.prepare(query).raw(true).all() as unknown[][]
    return rows.map((row) => mapRow(row))
  } catch {
    return []
  } finally {
    try {
      db?.close()
    } catch {}
  }
}
