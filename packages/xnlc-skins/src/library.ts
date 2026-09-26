// ============================================================
// @xnlc/skins — «Избранное»: сохранённые и локальные скины
// ============================================================
//
// Домен знает, что такое сохранённый скин и как он связан с каталогом, но не
// знает, где он лежит: файл текстуры, строку в базе и её удаление даёт порт
// `SkinLibraryStore`. Отсюда же идёт импорт из каталога — с проверкой
// дубликатов по источнику и, по желанию, с надеванием скина сразу.

import type { LabyImportResult, LibrarySkin } from "@xnlc/types"
import type { LabyCatalog } from "./laby/catalog.js"
import type { MinecraftSkins } from "./minecraft.js"
import type { SkinLibraryStore } from "./ports.js"
import { isLabyHash } from "./laby/urls.js"
import { isValidTexture, labySkinFallbackName, normalizeVariant, sanitizeSkinName, type SkinVariant } from "./validate.js"

/** Префикс источника скина из каталога: `laby:<image_hash>`. */
export const LABY_SOURCE_PREFIX = "laby:"

export function labySourceId(hash: string): string {
  return `${LABY_SOURCE_PREFIX}${hash}`
}

export function labyHashFromSourceId(sourceId: string | null | undefined): string | null {
  if (!sourceId || !sourceId.startsWith(LABY_SOURCE_PREFIX)) return null
  const hash = sourceId.slice(LABY_SOURCE_PREFIX.length)
  return hash || null
}

/**
 * Откуда скин попал в «Избранное».
 *
 * Новые записи получают идентификатор источника с префиксом (`laby:<hash>`), а
 * сохранённые ранее из каталога Craftdex содержат голый UUID. Различаем их,
 * чтобы старые записи не подписывались как Laby и не считались дублями новых.
 */
export type LibrarySkinSource = "laby" | "legacy" | "local"

export function librarySkinSource(sourceId: string | null | undefined): LibrarySkinSource {
  if (!sourceId) return "local"
  return sourceId.startsWith(LABY_SOURCE_PREFIX) ? "laby" : "legacy"
}

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
  constructor(
    private readonly store: SkinLibraryStore,
    private readonly catalog: LabyCatalog,
    private readonly minecraft: MinecraftSkins,
  ) {}

  list(accountId: string): Promise<LibrarySkin[]> {
    return this.store.list(accountId)
  }

  /** Сохраняет скин из файла, который уже прочитала вызывающая сторона. */
  async save(input: SaveSkinInput): Promise<LibrarySkin | null> {
    if (!input?.accountId) return null
    if (!isValidTexture(input.data)) return null
    return this.store.create({
      name: sanitizeSkinName(input.name, "Skin"),
      variant: normalizeVariant(input.variant),
      accountId: input.accountId,
      capeId: input.capeId ?? null,
      sourceId: input.sourceId ?? null,
      data: input.data,
    })
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.store.remove(id)
      return true
    } catch {
      return false
    }
  }

  async update(id: string, patch: { variant?: SkinVariant; capeId?: string | null; name?: string }): Promise<boolean> {
    try {
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
    try {
      const skin = await this.store.findById(id)
      if (!skin) return false
      const data = await this.store.readTexture(id)
      if (!data) return false
      return await this.minecraft.apply({
        accountId,
        data,
        variant: normalizeVariant(skin.variant),
        capeId: skin.capeId ?? null,
      })
    } catch {
      return false
    }
  }

  /** Сбрасывает скин аккаунта: у персонажа снова стандартный. */
  reset(accountId?: string): Promise<boolean> {
    return this.minecraft.reset(accountId)
  }

  setCape(capeId: string | null, accountId?: string): Promise<boolean> {
    return this.minecraft.setCape(capeId, accountId)
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
        const data = await this.store.readTexture(existing.id)
        if (!data) return fail("texture")
        const applied = await this.minecraft.apply({
          accountId: params.accountId,
          data,
          variant: normalizeVariant(existing.variant),
          capeId: existing.capeId ?? null,
        })
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

      const saved = await this.store.create({ name, variant, accountId: params.accountId, capeId: null, sourceId, data })
      if (!saved) return fail("save")
      if (!apply) return { saved: true, librarySkinId: saved.id, applied: false }

      const applied = await this.minecraft.apply({ accountId: params.accountId, data, variant })
      return { saved: true, librarySkinId: saved.id, applied, ...(applied ? {} : { error: "apply" }) }
    } catch {
      return fail("network")
    }
  }
}