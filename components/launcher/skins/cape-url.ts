import type { McProfile } from "@xnlc/types"

/**
 * URL плаща для предпросмотра скина.
 *
 * Скин показывает ровно тот плащ, который к нему привязан (`capeId`). Раньше
 * при `capeId = null` подставлялся активный плащ аккаунта — из-за этого только
 * что добавленный скин выглядел так, будто ему сразу надели чужой плащ, хотя
 * сам скин каталога плаща не содержит вовсе.
 *
 * Живой скин аккаунта (`__api__`) сюда не попадает: ему активный плащ
 * проставляется явно в `favorites-tab`, поэтому он по-прежнему показывается
 * как есть.
 */
export function resolveSkinCapeUrl(
  capeId: string | null | undefined,
  capes: McProfile["capes"] | undefined,
): string | undefined {
  if (!capeId) return undefined
  return capes?.find((c) => c.id === capeId)?.url
}

/** Активный плащ аккаунта — то, что достанется новому скину. */
export function findActiveCape(capes: McProfile["capes"] | undefined): McProfile["capes"][number] | undefined {
  return capes?.find((c) => c.state === "ACTIVE")
}