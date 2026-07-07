import { app } from "electron"
import path from "path"
import fs from "fs/promises"
import { constants } from "fs"

const homeDir = app.getPath("home")
const configDir = path.join(homeDir, ".config", "xneon-launcher")
const cacheDir = path.join(homeDir, ".cache", "xneon-launcher")
const runtimeDir = path.join(cacheDir, "runtime")
const runtimeTempDir = path.join(cacheDir, "temp")

async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  } catch {}
  return dir
}

async function canUseDir(dir?: string) {
  if (!dir) return false
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    await fs.access(dir, constants.R_OK | constants.W_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function ensureRuntimeDir() {
  return ensureDir(runtimeDir)
}

export async function ensureRuntimeTempDir() {
  return ensureDir(runtimeTempDir)
}

export async function configureRuntimePaths() {
  const resolvedRuntimeDir = (await canUseDir(process.env.XDG_RUNTIME_DIR))
    ? process.env.XDG_RUNTIME_DIR!
    : await ensureRuntimeDir()
  const resolvedTempDir = await ensureRuntimeTempDir()

  process.env.XDG_RUNTIME_DIR = resolvedRuntimeDir
  process.env.TMPDIR = resolvedTempDir
  process.env.TEMP = resolvedTempDir
  process.env.TMP = resolvedTempDir

  try {
    app.setPath("temp", resolvedTempDir)
    app.setPath("sessionData", path.join(configDir, "session"))
  } catch {}
}

export async function cleanupRuntimeCaches() {
  const codeCacheDir = path.join(configDir, "Code Cache")
  const shaderCacheDir = path.join(configDir, "Shader Cache")

  for (const cacheDir of [codeCacheDir, shaderCacheDir]) {
    try {
      let entries
      try { entries = await fs.readdir(cacheDir) } catch { continue }
      for (const entry of entries) {
        try {
          await fs.unlink(path.join(cacheDir, entry))
        } catch {}
      }
    } catch {}
  }
}
