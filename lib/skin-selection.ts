import type { LibrarySkin, McProfile } from "@xnlc/types"

/** Выбор для предпросмотра не является доказательством применения к аккаунту. */
export function equippedSkinId(profile: McProfile | null, library: LibrarySkin[]): string | null {
  if (!profile?.skins.some(s => s.state === "ACTIVE" && s.url)) return null
  const id = profile.equippedLibrarySkinId
  return id && library.some(s => s.id === id) ? id : "__api__"
}

export function initialSkinSelection(profile: McProfile | null, library: LibrarySkin[]): string | null {
  return equippedSkinId(profile, library) ?? library[0]?.id ?? null
}
