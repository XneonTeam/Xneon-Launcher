import fs from "node:fs/promises"
import { constants, createReadStream } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { listArchiveEntries, packArchiveBuffer, readArchiveEntries } from "@xnlc/archives"
import type { Theme } from "@xnlc/types"
import { archiveService, type ArchiveServicePackSource } from "../archives/service"

const MAX_TOTAL = 512 * 1024 * 1024
const MAX_MEDIA = 128 * 1024 * 1024
const MAX_ENTRIES = 1024
const extensions = "css|png|jpg|jpeg|webp|gif|avif|bmp|svg|mp4|webm|ogv|ttf|otf|woff2|woff"
const assetName = new RegExp(`^[a-f0-9]{64}\\.(${extensions})$`)
const assetReferences = () => new RegExp(`xnl-theme://asset/([a-f0-9]{64}\\.(?:${extensions}))`, "g")
const themeKeys = ["id", "name", "description", "baseThemeId", "primary", "accent", "primaryOklch", "accentOklch", "palette", "glow", "font", "background", "css", "readerCss", "cssEnabled", "appearance", "custom", "createdAt", "updatedAt"]

/** Манифест берётся из выбранной темы; произвольные пути архива не извлекаются. */
function themeData(value: unknown): Theme {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid theme manifest")
  const data = value as Record<string, unknown>
  if (typeof data.id !== "string" || !data.id || typeof data.name !== "string" || !data.name.trim()) throw new Error("Invalid theme name or ID")
  if (![data.primary, data.accent].every(color => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))) throw new Error("Invalid theme colors")
  for (const key of ["palette", "glow", "font", "background", "appearance"]) if (data[key] !== undefined && (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key]))) throw new Error("Invalid theme property: " + key)
  if (data.css !== undefined && typeof data.css !== "string") throw new Error("Invalid theme CSS")
  if (data.readerCss !== undefined && typeof data.readerCss !== "string") throw new Error("Invalid reader CSS")
  const theme = Object.fromEntries(themeKeys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) as unknown as Theme
  return { ...theme, name: theme.name.trim().slice(0, 60), custom: true }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export function createThemeBundle(input: unknown, mediaDirectory: string): Promise<Buffer>
export function createThemeBundle(input: unknown, mediaDirectory: string, outputPath: string): Promise<void>
export async function createThemeBundle(input: unknown, mediaDirectory: string, outputPath?: string): Promise<Buffer | void> {
  const theme = structuredClone(themeData(input))
  const assets = new Map<string, ArchiveServicePackSource>()
  const replacements = new Map<string, string>()
  let total = 0
  const addAsset = (name: string, source: ArchiveServicePackSource, size: number) => {
    if (assets.has(name)) return
    if (assets.size >= MAX_ENTRIES - 1) throw new Error("Too many theme media files")
    if (size > MAX_MEDIA || total + size > MAX_TOTAL) throw new Error("Theme media exceeds archive size limit")
    total += size; assets.set(name, source)
  }
  // Старые локальные источники становятся переносимыми адресами по хешу.
  const localSource = async (source: string) => {
    if (!source.startsWith("file:") && !path.isAbsolute(source)) return source
    if (replacements.has(source)) return replacements.get(source)!
    const localPath = source.startsWith("file:") ? fileURLToPath(source) : source
    const ext = path.extname(localPath).slice(1).toLowerCase()
    if (!new RegExp(`^(?:${extensions})$`).test(ext)) throw new Error("Unsupported local theme media")
    const size = (await fs.stat(localPath)).size
    if (size > MAX_MEDIA) throw new Error("Theme media exceeds archive size limit")
    const name = `${await hashFile(localPath)}.${ext}`
    addAsset(name, { kind: "file", filePath: localPath, entryName: `assets/${name}` }, size)
    const portable = `xnl-theme://asset/${name}`
    replacements.set(source, portable)
    return portable
  }
  if (typeof theme.font?.source === "string") theme.font.source = await localSource(theme.font.source)
  if (typeof theme.background?.source === "string") {
    const source = theme.background.source
    const embeddedImage = /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/i.exec(source)
    if (embeddedImage) {
      const payload = source.slice(embeddedImage[0].length)
      if (payload.length > Math.ceil(MAX_MEDIA / 3) * 4) throw new Error("Theme media exceeds archive size limit")
      const data = Buffer.from(payload, "base64")
      if (!data.length || data.toString("base64").replace(/=+$/, "") !== payload.replace(/=+$/, "")) {
        throw new Error("Invalid embedded theme image")
      }
      const name = `${createHash("sha256").update(data).digest("hex")}.${embeddedImage[1].toLowerCase()}`
      addAsset(name, { kind: "data", data, entryName: `assets/${name}` }, data.length)
      theme.background.source = `xnl-theme://asset/${name}`
    } else {
      theme.background.source = await localSource(source)
    }
  }
  for (const key of ["css", "readerCss"] as const) {
    const css = theme[key]
    if (!css) continue
    for (const match of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi)) {
      const source = match[1] || match[2] || match[3]
      if (source.startsWith("file:")) await localSource(source)
    }
    let portableCss = css
    for (const [source, portable] of replacements) portableCss = portableCss.replaceAll(source, portable)
    theme[key] = portableCss
  }
  const json = JSON.stringify(theme)
  if (Buffer.byteLength(json) > 1024 * 1024) throw new Error("Theme manifest exceeds size limit")
  const collect = async (text: string) => {
    for (const [, name] of text.matchAll(assetReferences())) {
      if (assets.has(name)) continue
      const file = path.join(mediaDirectory, name)
      const size = (await fs.stat(file)).size
      if (size > MAX_MEDIA) throw new Error("Theme media exceeds archive size limit")
      if (await hashFile(file) !== name.split(".")[0]) throw new Error("Theme media checksum mismatch")
      addAsset(name, { kind: "file", filePath: file, entryName: `assets/${name}` }, size)
      if (name.endsWith(".css")) await collect(await fs.readFile(file, "utf8"))
    }
  }
  await collect(json)
  const manifest = Buffer.from(JSON.stringify({ format: "xneon-theme", version: 1, theme }))
  if (manifest.length > 1024 * 1024) throw new Error("Theme manifest exceeds size limit")
  const sources: ArchiveServicePackSource[] = [
    { kind: "data", entryName: "theme.json", data: manifest },
    ...assets.values(),
  ]
  if (outputPath) {
    await archiveService.pack(sources, outputPath)
    if ((await fs.stat(outputPath)).size > MAX_TOTAL) {
      await fs.rm(outputPath, { force: true })
      throw new Error("Theme archive exceeds size limit")
    }
    return
  }
  // Совместимость для небольших in-memory фикстур; UI и облако передают путь.
  const buffer = await packArchiveBuffer(sources)
  if (buffer.length > MAX_TOTAL) throw new Error("Theme archive exceeds size limit")
  return buffer
}

export async function readThemeBundlePreview(input: string | Uint8Array): Promise<Theme> {
  const manifest = await readThemeManifest(input)
  const theme = themeData(manifest.theme)
  return { id: theme.id, name: theme.name, primary: theme.primary, accent: theme.accent, palette: theme.palette }
}

/** Читает только `theme.json`: остальные записи архива не распаковываются. */
async function readThemeManifest(input: string | Uint8Array): Promise<{ format: string; version: number; theme: unknown }> {
  const entries = await readArchiveEntries(input, ["theme.json"], { maxEntrySize: 1024 * 1024, maxTotalSize: 1024 * 1024 })
  const manifest = entries.get("theme.json")
  if (!manifest) throw new Error("Theme manifest missing or oversized")
  const envelope = JSON.parse(manifest.toString("utf8")) as { format?: unknown; version?: unknown; theme?: unknown }
  if (envelope.format !== "xneon-theme" || envelope.version !== 1) throw new Error("Unsupported theme archive version")
  return envelope as { format: string; version: number; theme: unknown }
}

export async function restoreThemeBundle(input: string | Uint8Array, mediaDirectory: string): Promise<Theme> {
  if ((typeof input === "string" ? (await fs.stat(input)).size : input.byteLength) > MAX_TOTAL) throw new Error("Theme archive exceeds size limit")
  const entries = await listArchiveEntries(input)
  const files = entries.filter((entry) => !entry.directory)
  if (entries.length > MAX_ENTRIES || new Set(files.map((entry) => entry.name)).size !== files.length) {
    throw new Error("Invalid theme archive entries")
  }
  const envelope = await readThemeManifest(input)
  const theme = themeData(envelope.theme)
  const names = new Set<string>()
  let total = 0
  for (const entry of files) {
    if (entry.name === "theme.json") continue
    const name = entry.name.slice("assets/".length)
    if (!entry.name.startsWith("assets/") || !assetName.test(name) || entry.symlink) throw new Error("Invalid theme asset path")
    total += entry.size
    if (entry.size > MAX_MEDIA || total > MAX_TOTAL) throw new Error("Theme archive media exceeds size limit")
    names.add(name)
  }
  for (const [, name] of JSON.stringify(theme).matchAll(assetReferences())) if (!names.has(name)) throw new Error("Theme archive is missing referenced media")
  const temporary = await fs.mkdtemp(path.join(tmpdir(), "xnlc-theme-import-"))
  try {
    await archiveService.extract(input, temporary, {
      stripPrefix: "assets/",
      include: entry => entry.name.startsWith("assets/"),
      maxEntries: MAX_ENTRIES,
      maxTotalSize: MAX_TOTAL,
      symlinks: "error",
    })
    // Сначала проверяем весь набор на диске; только затем меняем профиль.
    for (const name of names) {
      const file = path.join(temporary, name)
      if (await hashFile(file) !== name.split(".")[0]) throw new Error("Theme asset checksum mismatch")
      if (name.endsWith(".css")) {
        for (const [, reference] of (await fs.readFile(file, "utf8")).matchAll(assetReferences())) {
          if (!names.has(reference)) throw new Error("Theme archive is missing CSS media")
        }
      }
    }
    await fs.mkdir(mediaDirectory, { recursive: true })
    for (const name of names) {
      const target = path.join(mediaDirectory, name)
      await fs.copyFile(path.join(temporary, name), target, constants.COPYFILE_EXCL).catch(async (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        if (await hashFile(target) !== name.split(".")[0]) throw new Error("Existing theme asset checksum mismatch")
      })
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
  return theme
}
