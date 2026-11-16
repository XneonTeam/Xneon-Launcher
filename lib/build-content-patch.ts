type Content = { mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; installedMods?: Record<string, string> }
export const CONTENT_PATCH_FIELDS = new Set(["mods", "resourcepacks", "shaders", "installedMods", "modsCount", "resourcepacksCount", "shadersCount"])
/** Общая политика владения Main/Renderer; пользовательские настройки сюда не входят. */
export const PACK_METADATA_FIELDS = ["version", "modLoader", "loaderVersion", "customVersionPath", "source", "projectSlug", "modId", "fileId", "modpackVersion", "modpackVersionId",
  "mods", "resourcepacks", "shaders", "installedMods", "modsCount", "resourcepacksCount", "shadersCount"] as const

/** Устаревшее сохранение не должно возвращать контент во время файловой операции. */
export function filterStaleContentPatch(fields: Record<string, unknown>, patchRevision: number, currentRevision: number, mutating: boolean): Record<string, unknown> {
  if (!mutating && patchRevision === currentRevision) return fields
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !CONTENT_PATCH_FIELDS.has(key)))
}

/** Группирует вложенные файловые операции и запускает один перескан после последней. */
export function beginContentMutationGuard(active: Map<string, number>, revisions: Map<string, number>, buildId: string, onIdle: () => void): () => void {
  active.set(buildId, (active.get(buildId) ?? 0) + 1)
  revisions.set(buildId, (revisions.get(buildId) ?? 0) + 1)
  let finished = false
  return () => {
    if (finished) return
    finished = true
    revisions.set(buildId, (revisions.get(buildId) ?? 0) + 1)
    const remaining = (active.get(buildId) ?? 1) - 1
    if (remaining > 0) active.set(buildId, remaining)
    else { active.delete(buildId); onIdle() }
  }
}

/** Повторный запрос после изменения ждёт текущий проход и запускает один новый. */
export function createContentRefreshQueue() {
  const active = new Map<string, { dirty: boolean; task: Promise<void> }>()
  return (buildId: string, changed: boolean, refresh: () => Promise<void>): Promise<void> => {
    const current = active.get(buildId)
    if (current) {
      current.dirty ||= changed
      return current.task
    }
    const flight = { dirty: false, task: Promise.resolve() }
    flight.task = Promise.resolve().then(async () => {
      try {
        do {
          flight.dirty = false
          await refresh()
        } while (flight.dirty)
      } finally {
        active.delete(buildId)
      }
    })
    active.set(buildId, flight)
    return flight.task
  }
}

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
