import fs from "fs"
import path from "path"

// Folders that are identical across every instance and therefore safe to share
// through a junction/symlink to a single read-only-by-convention cache root.
// They are re-created by @xnlc/core during installation.
const SHARED_GAME_FOLDERS = ["versions", "libraries", "assets"] as const

export function getSharedMinecraftRoot(): string | null {
  return process.env.XNEON_SHARED_MC_DIR || null
}

/**
 * Creates `versions`, `libraries` and `assets` in `gameDir` as links to the
 * shared cache root. If a real directory already exists (e.g. a build imported
 * from Prism/.minecraft), the per-instance folder is left untouched so imported
 * builds keep their own files.
 */
export function ensureSharedGameLinksSync(gameDir: string): void {
  const sharedRoot = getSharedMinecraftRoot()
  if (!sharedRoot) return

  for (const folder of SHARED_GAME_FOLDERS) {
    const targetDir = path.join(sharedRoot, folder)
    try {
      fs.mkdirSync(targetDir, { recursive: true })
    } catch {
      continue
    }

    const linkPath = path.join(gameDir, folder)
    linkDirSync(linkPath, targetDir)
  }
}

function linkDirSync(linkPath: string, targetDir: string): void {
  try {
    const stats = fs.lstatSync(linkPath)
    if (stats.isSymbolicLink()) return
    // A real directory/file exists — keep the per-instance layout.
    return
  } catch {
    // Path does not exist yet — safe to create a link.
  }

  try {
    fs.symlinkSync(targetDir, linkPath, process.platform === "win32" ? "junction" : "dir")
  } catch {
    // Junction creation may fail (privileges, FS without links). Fall back to
    // a plain per-instance directory; @xnlc/core will download into it.
    try {
      fs.mkdirSync(linkPath, { recursive: true })
    } catch {
      // ignore
    }
  }
}

/**
 * Removes previously-created links to the shared cache. Used by imports so an
 * imported instance keeps its own per-instance versions/libraries/assets
 * instead of writing into the shared cache.
 */
export function unlinkSharedGameLinksSync(gameDir: string): void {
  for (const folder of SHARED_GAME_FOLDERS) {
    const linkPath = path.join(gameDir, folder)
    try {
      const stats = fs.lstatSync(linkPath)
      if (stats.isSymbolicLink()) fs.unlinkSync(linkPath)
    } catch {
      // ignore
    }
  }
}
