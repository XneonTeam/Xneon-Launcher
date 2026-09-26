/**
 * Откуда скин попал в «Избранное».
 *
 * Новые записи получают идентификатор источника с префиксом (`laby:<hash>`),
 * а сохранённые ранее из Craftdex содержат голый UUID. Различаем их, чтобы
 * старые записи не подписывались как Laby и не считались дублями новых.
 */
export type LibrarySkinSourceKind = "laby" | "craftdex" | "local"

export function librarySkinSourceKind(sourceId: string | null | undefined): LibrarySkinSourceKind {
  if (!sourceId) return "local"
  if (sourceId.startsWith("laby:")) return "laby"
  return "craftdex"
}

/** Идентификатор источника для каталога Laby: по нему же ищем дубли. */
export function labySourceId(hash: string): string {
  return `laby:${hash}`
}

export function labyHashFromSourceId(sourceId: string | null | undefined): string | null {
  if (!sourceId || !sourceId.startsWith("laby:")) return null
  const hash = sourceId.slice("laby:".length)
  return hash || null
}