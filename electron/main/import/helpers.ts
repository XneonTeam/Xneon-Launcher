import path from "path"
import fs from "fs/promises"
import { exec } from "child_process"
import { randomUUID } from "crypto"

export type BufferEncoding = "utf-8" | "utf8" | "cp866" | "cp1251" | string

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

export async function countFilesInDir(dir: string): Promise<number> {
  try {
    if (!(await fileExists(dir))) return 0
    const files = await fs.readdir(dir)
    let count = 0
    for (const f of files) {
      try {
        const stat = await fs.stat(path.join(dir, f))
        if (stat.isFile()) count++
      } catch {}
    }
    return count
  } catch { return 0 }
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

export async function copyEntryRecursive(srcPath: string, destPath: string): Promise<number> {
  try {
    const stat = await fs.stat(srcPath)
    if (stat.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true }).catch(() => {})
      let copied = 0
      let entries
      try { entries = await fs.readdir(srcPath) } catch { return copied }
      for (const entry of entries) {
        copied += await copyEntryRecursive(path.join(srcPath, entry), path.join(destPath, entry))
      }
      return copied
    }

    try { await fs.access(destPath); return 0 } catch {}
    await fs.mkdir(path.dirname(destPath), { recursive: true }).catch(() => {})
    await fs.copyFile(srcPath, destPath)
    return 1
  } catch {
    return 0
  }
}

export async function copyDirContents(srcDirs: string[], destDir: string): Promise<number> {
  if (!srcDirs.length) return 0
  await fs.mkdir(destDir, { recursive: true }).catch(() => {})
  let copied = 0
  for (const srcDir of srcDirs) {
    let entries
    try { entries = await fs.readdir(srcDir) } catch { continue }
    for (const entry of entries) {
      copied += await copyEntryRecursive(path.join(srcDir, entry), path.join(destDir, entry))
    }
  }
  return copied
}

export async function isImportedContentEntry(filePath: string, type: "mod" | "resourcepack" | "shader"): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) return type !== "mod"
    const lowerName = path.basename(filePath).toLowerCase()
    if (type === "mod") return lowerName.endsWith(".jar") || lowerName.endsWith(".zip")
    return lowerName.endsWith(".zip") || lowerName.endsWith(".jar")
  } catch {
    return false
  }
}

export async function buildImportedContentList(dir: string, type: "mod" | "resourcepack" | "shader", source: LauncherInstance["source"]) {
  const items: Array<{ id: string; slug: string; name: string; description: string; version: string }> = []
  if (!(await fileExists(dir))) return items

  let files
  try { files = await fs.readdir(dir) } catch { return items }

  for (const file of files) {
    const filePath = path.join(dir, file)
    if (!(await isImportedContentEntry(filePath, type))) continue
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

export async function readIconAsDataUrl(iconPath: string | undefined): Promise<string> {
  if (!iconPath) return ""
  if (iconPath.startsWith("http://") || iconPath.startsWith("https://")) return iconPath
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
  const candidates = normalizedRaw.startsWith("/")
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
