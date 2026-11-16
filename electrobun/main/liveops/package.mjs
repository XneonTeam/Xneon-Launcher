import { createHash } from "node:crypto"

const colors = new Set("background foreground card cardForeground muted mutedForeground border input primary primaryForeground accent accentForeground ring sidebar sidebarForeground sidebarPrimary sidebarPrimaryForeground sidebarAccent sidebarAccentForeground sidebarBorder".split(" "))
const media = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/avif", "image/bmp", "text/css", "font/ttf", "font/otf", "font/woff", "font/woff2", "video/mp4", "video/webm", "video/ogg"])
const external = source => { try { const url = new URL(source); return url.protocol === "https:" && !url.username && !url.password } catch { return false } }
const hex = value => typeof value === "string" && /^#[a-f\d]{6}$/i.test(value)
const object = value => value !== null && typeof value === "object" && !Array.isArray(value)
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unsupported event package property")
}
function range(value, min, max) { return value === undefined || typeof value === "number" && Number.isFinite(value) && value >= min && value <= max }

/** Проверка формата/лимитов. CSS, как у Custom Themes, — доверенный контент издателя, не песочница. */
export function validatePackage(pkg) {
  keys(pkg, ["format", "version", "theme", "assets"])
  if (pkg.format !== "xneon-event-theme" || pkg.version !== 1 || !Array.isArray(pkg.assets) || pkg.assets.length > 32) throw new Error("Unsupported event package")
  const theme = pkg.theme
  keys(theme, ["id", "name", "description", "baseThemeId", "primary", "accent", "primaryOklch", "accentOklch", "palette", "glow", "font", "background", "css", "readerCss", "cssEnabled", "appearance", "custom", "createdAt", "updatedAt"])
  if (typeof theme.name !== "string" || !theme.name.trim() || Buffer.byteLength(theme.name) > 160 ||
      !hex(theme.primary) || !hex(theme.accent) || theme.description !== undefined && (typeof theme.description !== "string" || Buffer.byteLength(theme.description) > 1000)) throw new Error("Invalid event theme")
  if (theme.palette !== undefined && (!object(theme.palette) || Object.entries(theme.palette).some(([key, value]) => !colors.has(key) || !hex(value)))) throw new Error("Invalid palette")
  for (const key of ["css", "readerCss"]) if (theme[key] !== undefined && (typeof theme[key] !== "string" || Buffer.byteLength(theme[key]) > 1_000_000)) throw new Error("Invalid or oversized theme CSS")
  if (theme.cssEnabled !== undefined && typeof theme.cssEnabled !== "boolean") throw new Error("Invalid CSS setting")
  if (theme.appearance !== undefined && !object(theme.appearance)) throw new Error("Invalid theme appearance")
  if (theme.glow !== undefined) {
    keys(theme.glow, ["primary", "accent"])
    for (const glow of Object.values(theme.glow)) {
      keys(glow, ["color", "alpha"])
      if (!hex(glow.color) || typeof glow.alpha !== "number" || !range(glow.alpha, 0, 1)) throw new Error("Invalid glow")
    }
  }
  const assets = new Map()
  let total = 0
  for (const asset of pkg.assets) {
    keys(asset, ["name", "media_type", "data_base64"])
    if (typeof asset.name !== "string" || !/^[a-z\d][a-z\d._-]{0,90}\.(png|jpg|jpeg|webp|gif|avif|bmp|svg|css|mp4|webm|ogv|ttf|otf|woff2|woff)$/i.test(asset.name) ||
        assets.has(asset.name.toLowerCase()) || !media.has(asset.media_type) || typeof asset.data_base64 !== "string") throw new Error("Invalid asset")
    const bytes = Buffer.from(asset.data_base64, "base64")
    if (!bytes.length || bytes.toString("base64") !== asset.data_base64) throw new Error("Invalid base64")
    const digest = /^([a-f0-9]{64})\./.exec(asset.name)?.[1]
    if (digest && createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error("Theme asset checksum mismatch")
    total += bytes.length
    if (total > 3_000_000) throw new Error("Event assets exceed limit")
    const signature = asset.media_type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : asset.media_type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : asset.media_type === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
      : asset.media_type === "image/webp" ? bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
      : true
    if (!signature) throw new Error("Asset signature mismatch")
    assets.set(asset.name.toLowerCase(), asset)
  }
  if (theme.background !== undefined) {
    const bg = theme.background
    keys(bg, ["kind", "source", "dim", "blur", "opacity", "fit", "particleStyle", "volume"])
    if (!range(bg.dim, 0, 1) || !range(bg.blur, 0, 24) || !range(bg.opacity, 0, 1) || !range(bg.volume, 0, 1) || bg.fit !== undefined && !["cover", "contain"].includes(bg.fit)) throw new Error("Invalid background")
    if (bg.kind === "image" || bg.kind === "video") {
      const name = typeof bg.source === "string" ? bg.source.replace(/^(?:assets\/|xnl-theme:\/\/asset\/)/, "") : ""
      const asset = assets.get(name.toLowerCase())
      if (!external(bg.source) && (!/^(?:assets\/|xnl-theme:\/\/asset\/)/.test(bg.source) || !asset || asset.name !== name)) throw new Error("Missing packaged background or invalid HTTPS URL")
    } else if (!["particles", "halo"].includes(bg.kind) || bg.source !== "" || bg.kind === "particles" && !["snow", "stars", "network"].includes(bg.particleStyle)) throw new Error("Unsupported background")
  }
  if (theme.font !== undefined) {
    keys(theme.font, ["family", "size", "source"])
    const { family, size, source } = theme.font
    if (family !== undefined && typeof family !== "string" || !range(size, 8, 32)) throw new Error("Invalid font")
    if (source !== undefined && source !== "" && (!external(source) && (typeof source !== "string" || !/^(?:assets\/|xnl-theme:\/\/asset\/)/.test(source) || !assets.has(source.replace(/^(?:assets\/|xnl-theme:\/\/asset\/)/, "").toLowerCase())))) throw new Error("Invalid font source")
  }
  return pkg
}

export function prepareTheme(pkg, eventID) {
  validatePackage(pkg)
  const theme = { ...structuredClone(pkg.theme), id: `event:${eventID}`, custom: false }
  // Ресурсы .xntheme остаются в отдельном event-cache, без записи в библиотеку пользователя.
  const assets = new Map(pkg.assets.map(asset => [asset.name, asset]))
  const resolved = new Map(), visiting = new Set()
  let expanded = 0
  const resource = source => {
    if (!/^(?:assets\/|xnl-theme:\/\/asset\/)/.test(source)) return source
    const name = source.replace(/^(?:assets\/|xnl-theme:\/\/asset\/)/, "")
    if (resolved.has(name)) return resolved.get(name)
    const asset = assets.get(name)
    if (!asset || visiting.has(name)) throw new Error("Missing or cyclic theme resource")
    visiting.add(name)
    let data = asset.data_base64
    if (asset.media_type === "text/css") data = Buffer.from(css(Buffer.from(data, "base64").toString("utf8"))).toString("base64")
    visiting.delete(name)
    const result = `data:${asset.media_type};base64,${data}`
    resolved.set(name, result)
    return result
  }
  const css = text => text.replace(/xnl-theme:\/\/asset\/[a-z\d._-]+|(?<=["'(\s])assets\/[a-z\d._-]+/gi, source => {
    const result = resource(source)
    if ((expanded += result.length) > 8_000_000) throw new Error("Expanded theme CSS exceeds size limit")
    return result
  })
  if (theme.background?.source) theme.background.source = resource(theme.background.source)
  if (theme.font?.source) theme.font.source = resource(theme.font.source)
  for (const key of ["css", "readerCss"]) if (theme[key]) theme[key] = css(theme[key])
  return theme
}
