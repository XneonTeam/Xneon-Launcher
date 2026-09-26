import { queryAll, run, isDbAvailable, warnDbUnavailable } from "./core"

export type SkinLibraryRow = {
  id: string
  accountId: string
  name: string
  filePath: string
  variant: string
  capeId: string | null
  createdAt: string
  /** Идентификатор источника: `laby:<hash>` у новых скинов, ID Craftdex у старых. */
  sourceId: string | null
}

export async function loadSkinLibrary(accountId: string): Promise<SkinLibraryRow[]> {
  if (!isDbAvailable()) { warnDbUnavailable("loadSkinLibrary"); return [] }
  return queryAll<SkinLibraryRow>(
    "SELECT * FROM skin_library WHERE accountId = ? ORDER BY createdAt DESC",
    [accountId]
  )
}

/** Скин каталога уже сохранён у этого аккаунта — повторно не копируем. */
export async function findLibrarySkinBySource(accountId: string, sourceId: string): Promise<SkinLibraryRow | null> {
  if (!isDbAvailable()) { warnDbUnavailable("findLibrarySkinBySource"); return null }
  const rows = await queryAll<SkinLibraryRow>(
    "SELECT * FROM skin_library WHERE accountId = ? AND sourceId = ? LIMIT 1",
    [accountId, sourceId]
  )
  return rows[0] ?? null
}

/**
 * Запись по её id, независимо от аккаунта.
 *
 * Нужна удалению: раньше обработчик брал список через `loadSkinLibrary("")`,
 * то есть с пустым `accountId`, и не находил ни одной строки — PNG-файл
 * оставался на диске навсегда.
 */
export async function findLibrarySkinById(id: string): Promise<SkinLibraryRow | null> {
  if (!isDbAvailable()) { warnDbUnavailable("findLibrarySkinById"); return null }
  const rows = await queryAll<SkinLibraryRow>(
    "SELECT * FROM skin_library WHERE id = ? LIMIT 1",
    [id]
  )
  return rows[0] ?? null
}

export async function saveSkinToLibrary(skin: SkinLibraryRow): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("saveSkinToLibrary"); return }
  run(
    "INSERT OR REPLACE INTO skin_library (id, accountId, name, filePath, variant, capeId, createdAt, sourceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [skin.id, skin.accountId, skin.name, skin.filePath, skin.variant, skin.capeId ?? null, skin.createdAt, skin.sourceId ?? null]
  )
}

export async function deleteSkinFromLibrary(id: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("deleteSkinFromLibrary"); return }
  run("DELETE FROM skin_library WHERE id = ?", [id])
}

export async function updateSkinVariant(id: string, variant: "classic" | "slim"): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("updateSkinVariant"); return }
  run("UPDATE skin_library SET variant = ? WHERE id = ?", [variant, id])
}

export async function updateSkinCapeId(id: string, capeId: string | null): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("updateSkinCapeId"); return }
  run("UPDATE skin_library SET capeId = ? WHERE id = ?", [capeId, id])
}

export async function updateSkinName(id: string, name: string): Promise<void> {
  if (!isDbAvailable()) { warnDbUnavailable("updateSkinName"); return }
  run("UPDATE skin_library SET name = ? WHERE id = ?", [name, id])
}
