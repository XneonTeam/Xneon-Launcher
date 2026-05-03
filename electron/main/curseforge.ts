// ============================================================
// CurseForge — Re-export cfFetch from @xnlc/mods for backward compat
// Author: MAINER4IK
// ============================================================

let modsModulePromise: Promise<any> | null = null

function loadModsModule(): Promise<any> {
  if (!modsModulePromise) {
    modsModulePromise = import("@xnlc/mods")
  }
  return modsModulePromise
}

export async function cfFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const mods = await loadModsModule()
  return mods.cfFetch(path, params)
}
