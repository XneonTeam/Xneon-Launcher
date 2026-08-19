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
    if (!entry.name.endsWith(".jar") && !entry.name.endsWith(".zip")) continue

    const name = entry.name.endsWith(".disabled")
      ? entry.name.slice(0, -".disabled".length)
      : entry.name

    files.push({ slug: nextRelativePath, filePath, name, enabled: !entry.name.endsWith(".disabled") })
  }

  return files
}

export async function scanIntentDir(intentPath: string): Promise<ScannedBuildContent> {
  const mods: ImportModEntry[] = []
  const resourcepacks: ImportModEntry[] = []
  const shaders: ImportModEntry[] = []
  const installedMods: Record<string, string> = {}

  const scanDir = async (dir: string, targetArray: ImportModEntry[], targetMap: Record<string, string> | null) => {
    const files = await listIntentContentFiles(dir)
    const resolved = await resolveContentEntries(files.map((file) => file.filePath))

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
      targetArray.push(modEntry)
      if (targetMap !== null) {
        targetMap[slug] = filePath
      }
    }
  }

  await scanDir(path.join(intentPath, "mods"), mods, installedMods)
  await scanDir(path.join(intentPath, "resourcepacks"), resourcepacks, null)
  await scanDir(path.join(intentPath, "shaderpacks"), shaders, null)

  return { mods, resourcepacks, shaders, installedMods }
}