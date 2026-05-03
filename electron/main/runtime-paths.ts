import { app } from "electron"
import path from "path"
import fs from "fs"

const homeDir = app.getPath("home")
const configDir = path.join(homeDir, ".config", "xneon-launcher")
const cacheDir = path.join(homeDir, ".cache", "xneon-launcher")
const runtimeDir = path.join(cacheDir, "runtime")
const runtimeTempDir = path.join(cacheDir, "temp")

function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {}
  return dir
}

function canUseDir(dir?: string) {
  if (!dir) return false
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function ensureRuntimeDir() {
  return ensureDir(runtimeDir)
}

export function ensureRuntimeTempDir() {
  return ensureDir(runtimeTempDir)
}

export function configureRuntimePaths() {
  const resolvedRuntimeDir = canUseDir(process.env.XDG_RUNTIME_DIR)
    ? process.env.XDG_RUNTIME_DIR!
    : ensureRuntimeDir()
  const resolvedTempDir = ensureRuntimeTempDir()

  process.env.XDG_RUNTIME_DIR = resolvedRuntimeDir
  process.env.TMPDIR = resolvedTempDir
  process.env.TEMP = resolvedTempDir
  process.env.TMP = resolvedTempDir

  try {
    app.setPath("temp", resolvedTempDir)
    app.setPath("sessionData", path.join(configDir, "session"))
  } catch {}
}

export function cleanupRuntimeCaches() {
  const codeCacheDir = path.join(configDir, "Code Cache")
  const shaderCacheDir = path.join(configDir, "Shader Cache")

  for (const cacheDir of [codeCacheDir, shaderCacheDir]) {
    try {
      if (!fs.existsSync(cacheDir)) continue
      for (const entry of fs.readdirSync(cacheDir)) {
        try {
          fs.unlinkSync(path.join(cacheDir, entry))
        } catch {}
      }
    } catch {}
  }
}
