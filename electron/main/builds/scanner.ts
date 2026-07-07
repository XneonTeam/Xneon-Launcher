import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import { readModMetadataFromArchive } from "./metadata"
import { formatDisplayNameFromFileName } from "./helpers"
import type { ImportModEntry, ScannedBuildContent } from "./helpers"

type IntentContentFile = {
  slug: string
  filePath: string
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
    files.push({ slug: nextRelativePath, filePath })
  }

  return files
}

export async function scanIntentDir(intentPath: string): Promise<ScannedBuildContent> {
  const mods: ImportModEntry[] = []
  const resourcepacks: ImportModEntry[] = []
  const shaders: ImportModEntry[] = []
  const installedMods: Record<string, string> = {}

  const scanDir = async (dir: string, targetArray: ImportModEntry[], targetMap: Record<string, string> | null) => {
    for (const { slug, filePath } of await listIntentContentFiles(dir)) {
      try {
        const metadata = await readModMetadataFromArchive(filePath)
        const fileName = path.basename(slug)
        const entry: ImportModEntry = {
          id: crypto.randomUUID(),
          slug,
          name: metadata.name || formatDisplayNameFromFileName(fileName),
          description: metadata.description || "",
          icon_url: metadata.icon_url,
          version: metadata.version || "local",
          source: "local",
          author: metadata.author,
        }
        targetArray.push(entry)
        if (targetMap !== null) {
          targetMap[slug] = filePath
        }
      } catch { /* skip */ }
    }
  }

  await scanDir(path.join(intentPath, "mods"), mods, installedMods)
  await scanDir(path.join(intentPath, "resourcepacks"), resourcepacks, null)
  await scanDir(path.join(intentPath, "shaderpacks"), shaders, null)

  return { mods, resourcepacks, shaders, installedMods }
}
