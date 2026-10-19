import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import AdmZip from "adm-zip"
import type { Theme } from "@xnlc/types"

const MAX_TOTAL = 512 * 1024 * 1024
const MAX_MEDIA = 128 * 1024 * 1024
const MAX_ENTRIES = 1024
const extensions = "png|jpg|jpeg|webp|gif|avif|bmp|svg|mp4|webm|ogv|ttf|otf|woff2|woff"
const assetName = new RegExp(`^[a-f0-9]{64}\\.(${extensions})$`)
const assetReferences = () => new RegExp(`xnl-theme://asset/([a-f0-9]{64}\\.(?:${extensions}))`, "g")
const themeKeys = ["id", "name", "primary", "accent", "primaryOklch", "accentOklch", "palette", "glow", "font", "background", "css", "cssEnabled", "appearance", "custom", "createdAt", "updatedAt"]

/** Манифест берётся из выбранной темы; произвольные пути архива не извлекаются. */
function themeData(value: unknown): Theme {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid theme manifest")
  const data = value as Record<string, unknown>
  if (typeof data.id !== "string" || !data.id || typeof data.name !== "string" || !data.name.trim()) throw new Error("Invalid theme name or ID")
  if (![data.primary, data.accent].every(color => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))) throw new Error("Invalid theme colors")
  for (const key of ["palette", "glow", "font", "background", "appearance"]) if (data[key] !== undefined && (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key]))) throw new Error("Invalid theme property: " + key)
  if (data.css !== undefined && typeof data.css !== "string") throw new Error("Invalid theme CSS")
  const theme = Object.fromEntries(themeKeys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) as unknown as Theme
  return { ...theme, name: theme.name.trim().slice(0, 60), custom: true }
}

export async function createThemeBundle(input: unknown, mediaDirectory: string): Promise<Buffer> {
  const theme = structuredClone(themeData(input))
  const zip = new AdmZip()
  const assets = new Map<string, Buffer>()
  const replacements = new Map<string, string>()
  let total = 0
  const addAsset = (name: string, data: Buffer) => {
    if (assets.has(name)) return
    if (assets.size >= MAX_ENTRIES - 1) throw new Error("Too many theme media files")
    if (data.length > MAX_MEDIA || total + data.length > MAX_TOTAL) throw new Error("Theme media exceeds archive size limit")
    total += data.length; assets.set(name, data)
  }
  // Старые локальные источники становятся переносимыми адресами по хешу.
  const localSource = async (source: string) => {
    if (!source.startsWith("file:") && !path.isAbsolute(source)) return source
    if (replacements.has(source)) return replacements.get(source)!
    const localPath = source.startsWith("file:") ? fileURLToPath(source) : source
    const ext = path.extname(localPath).slice(1).toLowerCase()
    if (!new RegExp(`^(?:${extensions})$`).test(ext)) throw new Error("Unsupported local theme media")
    if ((await fs.stat(localPath)).size > MAX_MEDIA) throw new Error("Theme media exceeds archive size limit")
    const data = await fs.readFile(localPath)
    const name = `${createHash("sha256").update(data).digest("hex")}.${ext}`
    addAsset(name, data)
    const portable = `xnl-theme://asset/${name}`
    replacements.set(source, portable)
    return portable
  }
  if (typeof theme.font?.source === "string") theme.font.source = await localSource(theme.font.source)
  if (typeof theme.background?.source === "string") theme.background.source = await localSource(theme.background.source)
  if (theme.css) {
    for (const match of theme.css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi)) {
      const source = match[1] || match[2] || match[3]
      if (source.startsWith("file:")) await localSource(source)
    }
    for (const [source, portable] of replacements) theme.css = theme.css.replaceAll(source, portable)
  }
  const json = JSON.stringify(theme)
  if (Buffer.byteLength(json) > 1024 * 1024) throw new Error("Theme manifest exceeds size limit")
  for (const [, name] of json.matchAll(assetReferences())) {
    if (assets.has(name)) continue
    const file = path.join(mediaDirectory, name)
    if ((await fs.stat(file)).size > MAX_MEDIA) throw new Error("Theme media exceeds archive size limit")
    const data = await fs.readFile(file)
    if (createHash("sha256").update(data).digest("hex") !== name.split(".")[0]) throw new Error("Theme media checksum mismatch")
    addAsset(name, data)
  }
  const manifest = Buffer.from(JSON.stringify({ format: "xneon-theme", version: 1, theme }))
  if (manifest.length > 1024 * 1024) throw new Error("Theme manifest exceeds size limit")
  zip.addFile("theme.json", manifest)
  for (const [name, data] of assets) zip.addFile(`assets/${name}`, data)
  const buffer = await zip.toBufferPromise()
  if (buffer.length > MAX_TOTAL) throw new Error("Theme archive exceeds size limit")
  return buffer
}

export function readThemeBundlePreview(buffer: Buffer): Theme {
  if (buffer.length > MAX_TOTAL) throw new Error("Theme archive exceeds size limit")
  const zip = new AdmZip(buffer)
  const manifest = zip.getEntry("theme.json")
  if (!manifest || manifest.header.size > 1024 * 1024) throw new Error("Theme manifest missing or oversized")
  const envelope = JSON.parse(manifest.getData().toString("utf8"))
  if (envelope.format !== "xneon-theme" || envelope.version !== 1) throw new Error("Unsupported theme archive version")
  const theme = themeData(envelope.theme)
  return { id: theme.id, name: theme.name, primary: theme.primary, accent: theme.accent, palette: theme.palette }
}

export async function restoreThemeBundle(buffer: Buffer, mediaDirectory: string): Promise<Theme> {
  if (buffer.length > MAX_TOTAL) throw new Error("Theme archive exceeds size limit")
  const zip = new AdmZip(buffer), entries = zip.getEntries()
  if (entries.length > MAX_ENTRIES || new Set(entries.map((entry: { entryName: string }) => entry.entryName)).size !== entries.length) throw new Error("Invalid theme archive entries")
  const manifest = zip.getEntry("theme.json")
  if (!manifest || manifest.header.size > 1024 * 1024) throw new Error("Theme manifest missing or oversized")
  const envelope = JSON.parse(manifest.getData().toString("utf8"))
  if (envelope.format !== "xneon-theme" || envelope.version !== 1) throw new Error("Unsupported theme archive version")
  const theme = themeData(envelope.theme)
  const assets = new Map<string, Buffer>()
  let total = 0
  for (const entry of entries) {
    if (entry.entryName === "theme.json") continue
    const name = entry.entryName.slice("assets/".length)
    if (!entry.entryName.startsWith("assets/") || !assetName.test(name) || entry.isDirectory) throw new Error("Invalid theme asset path")
    total += entry.header.size
    if (entry.header.size > MAX_MEDIA || total > MAX_TOTAL) throw new Error("Theme archive media exceeds size limit")
    const data = entry.getData()
    if (createHash("sha256").update(data).digest("hex") !== name.split(".")[0]) throw new Error("Theme asset checksum mismatch")
    assets.set(name, data)
  }
  for (const [, name] of JSON.stringify(theme).matchAll(assetReferences())) if (!assets.has(name)) throw new Error("Theme archive is missing referenced media")
  await fs.mkdir(mediaDirectory, { recursive: true })
  for (const [name, data] of assets) await fs.writeFile(path.join(mediaDirectory, name), data, { flag: "wx" }).catch(async error => {
    if (error.code !== "EEXIST") throw error
    if (createHash("sha256").update(await fs.readFile(path.join(mediaDirectory, name))).digest("hex") !== name.split(".")[0]) throw new Error("Existing theme asset checksum mismatch")
  })
  return theme
}
