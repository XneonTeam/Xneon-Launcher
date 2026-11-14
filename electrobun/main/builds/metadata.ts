import fs from "node:fs/promises"
import path from "node:path"
import { analyzeDirectory, inspectJar, probeImage, type ContentMetadata } from "@xnlc/parser"

export type ModMetadata = ContentMetadata

/** Возвращает прежний формат metadata для локального файла или распакованного пака. */
export async function readContentMetadataFromPath(target: string, signal?: AbortSignal): Promise<ModMetadata> {
  signal?.throwIfAborted()
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) return { diagnostics: [{ code: "SCAN_ERROR", message: "Cannot stat content path" }] }
  if (!stat.isDirectory()) {
    const result = await inspectJar(target, { metadata: true, signal })
    return { ...result.metadata, ...(result.diagnostics?.length ? { diagnostics: result.diagnostics } : {}) }
  }
  try {
    const result = await analyzeDirectory(target, { signal })
    const pack = result.mods.find(item => ["resourcepack", "datapack", "hybridpack", "unknownpack", "shaderpack"].includes(item.loader))
    const value = pack?.description
    const description = typeof value === "string" ? value : value && typeof value === "object" ? String((value as { text?: unknown; translate?: unknown }).text ?? (value as { translate?: unknown }).translate ?? "") || undefined : undefined
    const iconPath = pack?.iconPath
    let icon_url: string | undefined
    if (iconPath) {
      try {
        const handle = await fs.open(path.join(target, iconPath), "r")
        try {
          const info = await handle.stat()
          if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error("Icon size limit exceeded")
          const bytes = Buffer.alloc(info.size)
          const { bytesRead } = await handle.read(bytes)
          const { mimeType } = probeImage(bytes.subarray(0, bytesRead))
          icon_url = `data:${mimeType};base64,${bytes.subarray(0, bytesRead).toString("base64")}`
        } finally { await handle.close() }
      } catch (error) { result.diagnostics.push({ code: "INVALID_ICON", source: iconPath, message: String(error) }) }
    }
    signal?.throwIfAborted()
    return { version: pack?.version, description, icon_url, ...(result.diagnostics.length ? { diagnostics: result.diagnostics } : {}) }
  } catch (error) {
    signal?.throwIfAborted()
    return { diagnostics: [{ code: "SCAN_ERROR", message: String(error) }] }
  }
}
