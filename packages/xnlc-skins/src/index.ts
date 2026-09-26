// ============================================================
// @xnlc/skins — Entry Point
// Домен скинов Minecraft: каталог Laby, «Избранное», локальные
// скины, активный скин и кэш. Без зависимости от Electron.
// ============================================================
//
// Устройство пакета:
//
//   LabyCatalog     — каталог Laby: страницы, теги, игроки, «похожие», текстуры
//   SkinLibrary     — «Избранное»: сохранённые и локальные скины, импорт из каталога
//   MinecraftSkins  — активный скин на аккаунте: надевание, сброс, плащ, профиль
//   SkinCache       — память (TTL) + диск (последнее удачное значение)
//
// Всё, что выходит за пределы домена — хранилище «Избранного», дисковый кэш и
// доступ к аккаунту, — описано портами в `ports.ts` и реализуется приложением.
// Сам пакет не знает ни про Electron, ни про SQLite, ни про файловую систему.

import type { LabyCatalogOptions, LabyCatalog } from "./laby/catalog.js"
import { LabyCatalog as LabyCatalogImpl } from "./laby/catalog.js"
import type { LabyClient } from "./laby/client.js"
import { SkinLibrary } from "./library.js"
import { MinecraftSkins } from "./minecraft.js"
import type { SkinAccountPort, SkinDiskCache, SkinLibraryStore } from "./ports.js"

// ── Порты ─────────────────────────────────────────────────
export type { ResolvedSkinAccount, SkinAccountPort, SkinDiskCache, SkinLibraryStore } from "./ports.js"

// ── Кэш ───────────────────────────────────────────────────
export { BoundedMap, SkinCache } from "./cache.js"
export type { CachePolicy } from "./cache.js"

// ── Каталог Laby ──────────────────────────────────────────
export { LabyCatalog } from "./laby/catalog.js"
export type { CatalogQuery, LabyCatalogOptions } from "./laby/catalog.js"
export { LabyClient, LabyRequestError, describeLabyError, toLabyApiError } from "./laby/client.js"

// Адреса API и валидация идентификаторов
export {
  LABY_API_BASE,
  LABY_DEFAULT_ORDER,
  LABY_MAX_PAGE_SIZE,
  LABY_ORDERS,
  LABY_PROFILE_TEXTURE_BASE,
  LABY_RENDER_BASE,
  LABY_SKIN_PAGE_BASE,
  LABY_TEXTURE_BASE,
  LABY_TREND_ORDERS,
  isLabyHash,
  isLabyUsername,
  isLabyUuid,
  labyHeadUrl,
  labyPagesOffset,
  labyPlayerPageUrl,
  labyProfileSkinUrl,
  labyRenderUrl,
  labySearchUrl,
  labySkinPageUrl,
  labyTagSkinsUrl,
  labyTagsUrl,
  labyTextureUrl,
  labyUniqueIdUrl,
  labyUserTexturesUrl,
  sanitizeLabyUsername,
} from "./laby/urls.js"

// Маппинг ответов Laby в модель лаунчера
export {
  labyPlayerSkinToSkin,
  labySkinName,
  mapLabyPlayerCapesCount,
  mapLabyPlayerSkins,
  mapLabySkin,
  mapLabyTag,
  mapLabyTagSkin,
  mapLabyUniqueId,
  parseLabyTags,
} from "./laby/mapping.js"

// Локальные фильтры, «похожие» и форматирование метрик
export { dedupeSkins, formatUseCount, labyFilterSkins, labySimilarSkins, labySimilarityScore } from "./laby/scoring.js"

// ── «Избранное» и активный скин ───────────────────────────
export {
  LABY_SOURCE_PREFIX,
  SkinLibrary,
  labyHashFromSourceId,
  labySourceId,
  librarySkinSource,
} from "./library.js"
export type { ImportFromCatalogInput, LibrarySkinSource, SaveSkinInput } from "./library.js"
export { MinecraftSkins } from "./minecraft.js"

// Валидация
export { MAX_TEXTURE_BYTES, isValidTexture, labySkinFallbackName, normalizeVariant, sanitizeSkinName } from "./validate.js"
export type { SkinVariant } from "./validate.js"

// ── Контракты, которые пересекают границу main ↔ renderer ──
// Реэкспорт, чтобы потребителю хватало одного импорта: типы приходят из
// `@xnlc/types` (единый источник контрактов), а поведение — отсюда.
export type {
  LabyApiError,
  LabyCatalogPage,
  LabyImportResult,
  LabyOrder,
  LabyPlayer,
  LabyPlayerSkin,
  LabySkin,
  LabyTag,
  LabyTagPreview,
  LibrarySkin,
  McProfile,
  MinecraftCape,
  MinecraftSkin,
} from "@xnlc/types"

export type SkinSystemOptions = {
  /** Хранилище «Избранного»: база + файлы текстур. */
  library: SkinLibraryStore
  /** Аккаунты и их токены Minecraft Services. */
  accounts: SkinAccountPort
  /** Дисковый кэш для офлайн-режима. Без него каталог работает только по сети. */
  disk?: SkinDiskCache
  /** Язык подписей тегов Laby. */
  locale?: string
  /** Свой HTTP-клиент: нужен тестам. */
  client?: LabyClient
}

export type SkinSystem = {
  catalog: LabyCatalog
  library: SkinLibrary
  minecraft: MinecraftSkins
  /** Сбрасывает кэш и пулы каталога. */
  reset(): void
}

/** Собирает домен скинов из портов приложения. */
export function createSkinSystem(options: SkinSystemOptions): SkinSystem {
  const catalogOptions: LabyCatalogOptions = {
    disk: options.disk,
    locale: options.locale,
    client: options.client,
  }
  const catalog = new LabyCatalogImpl(catalogOptions)
  const minecraft = new MinecraftSkins(options.accounts)
  const library = new SkinLibrary(options.library, catalog, minecraft)
  return { catalog, library, minecraft, reset: () => catalog.reset() }
}