const colors = new Set("background foreground card cardForeground muted mutedForeground border input primary primaryForeground accent accentForeground ring sidebar sidebarForeground sidebarPrimary sidebarPrimaryForeground sidebarAccent sidebarAccentForeground sidebarBorder".split(" "))
const hex = value => typeof value === "string" && /^#[a-f\d]{6}$/i.test(value)
const object = value => value !== null && typeof value === "object" && !Array.isArray(value)
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unsupported event package property")
}
function range(value, min, max) { return value === undefined || typeof value === "number" && Number.isFinite(value) && value >= min && value <= max }

/** Повторная проверка на клиенте: HTTP-хеш подтверждает байты, но не безопасность содержимого. */
export function validatePackage(pkg) {
  keys(pkg, ["format", "version", "theme", "assets"])
  if (pkg.format !== "xneon-event-theme" || pkg.version !== 1 || !Array.isArray(pkg.assets) || pkg.assets.length > 32) throw new Error("Unsupported event package")
  const theme = pkg.theme
  keys(theme, ["name", "description", "primary", "accent", "palette", "glow", "background"])
  if (typeof theme.name !== "string" || !theme.name.trim() || Buffer.byteLength(theme.name) > 160 ||
      !hex(theme.primary) || !hex(theme.accent) || theme.description !== undefined && (typeof theme.description !== "string" || Buffer.byteLength(theme.description) > 1000)) throw new Error("Invalid event theme")
  if (theme.palette !== undefined && (!object(theme.palette) || Object.entries(theme.palette).some(([key, value]) => !colors.has(key) || !hex(value)))) throw new Error("Invalid palette")
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
    if (typeof asset.name !== "string" || !/^[a-z\d][a-z\d._-]{0,90}\.(png|jpg|jpeg|webp|gif)$/i.test(asset.name) ||
        assets.has(asset.name.toLowerCase()) || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.media_type) || typeof asset.data_base64 !== "string") throw new Error("Invalid asset")
    const bytes = Buffer.from(asset.data_base64, "base64")
    if (!bytes.length || bytes.toString("base64") !== asset.data_base64) throw new Error("Invalid base64")
    total += bytes.length
    if (total > 3_000_000) throw new Error("Event assets exceed limit")
    const signature = asset.media_type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : asset.media_type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : asset.media_type === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
    if (!signature) throw new Error("Asset signature mismatch")
    assets.set(asset.name.toLowerCase(), asset)
  }
  if (theme.background !== undefined) {
    const bg = theme.background
    keys(bg, ["kind", "source", "dim", "blur", "opacity", "fit", "particleStyle"])
    if (!range(bg.dim, 0, 1) || !range(bg.blur, 0, 24) || !range(bg.opacity, 0, 1) || bg.fit !== undefined && !["cover", "contain"].includes(bg.fit)) throw new Error("Invalid background")
    if (bg.kind === "image") {
      const asset = typeof bg.source === "string" && bg.source.startsWith("assets/") && assets.get(bg.source.slice(7).toLowerCase())
      if (!asset || asset.name !== bg.source.slice(7)) throw new Error("Missing packaged background")
    } else if (!["particles", "halo"].includes(bg.kind) || bg.source !== "" || bg.kind === "particles" && !["snow", "stars", "network"].includes(bg.particleStyle)) throw new Error("Unsupported background")
  }
  return pkg
}

export function prepareTheme(pkg, eventID) {
  validatePackage(pkg)
  const theme = { ...structuredClone(pkg.theme), id: `event:${eventID}`, custom: false }
  if (theme.background?.kind === "image") {
    const asset = pkg.assets.find(asset => `assets/${asset.name}` === theme.background.source)
    theme.background.source = `data:${asset.media_type};base64,${asset.data_base64}`
  }
  return theme
}
