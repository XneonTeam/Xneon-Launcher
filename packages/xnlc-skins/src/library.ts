// ============================================================
// @xnlc/skins — «Избранное»: сохранённые и локальные скины
// ============================================================
//
// Домен знает, что такое сохранённый скин и как он связан с каталогом, но не
// знает, где он лежит: файл текстуры, строку в базе и её удаление даёт порт
// `SkinLibraryStore`. Отсюда же идёт импорт из каталога — с проверкой
// дубликатов по источнику и, по желанию, с надеванием скина сразу.

import type { LabyImportResult, LibrarySkin, McProfile } from "@xnlc/types"
import type { LabyCatalog } from "./laby/catalog.js"
import type { MinecraftSkins } from "./minecraft.js"
import type { SkinLibraryStore } from "./ports.js"
import { isLabyHash } from "./laby/urls.js"
import { isValidTexture, labySkinFallbackName, normalizeVariant, sanitizeSkinName, type SkinVariant } from "./validate.js"
import { skinTextureKey } from "./texture.js"
import { BoundedMap } from "./cache.js"
import { labySourceId } from "./sources.js"
export { LABY_SOURCE_PREFIX, labySourceId, labyHashFromSourceId, librarySkinSource } from "./sources.js"
export type { LibrarySkinSource } from "./sources.js"

export type SaveSkinInput = {
  accountId: string
  name: string
  variant: SkinVariant
  capeId?: string | null
  sourceId?: string | null
  data: Uint8Array
}

export type ImportFromCatalogInput = {
  hash: string
  accountId: string
  name?: string
  /** Явная модель важнее метаданных каталога: скины игрока в пуле отсутствуют. */
  slim?: boolean
}

export class SkinLibrary {
  private readonly identities = new BoundedMap<string>(256)
  private readonly mutations = new Map<string, Promise<unknown>>()
  private readonly saves = new Map<string, Promise<unknown>>()
  private readonly revisions = new BoundedMap<number>(64)
  constructor(
    private readonly store: SkinLibraryStore,
    private readonly catalog: LabyCatalog,
    private readonly minecraft: MinecraftSkins,
  ) {}

  list(accountId: string): Promise<LibrarySkin[]> {
    return this.store.list(accountId)
  }

  /** Надетый скин определяется сервером, а не последним кликом в renderer. */
  async profile(accountId?: string): Promise<McProfile | null> {
    const id = await this.minecraft.accountId(accountId)
    if (!id) return null
    await this.mutations.get(id)?.catch(() => {})
    const revision = this.revisions.get(id) ?? 0
    const profile = await this.minecraft.profile(id)
    if (!profile) return null
    const active = profile.skins.find(s => s.state === "ACTIVE")
    const local = active ? (await this.store.list(id)).find(s => s.filePath === active.url) : null
    const bytes = local ? await this.store.readTexture(local.id) : active ? await this.minecraft.texture(active.url) : null
    const saved = local ?? (bytes ? await this.findTexture(id, bytes) : null)
    if (local) active.variant = local.variant === "slim" ? "SLIM" : "CLASSIC"
    if (revision !== (this.revisions.get(id) ?? 0)) return this.profile(id)
    if (saved) {
      const variant = active.variant === "SLIM" ? "slim" : "classic"
      const capeId = profile.capes.find(c => c.state === "ACTIVE")?.id ?? null
      if (saved.variant !== variant || saved.capeId !== capeId) await this.store.update(saved.id, { variant, capeId })
    }
    // Активная текстура тоже приходит из main: без CORS и с дисковым офлайн-кэшем.
    if (bytes) active.url = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
    return { ...profile, equippedLibrarySkinId: saved?.id ?? null }
  }

  private async findTexture(accountId: string, data: Uint8Array): Promise<LibrarySkin | null> {
    const key = skinTextureKey(data)
    if (!key) return null
    for (const skin of await this.store.list(accountId)) {
      const cacheKey = `${skin.id}:${skin.filePath}`
      let identity = this.identities.get(cacheKey)
      if (!identity) {
        const bytes = await this.store.readTexture(skin.id)
        identity = bytes ? skinTextureKey(bytes) : null
        if (identity) this.identities.set(cacheKey, identity)
      }
      if (identity === key) return skin
    }
    return null
  }

  private async preserveCurrent(accountId: string): Promise<boolean> {
    const profile = await this.minecraft.profile(accountId, true)
    if (!profile) return false
    const active = profile.skins.find(s => s.state === "ACTIVE")
    if (!active) return true
    // Офлайн-аккаунт уже ссылается на принадлежащий библиотеке PNG.
    if ((await this.store.list(accountId)).some(s => s.filePath === active.url)) return true
    const data = await this.minecraft.texture(active.url)
    if (!data) return false
    const existing = await this.findTexture(accountId, data)
    if (existing) {
      await this.store.update(existing.id, {
        variant: active.variant === "SLIM" ? "slim" : "classic",
        capeId: profile.capes.find(c => c.state === "ACTIVE")?.id ?? null,
      })
      return true
    }
    return Boolean(await this.save({ accountId, data, name: profile.name,
      variant: active.variant === "SLIM" ? "slim" : "classic",
      capeId: profile.capes.find(c => c.state === "ACTIVE")?.id ?? null,
    }))
  }

  /** Два быстрых применения не должны перемешать скин первого и плащ второго. */
  private async mutate<T>(accountId: string, run: () => Promise<T>, queue = this.mutations): Promise<T> {
    const previous = queue.get(accountId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(async () => {
      if (queue === this.mutations) this.revisions.set(accountId, (this.revisions.get(accountId) ?? 0) + 1)
      try { return await run() }
      finally { if (queue === this.mutations) this.revisions.set(accountId, (this.revisions.get(accountId) ?? 0) + 1) }
    })
    queue.set(accountId, current)
    try { return await current }
    finally { if (queue.get(accountId) === current) queue.delete(accountId) }
  }

  /** Сохраняет скин из файла, который уже прочитала вызывающая сторона. */
  async save(input: SaveSkinInput): Promise<LibrarySkin | null> {
    if (!input?.accountId) return null
    if (!isValidTexture(input.data)) return null
    return this.mutate(input.accountId, async () => {
      const existing = await this.findTexture(input.accountId, input.data)
      if (existing) {
        const patch = {
          variant: normalizeVariant(input.variant), capeId: input.capeId ?? null,
          name: sanitizeSkinName(input.name, existing.name),
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        }
        await this.store.update(existing.id, patch)
        return { ...existing, ...patch }
      }
      return this.store.create({
        name: sanitizeSkinName(input.name, "Skin"),
        variant: normalizeVariant(input.variant),
        accountId: input.accountId,
        capeId: input.capeId ?? null,
        sourceId: input.sourceId ?? null,
        data: input.data,
      })
    }, this.saves)
  }

  async remove(id: string): Promise<boolean> {
    try {
      const skin = await this.store.findById(id)
      if (!skin) return false
      return await this.mutate(skin.accountId, async () => {
        await this.store.remove(id)
        return true
      })
    } catch {
      return false
    }
  }

  async update(id: string, patch: { variant?: SkinVariant; capeId?: string | null; name?: string }): Promise<boolean> {
    try {
      if (!await this.store.findById(id)) return false
      await this.store.update(id, {
        ...(patch.variant !== undefined ? { variant: normalizeVariant(patch.variant) } : {}),
        ...(patch.capeId !== undefined ? { capeId: patch.capeId ?? null } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
      })
      return true
    } catch {
      return false
    }
  }

  /** Надевает сохранённый скин вместе с привязанным к нему плащом. */
  async apply(id: string, accountId: string): Promise<boolean> {
    return this.mutate(accountId, async () => {
      try {
        const skin = await this.store.findById(id)
        if (!skin || skin.accountId !== accountId) return false
        const variant = normalizeVariant(skin.variant)
        const capeId = skin.capeId ?? null
        const data = await this.store.readTexture(id)
        if (!data || !isValidTexture(data)) return false
        if (!await this.preserveCurrent(accountId)) return false
        return await this.minecraft.apply({ accountId, data, variant, capeId })
      } catch {
        return false
      }
    })
  }

  /** Сбрасывает скин аккаунта: у персонажа снова стандартный. */
  async reset(accountId?: string): Promise<boolean> {
    const id = await this.minecraft.accountId(accountId)
    if (!id) return false
    return this.mutate(id, async () => {
      if (!await this.preserveCurrent(id)) return false
      return this.minecraft.reset(id)
    })
  }

  async setCape(capeId: string | null, accountId?: string): Promise<boolean> {
    const id = await this.minecraft.accountId(accountId)
    if (!id) return false
    return this.mutate(id, () => this.minecraft.setCape(capeId, id))
  }

  /**
   * Импорт скина каталога: текстура в «Избранное» и, по желанию, сразу на
   * аккаунт.
   *
   * Повторный импорт того же скина не копирует файл: связь «Избранного» с
   * каталогом — `sourceId`, поэтому второй раз находим уже сохранённую запись и
   * только надеваем её.
   */
  async importFromCatalog(params: ImportFromCatalogInput, apply: boolean): Promise<LabyImportResult> {
    const fail = (error: string): LabyImportResult => ({
      saved: false,
      librarySkinId: null,
      applied: false,
      error,
    })

    try {
      if (!params?.accountId) return fail("account")
      if (!isLabyHash(params.hash)) return fail("skin")

      const sourceId = labySourceId(params.hash)
      const existing = await this.store.findBySource(params.accountId, sourceId)
      if (existing) {
        if (!apply) return { saved: true, librarySkinId: existing.id, applied: false }
        const applied = await this.apply(existing.id, params.accountId)
        return { saved: true, librarySkinId: existing.id, applied, ...(applied ? {} : { error: "apply" }) }
      }

      const data = await this.catalog.texture(params.hash)
      if (!data) return fail("texture")

      // Модель: явный флаг важнее метаданных пула — скины игрока в пуле
      // отсутствуют, определить их модель по метаданным неоткуда.
      const known = this.catalog.findKnownSkin(params.hash)
      const slim = params.slim ?? known?.slim ?? false
      const variant: SkinVariant = slim ? "slim" : "classic"
      const name = sanitizeSkinName(params.name || known?.name, labySkinFallbackName(params.hash))

      const saved = await this.save({ name, variant, accountId: params.accountId, capeId: null, sourceId, data })
      if (!saved) return fail("save")
      if (!apply) return { saved: true, librarySkinId: saved.id, applied: false }

      const applied = await this.apply(saved.id, params.accountId)
      return { saved: true, librarySkinId: saved.id, applied, ...(applied ? {} : { error: "apply" }) }
    } catch {
      return fail("network")
    }
  }
}
