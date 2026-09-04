import { queryAll, run, persistDatabase, isDbAvailable } from "./core"

export type SkinLibraryRow = {
  id: string
  accountId: string
  name: string
  filePath: string
  variant: string
  capeId: string | null
  createdAt: string
}

export async function loadSkinLibrary(accountId: string): Promise<SkinLibraryRow[]> {
  if (!isDbAvailable()) return []
  return queryAll<SkinLibraryRow>(
    "SELECT * FROM skin_library WHERE accountId = ? ORDER BY createdAt DESC",
    [accountId]
  )
}

export async function saveSkinToLibrary(skin: SkinLibraryRow): Promise<void> {
  if (!isDbAvailable()) return
  run(
    "INSERT OR REPLACE INTO skin_library (id, accountId, name, filePath, variant, capeId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [skin.id, skin.accountId, skin.name, skin.filePath, skin.variant, skin.capeId ?? null, skin.createdAt]
  )
  persistDatabase()
}

export async function deleteSkinFromLibrary(id: string): Promise<void> {
  if (!isDbAvailable()) return
  run("DELETE FROM skin_library WHERE id = ?", [id])
  persistDatabase()
}

export async function updateSkinVariant(id: string, variant: "classic" | "slim"): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE skin_library SET variant = ? WHERE id = ?", [variant, id])
  persistDatabase()
}

export async function updateSkinCapeId(id: string, capeId: string | null): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE skin_library SET capeId = ? WHERE id = ?", [capeId, id])
  persistDatabase()
}

export async function updateSkinName(id: string, name: string): Promise<void> {
  if (!isDbAvailable()) return
  run("UPDATE skin_library SET name = ? WHERE id = ?", [name, id])
  persistDatabase()
}
