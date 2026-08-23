import path from "path"
import fs from "fs/promises"
import { formatDisplayNameFromFileName } from "./helpers"
import { resolveContentEntries } from "./content-resolver"
import type { ImportModEntry, ScannedBuildContent } from "./helpers"

type IntentContentFile = {
  slug: string
  filePath: string
  name: string
  enabled: boolean
}

async function listIntentContentFiles(dir: string, parentPath = ""): Promise<IntentContentFile[]> {
  try { await fs.access(dir) } catch { return [] }

  const files: IntentContentFile[] = []
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }

  for (const entry of entries) {
    const nextRelativePath = parentPath ? path.posix.join(parentPath, entry.name) : entry.name
    const filePath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...await listIntentContentFiles(filePath, nextRelativePath))
      continue
    }

    if (!entry.isFile()) continue
    if (!/\.(jar|zip)(\.disabled)?$/i.test(entry.name)) continue

    const name = entry.name.endsWith(".disabled")
      ? entry.name.slice(0, -".disabled".length)
      : entry.name
    const slug = parentPath ? path.posix.join(parentPath, name) : name

    files.push({ slug, filePath, name, enabled: !entry.name.endsWith(".disabled") })
  }

  return files
}

export async function scanIntentDir(intentPath: string, onProgress?: (processed: number, total: number) => void): Promise<ScannedBuildContent> {
  const mods: ImportModEntry[] = []
  const resourcepacks: ImportModEntry[] = []
  const shaders: ImportModEntry[] = []
  const installedMods: Record<string, string> = {}

  const dirs = [
    { dir: path.join(intentPath, "mods"), target: mods, map: installedMods },
    { dir: path.join(intentPath, "resourcepacks"), target: resourcepacks, map: null },
    { dir: path.join(intentPath, "shaderpacks"), target: shaders, map: null },
  ]

  const filesByDir = new Map<string, Awaited<ReturnType<typeof listIntentContentFiles>>>()
  let total = 0
  for (const { dir } of dirs) {
    const files = await listIntentContentFiles(dir)
    filesByDir.set(dir, files)
    total += files.length
  }

  let processed = 0
  const report = () => {
    try { onProgress?.(processed, total) } catch {}
  }

  for (const { dir, target, map } of dirs) {
    const files = filesByDir.get(dir) ?? []
    const dirStart = processed
    const resolved = await resolveContentEntries(
      files.map((file) => file.filePath),
      (done) => { processed = Math.min(total, dirStart + done); report() },
    )

    for (const { slug, filePath, name, enabled } of files) {
      const entry = resolved[filePath]
      if (!entry) continue
      const fileName = path.basename(name)
      const modEntry: ImportModEntry = {
        id: entry.sha1,
        slug,
        name: entry.name || formatDisplayNameFromFileName(fileName),
        description: entry.description || "",
        icon_url: entry.icon_url,
        version: entry.version || "local",
        source: entry.source,
        projectId: entry.projectId,
        modId: entry.modId,
        author: entry.author,
        enabled,
      }
      target.push(modEntry)
      if (map !== null) {
        map[slug] = filePath
      }
    }
  }

  onProgress?.(total, total)
  return { mods, resourcepacks, shaders, installedMods }
}
