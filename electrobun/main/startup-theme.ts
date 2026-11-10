import fs from "node:fs"
import path from "node:path"
import { getLauncherDataRoot } from "./paths"

const keys = new Set(["--background", "--foreground", "--primary", "--accent", "--border", "--muted-foreground", "--glow-primary", "--glow-accent"])
const cachePath = () => path.join(getLauncherDataRoot(), "startup-theme.json")
let cached: string | undefined

export function validateStartupTheme(raw: string): string {
  if (typeof raw !== "string" || raw.length > 8192) throw new Error("Invalid startup theme")
  const input = JSON.parse(raw)
  if (!input || !["light", "dark"].includes(input.mode) || !input.colors || typeof input.colors !== "object" || Array.isArray(input.colors)) throw new Error("Invalid startup theme")
  const colors: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.colors)) {
    if (!keys.has(key) || typeof value !== "string" || value.length > 512) throw new Error("Invalid startup color")
    colors[key] = value
  }
  return JSON.stringify({ mode: input.mode, colors })
}

export function readStartupTheme(): string | null {
  if (cached !== undefined) return cached || null
  try { cached = validateStartupTheme(fs.readFileSync(cachePath(), "utf8")) } catch { cached = "" }
  return cached || null
}

export function writeStartupTheme(raw: string): void {
  const value = validateStartupTheme(raw)
  if (value === cached) return
  const file = cachePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, value, "utf8")
  fs.renameSync(`${file}.tmp`, file)
  cached = value
}
