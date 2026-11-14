import { lstat, open } from "node:fs/promises"
import { constants } from "node:fs"
import { join } from "node:path"
import { ParserError, type ArchiveOptions } from "./archive.js"
import { checkMetadataShape, classifyPack } from "./metadata.js"
import type { Format, ModMetadata, ParserDiagnostic, ParserResult } from "./metadata.js"

/** Чтение распакованного ресурспака или шейдерпака без обхода дерева каталогов. */
export async function analyzeDirectory(path: string, options: ArchiveOptions = {}): Promise<ParserResult> {
  const check = () => { if (options.signal?.aborted) throw new ParserError("ABORTED", "Operation aborted") }
  check()
  const root = await lstat(path).catch(() => null)
  if (!root?.isDirectory() || root.isSymbolicLink()) throw new ParserError("IO_ERROR", "Directory does not exist or is a symbolic link")
  const max = options.limits?.maxMetadataSize ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(max) || max < 0 || max > 64 * 1024 * 1024) throw new ParserError("LIMIT_EXCEEDED", "Invalid metadata limit")
  const formats: Format[] = [], mods: ModMetadata[] = [], diagnostics: ParserDiagnostic[] = []
  const packPath = join(path, "pack.mcmeta")
  const pack = await lstat(packPath).catch(() => null)
  if (pack?.isFile() && !pack.isSymbolicLink()) {
    const [assets, data] = await Promise.all(["assets", "data"].map(async name => (await lstat(join(path, name)).catch(() => null))?.isDirectory() === true))
    const loader = classifyPack(assets, data)
    formats.push(loader)
    try {
      if (pack.size > max) throw new ParserError("LIMIT_EXCEEDED", "Metadata size limit exceeded")
      const flags = process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW
      const handle = await open(packPath, flags)
      let data: Uint8Array
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.size !== pack.size || opened.mtimeMs !== pack.mtimeMs || opened.ctimeMs !== pack.ctimeMs) throw new ParserError("IO_ERROR", "Metadata changed while opening")
        const buffer = new Uint8Array(Math.min(pack.size + 1, max + 1))
        let offset = 0
        while (offset < buffer.length) {
          check()
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
          if (!bytesRead) break
          offset += bytesRead
        }
        if (offset > max) throw new ParserError("LIMIT_EXCEEDED", "Metadata size limit exceeded")
        const after = await handle.stat()
        if (offset !== pack.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new ParserError("IO_ERROR", "Metadata changed while reading")
        data = buffer.subarray(0, offset)
      } finally { await handle.close() }
      const raw = checkMetadataShape(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^\uFEFF/, "")))
      const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
      const p = r.pack && typeof r.pack === "object" ? r.pack as Record<string, unknown> : {}
      const icon = await lstat(join(path, "pack.png")).catch(() => null)
      mods.push({ loader, version: typeof p.pack_format === "number" && Number.isSafeInteger(p.pack_format) ? String(p.pack_format) : undefined, description: p.description, authors: [], iconPath: icon?.isFile() && !icon.isSymbolicLink() ? "pack.png" : undefined, raw, dependencies: [] })
    } catch (error) {
      if (error instanceof ParserError && error.code === "ABORTED") throw error
      diagnostics.push({ code: error instanceof ParserError ? error.code : "INVALID_METADATA", source: "pack.mcmeta", message: error instanceof Error ? error.message : "Invalid metadata" })
    }
  }
  check()
  const shaders = await lstat(join(path, "shaders")).catch(() => null)
  if (shaders?.isDirectory() && !shaders.isSymbolicLink()) {
    formats.push("shaderpack")
    const icon = await lstat(join(path, "shaders", "shaders.png")).catch(() => null)
    mods.push({ loader: "shaderpack", authors: [], iconPath: icon?.isFile() && !icon.isSymbolicLink() ? "shaders/shaders.png" : undefined, raw: null, dependencies: [] })
  }
  check()
  return { formats, mods, dependencies: [], diagnostics, embeddedJars: [], completeness: { metadata: mods.length > 0 && mods.every(mod => !!mod.version && mod.loader !== "unknownpack") && diagnostics.length === 0 && !formats.includes("shaderpack"), dependencies: false, embeddedJars: true, classes: false } }
}
