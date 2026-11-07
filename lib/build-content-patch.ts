type Content = { mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; installedMods?: Record<string, string> }

/** Незагруженный контент никогда не является изменением для БД. */
export function buildContentPatch(current: Content, saved: Content | undefined, loaded: boolean): Record<string, unknown> {
  if (!loaded) return {}
  const patch: Record<string, unknown> = {}
  for (const key of ["mods", "resourcepacks", "shaders"] as const) {
    if (!saved || saved[key] !== current[key]) {
      patch[key] = current[key]
      patch[`${key}Count`] = current[key].length
    }
  }
  if (!saved || saved.installedMods !== current.installedMods) {
    patch.installedMods = current.installedMods ?? {}
    patch.modsCount = current.mods.length
  }
  return patch
}
