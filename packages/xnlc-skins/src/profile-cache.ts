import type { McProfile } from "@xnlc/types"
import type { SkinDiskCache } from "./ports.js"
import { BoundedMap } from "./cache.js"
import { createHash } from "node:crypto"

export function skinCacheKey(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Не пускаем ошибочный ответ API или повреждённый дисковый JSON в состояние UI. */
export function parseSkinProfile(value: unknown): McProfile | null {
  if (!value || typeof value !== "object") return null
  const data = value as McProfile
  if (typeof data.id !== "string" || typeof data.name !== "string" || !Array.isArray(data.skins) || !Array.isArray(data.capes)) return null
  const valid = (entry: unknown) => entry && typeof entry === "object"
    && typeof (entry as any).id === "string" && typeof (entry as any).url === "string"
    && typeof (entry as any).state === "string"
  if (!data.skins.every(valid) || !data.capes.every(valid)) return null
  return { id: data.id, name: data.name,
    skins: data.skins.map(s => ({ ...s, variant: String(s.variant).toUpperCase() === "SLIM" ? "SLIM" : "CLASSIC" })),
    capes: data.capes.map(c => ({ ...c })),
    ...(typeof data.uploadableTextures === "string" ? { uploadableTextures: data.uploadableTextures } : {}),
  }
}

type Entry = { profile: McProfile | null; at: number; pending?: Promise<McProfile | null> }

/** Память ограничена аккаунтами, диск переживает перезапуск. null не затирает удачный профиль. */
export class SkinProfileCache {
  private readonly entries = new BoundedMap<Entry>(64)
  constructor(private readonly disk?: SkinDiskCache) {}

  async get(accountId: string, load: () => Promise<McProfile | null>, force = false): Promise<McProfile | null> {
    const existing = this.entries.get(accountId)
    if (existing?.pending) return structuredClone(await existing.pending)
    if (!force && existing?.profile && Date.now() - existing.at < 15_000) return structuredClone(existing.profile)
    const entry: Entry = { profile: existing?.profile ?? null, at: 0 }
    this.entries.set(accountId, entry)
    const pending = (async () => {
      const fresh = parseSkinProfile(await load().catch(() => null))
      if (this.entries.get(accountId) !== entry) return this.get(accountId, load)
      if (fresh) {
        await this.put(accountId, fresh)
        return fresh
      }
      if (!entry.profile) {
        try {
          const raw = await this.disk?.read(`profile-${skinCacheKey(accountId)}.json`)
          if (raw) entry.profile = parseSkinProfile(JSON.parse(new TextDecoder().decode(raw)))
        } catch { /* Повреждённый кэш не мешает загрузке с сервера. */ }
      }
      return entry.profile
    })()
    entry.pending = pending
    try { return structuredClone(await pending) }
    finally { delete entry.pending }
  }

  async put(accountId: string, profile: McProfile): Promise<void> {
    this.entries.set(accountId, { profile: structuredClone(profile), at: Date.now() })
    await this.disk?.write(`profile-${skinCacheKey(accountId)}.json`, new TextEncoder().encode(JSON.stringify(profile))).catch(() => {})
  }

  invalidate(accountId: string): void {
    const previous = this.entries.get(accountId)
    this.entries.set(accountId, { profile: previous?.profile ?? null, at: 0 })
  }
}
