import type { LiveopsThemeRef, Theme } from "@xnlc/types"

/**
 * Общий словарь событийных тем LiveOps для main и renderer.
 *
 * Сервер отдаёт ивент с `event_id`; в лаунчере он живёт под id `event:<event_id>`
 * и не пересекается с пресетами и своими темами. Проверенный пакет ивента
 * хранится отдельной настройкой `eventTheme` (JSON) — в `customThemes` он не
 * попадает, иначе пользовательская коллекция тем смешалась бы с серверной.
 */
export const EVENT_THEME_PREFIX = "event:"

/** Проверенный пакет активного ивента (JSON) или пустая строка. */
export const EVENT_THEME_SETTING = "eventTheme"

/** Выбранный id темы: пресет, `custom-*` или `event:*` (`theme-store.ts`). */
export const SELECTED_THEME_SETTING = "theme"

/** Глобальное разрешение автоматики; отсутствие настройки сохраняет прежнее поведение (true). */
export const LIVEOPS_AUTO_APPLY_SETTING = "autoApplyLiveOps"

const CUSTOM_THEME_PREFIX = "custom-"

export function isEventThemeId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(EVENT_THEME_PREFIX)
}

/** id темы лаунчера для ссылки контроллера LiveOps. */
export function themeIdFromRef(ref: LiveopsThemeRef): string {
  return ref.kind === "event" ? EVENT_THEME_PREFIX + ref.id : ref.id
}

/**
 * Обратное преобразование сохранённого id в ссылку контроллера.
 * Неизвестный id считается пресетом: рендерер сам откатится на дефолтную тему.
 */
export function refFromThemeId(id: string | null | undefined): LiveopsThemeRef | null {
  if (typeof id !== "string" || !id.trim() || id !== id.trim() || id.length > 160) return null
  if (isEventThemeId(id)) {
    const eventId = id.slice(EVENT_THEME_PREFIX.length)
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(eventId) ? { kind: "event", id: eventId } : null
  }
  return { kind: id.startsWith(CUSTOM_THEME_PREFIX) ? "custom" : "preset", id }
}

/**
 * Разбор настройки `eventTheme`. Пакет уже проверен клиентом LiveOps
 * (`package.mjs`), поэтому здесь только отсекаем битый JSON и чужой id:
 * `sanitizeTheme` обрезал бы data URL фона и сломал картинку ивента.
 */
export function parseEventTheme(raw: string | null | undefined): Theme | null {
  if (typeof raw !== "string" || !raw) return null
  try {
    const theme = JSON.parse(raw) as Theme
    if (!theme || refFromThemeId(theme.id)?.kind !== "event" || typeof theme.name !== "string" || !theme.name.trim() || !/^#[a-f\d]{6}$/i.test(theme.primary) || !/^#[a-f\d]{6}$/i.test(theme.accent)) return null
    return theme
  } catch {
    return null
  }
}
