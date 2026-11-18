/** Идентификаторы источников не зависят от файлов, PNG-декодера или main. */
export const LABY_SOURCE_PREFIX = "laby:"
export function labySourceId(hash: string): string { return `${LABY_SOURCE_PREFIX}${hash}` }
export function labyHashFromSourceId(sourceId: string | null | undefined): string | null {
  return sourceId?.startsWith(LABY_SOURCE_PREFIX) ? sourceId.slice(LABY_SOURCE_PREFIX.length) || null : null
}
export type LibrarySkinSource = "laby" | "legacy" | "local"
export function librarySkinSource(sourceId: string | null | undefined): LibrarySkinSource {
  return !sourceId ? "local" : sourceId.startsWith(LABY_SOURCE_PREFIX) ? "laby" : "legacy"
}
