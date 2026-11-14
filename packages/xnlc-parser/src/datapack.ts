import { lstat, readdir } from "node:fs/promises"
import { join } from "node:path"
import { ArchiveContext, ParserError, type ArchiveOptions } from "./archive.js"
import { analyzeDirectory } from "./directory.js"
import { analyzeOpen, type PackFormat, type ParserDiagnostic, type ParserResult } from "./metadata.js"

export interface DatapackMetadata {
  /** Тип определяется по содержимому, а не по номеру pack_format. */
  format: PackFormat
  packFormat?: number
  description?: unknown
  supportedFormats?: unknown
  minFormat?: unknown
  maxFormat?: unknown
  overlays?: unknown
  features?: unknown
  namespaces: string[]
  iconPath?: string
  diagnostics: ParserDiagnostic[]
  raw: Record<string, unknown>
}

/** Анализирует корневой pack.mcmeta и пространства имён ZIP или папки датапака. */
export async function analyzeDatapack(input: string | Uint8Array, options: ArchiveOptions = {}): Promise<DatapackMetadata> {
  options.signal?.throwIfAborted()
  const stat = typeof input === "string" ? await lstat(input).catch(() => null) : null
  let result: ParserResult
  let namespaces: string[]
  if (typeof input === "string" && stat?.isDirectory() && !stat.isSymbolicLink()) {
    result = await analyzeDirectory(input, options)
    const dataPath = join(input, "data")
    const dataStat = await lstat(dataPath).catch(() => null)
    const entries = dataStat?.isDirectory() && !dataStat.isSymbolicLink() ? await readdir(dataPath, { withFileTypes: true }) : []
    namespaces = entries.filter(entry => entry.isDirectory() && /^[a-z0-9_.-]+$/.test(entry.name)).map(entry => entry.name)
  } else {
    const archive = await ArchiveContext.open(input, options)
    try {
      result = await analyzeOpen(archive, options)
      namespaces = archive.entries().flatMap(entry => {
        const match = /^data\/([a-z0-9_.-]+)\//.exec(entry.name)
        return match ? [match[1]] : []
      })
    } finally { archive.close() }
  }
  options.signal?.throwIfAborted()
  const pack = result.mods.find(item => ["datapack", "hybridpack", "resourcepack", "unknownpack"].includes(item.loader))
  const raw = pack?.raw
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ParserError("INVALID_ARCHIVE", "Datapack requires valid pack.mcmeta at archive root")
  const root = raw as Record<string, unknown>
  if (!root.pack || typeof root.pack !== "object" || Array.isArray(root.pack)) throw new ParserError("INVALID_ARCHIVE", "Invalid pack.mcmeta pack section")
  const data = root.pack as Record<string, unknown>
  return {
    format: pack!.loader as PackFormat,
    packFormat: typeof data.pack_format === "number" && Number.isSafeInteger(data.pack_format) ? data.pack_format : undefined,
    description: data.description,
    supportedFormats: data.supported_formats,
    minFormat: data.min_format,
    maxFormat: data.max_format,
    overlays: root.overlays,
    features: root.features,
    namespaces: [...new Set(namespaces)].sort(),
    iconPath: pack!.iconPath,
    diagnostics: result.diagnostics,
    raw: root,
  }
}
