import { ShareError, type Manifest, type ContentEntry, type HashPort } from "./types.js"
import { validateLaunchSettings } from "./launch-settings.js"

export const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024
export const DEFAULT_EXCLUSIONS = ["logs", "crash-reports", "cache", "local", "natives", "saves", "screenshots", "assets", "libraries", "versions", "runtime", ".xnlc-share", "options.txt", "servers.dat", "launcher_accounts.json"]
const hashPattern = /^[a-f0-9]{64}$/
export function fail(code: string, message: string): never { throw new ShareError(code, message) }
export function normalizePath(value: string): string {
  if (typeof value !== "string" || value.length > 240 || /[\x00-\x1f\x7f:]/.test(value)) fail("PATH", "Invalid relative path")
  const normalized = value.replace(/\\/g, "/")
  if (normalized.startsWith("/") || normalized.split("/").some(p => !p || p === "." || p === ".." || /[. ]$/.test(p) || /[<>"|?*]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) fail("PATH", "Unsafe relative path")
  return normalized
}
export function excluded(path: string, rules: string[] = []): boolean {
  const lower = normalizePath(path).toLowerCase()
  if (lower.split("/").some(p => p.startsWith(".") || /(?:token|password|credential|secret)/i.test(p))) return true
  if (/\.(exe|dll|msi|bat|cmd|ps1|sh|com|scr|lnk|vbs|js|mjs|node|so|dylib)$/i.test(lower)) return true
  return [...DEFAULT_EXCLUSIONS, ...rules].some(rule => lower === rule.toLowerCase() || lower.startsWith(rule.toLowerCase() + "/"))
}
export function validateExternal(path: string, bytes: Uint8Array): void {
  if (excluded(path) || bytes.length > MAX_FILE_BYTES) fail("FILE_POLICY", "External file is excluded or too large")
  const head = Array.from(bytes.slice(0, 4)).map(x => x.toString(16).padStart(2, "0")).join("")
  if (head.startsWith("4d5a") || head === "7f454c46" || ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(head) || head.startsWith("2321")) fail("FILE_POLICY", "Executable content is forbidden")
  // Неизвестные бинарные форматы не публикуются: переименование EXE не меняет проверку содержимого.
  const extension = path.replace(/\.disabled$/i, "").split(".").pop()?.toLowerCase()
  if (["json", "json5", "jexl", "toml", "yaml", "yml", "cfg", "conf", "properties", "txt", "xml"].includes(extension ?? "")) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { fail("FILE_POLICY", "Text file must contain UTF-8") }
    if (bytes.includes(0)) fail("FILE_POLICY", "Binary content in text file")
  } else if (extension === "png" && head === "89504e47") return
  else if (["jar", "zip"].includes(extension ?? "") && head === "504b0304") return
  else fail("FILE_POLICY", "Unsupported external content format")
}
export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`
}
export function validateManifest(input: unknown): Manifest {
  if (!input || typeof input !== "object") fail("SCHEMA", "Manifest must be an object")
  const m = input as Manifest
  if (m.schemaVersion !== 1) fail("SCHEMA_VERSION", "Unsupported manifest schema version")
  if (!m.instance || Object.keys(m.instance).filter(key => !["icon", "coverImage", "launchSettings"].includes(key)).sort().join(",") !== "description,gameVersion,loader,loaderVersion,name") fail("SCHEMA", "Invalid instance metadata")
  for (const [key, value] of Object.entries(m.instance)) if (key !== "launchSettings" && (typeof value !== "string" || value.length > (key === "icon" || key === "coverImage" ? 2 * 1024 * 1024 : key === "description" ? 4000 : 200))) fail("SCHEMA", "Invalid metadata value")
  if (m.instance.launchSettings !== undefined) validateLaunchSettings(m.instance.launchSettings)
  for (const image of [m.instance.icon, m.instance.coverImage]) if (image && !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml|avif|x-icon|bmp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) && !/^\.\/launcher-icons\/xneon_logo_(?:0[1-9]|10)\.svg$/.test(image)) {
    try {
      const url = new URL(image)
      if (url.protocol !== "https:" || url.username || url.password || image.length > 4096) fail("SCHEMA", "Invalid instance icon")
    } catch { fail("SCHEMA", "Invalid instance icon") }
  }
  if (!m.instance.name.trim() || !m.instance.gameVersion || !m.instance.loader) fail("SCHEMA", "Missing instance metadata")
  if (!/^[a-zA-Z0-9._+-]{1,100}$/.test(m.instance.gameVersion) || !["vanilla", "fabric", "forge", "neoforge", "quilt"].includes(m.instance.loader) || !/^[a-zA-Z0-9._+-]{0,100}$/.test(m.instance.loaderVersion)) fail("SCHEMA", "Invalid game or loader version")
  if (!Array.isArray(m.entries) || m.entries.length > 10000 || !Array.isArray(m.exclusions) || m.exclusions.length > 100) fail("SCHEMA", "Invalid entries or exclusions")
  const exclusions = [...new Set(m.exclusions.map(normalizePath))].sort()
  const paths = new Set<string>()
  let bytes = 0
  const entries: ContentEntry[] = m.entries.map(e => {
    if (!e || typeof e !== "object") fail("SCHEMA", "Invalid entry")
    const path = normalizePath(e.path)
    const key = path.toLowerCase()
    if (excluded(path, exclusions) || paths.has(key)) fail("PATH", "Excluded or duplicate path")
    paths.add(key)
    if (!hashPattern.test(e.sha256) || !Number.isSafeInteger(e.size) || e.size < 0 || e.size > MAX_TOTAL_BYTES || typeof e.enabled !== "boolean" || !["mod", "resourcepack", "shader", "config", "external"].includes(e.kind)) fail("SCHEMA", "Invalid file metadata")
    bytes += e.size
    if (e.source) {
      if (e.object || !e.source || Object.keys(e.source).sort().join(",") !== "fileId,projectId,provider,versionId" || Object.values(e.source).some(v => typeof v !== "string" || !/^[a-zA-Z0-9_.-]{1,160}$/.test(v))) fail("SCHEMA", "Invalid source reference")
    } else if (e.object !== e.sha256 || e.size > MAX_FILE_BYTES) fail("SCHEMA", "Invalid external object reference")
    return { path, kind: e.kind, sha256: e.sha256, size: e.size, enabled: e.enabled, ...(e.source ? { source: { ...e.source } } : { object: e.sha256 }) }
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (bytes > MAX_TOTAL_BYTES) fail("QUOTA", "Instance is too large")
  for (const path of paths) for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) if (paths.has(path.slice(0, i))) fail("PATH", "File/directory collision")
  return { schemaVersion: 1, instance: { ...m.instance, ...(m.instance.launchSettings ? { launchSettings: validateLaunchSettings(m.instance.launchSettings) } : {}) }, entries, exclusions }
}
export async function manifestHash(manifest: Manifest, hash: HashPort): Promise<string> {
  return hash.digest(new TextEncoder().encode(stable(validateManifest(manifest))))
}
