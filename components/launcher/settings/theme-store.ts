import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import type { Theme } from "./types"
import { presetThemes } from "./data"
import {
  applyTheme,
  createCustomTheme,
  duplicateTheme,
  findTheme,
  mergeThemes,
  parseThemes,
  serializeThemes,
} from "./theme-model"

/**
 * Хранение тем и реестр «пресеты + мои темы».
 *
 * Кастомные темы лежат в двух местах: localStorage (мгновенный холодный старт)
 * и настройки в БД лаунчера (`settings:set`). БД — источник правды: именно туда
 * пишет агент Xneon AI, поэтому `settings:updated` подхватывается на лету и
 * тема появляется в списке без перезапуска.
 */

export const CUSTOM_THEMES_SETTING = "customThemes"
export const SELECTED_THEME_SETTING = "theme"
export const DEFAULT_THEME_ID = presetThemes[0]?.id ?? "orange"

// Доступен и при запрещённом localStorage: React получает ту же тему,
// которая была прочитана и применена до первого рендера приложения.
let cachedCustomThemes: Theme[] | undefined
let cachedSelectedTheme: string | undefined

function readLocalCustomThemes(): Theme[] {
  if (cachedCustomThemes) return cachedCustomThemes
  if (typeof window === "undefined") return []
  try {
    return parseThemes(window.localStorage.getItem(CUSTOM_THEMES_SETTING))
  } catch {
    return []
  }
}

function readLocalSelectedTheme(): string {
  if (cachedSelectedTheme) return cachedSelectedTheme
  if (typeof window === "undefined") return DEFAULT_THEME_ID
  try {
    return window.localStorage.getItem(SELECTED_THEME_SETTING) || DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

/** Список кастомных тем: localStorage сразу, БД — при первой возможности. */
export async function loadCustomThemes(): Promise<Theme[]> {
  const local = readLocalCustomThemes()
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  if (!api?.getSetting) return local
  try {
    const stored = await api.getSetting(CUSTOM_THEMES_SETTING)
    if (stored === undefined) return local
    return parseThemes(stored)
  } catch {
    return local
  }
}

export function persistCustomThemes(themes: Theme[]): void {
  cachedCustomThemes = themes
  const raw = serializeThemes(themes)
  try {
    window.localStorage.setItem(CUSTOM_THEMES_SETTING, raw)
  } catch {
    /* приватный режим/квота — не повод ронять интерфейс */
  }
  void window.electronAPI?.setSetting(CUSTOM_THEMES_SETTING, raw)
}

export function persistSelectedTheme(id: string): void {
  cachedSelectedTheme = id
  try {
    window.localStorage.setItem(SELECTED_THEME_SETTING, id)
  } catch {
    /* см. выше */
  }
  void window.electronAPI?.setSetting(SELECTED_THEME_SETTING, id)
}

/** Пресеты вместе с кастомными темами; кастомная тема с тем же id перекрывает пресет. */
export function allThemes(custom: Theme[]): Theme[] {
  return mergeThemes(presetThemes, custom)
}

/** БД — источник истины; тема и её CSS применяются до монтирования React. */
export async function initializeTheme(): Promise<void> {
  const [customThemes, storedId] = await Promise.all([
    loadCustomThemes(),
    window.electronAPI?.getSetting(SELECTED_THEME_SETTING).catch(() => undefined),
  ])
  cachedCustomThemes = customThemes
  cachedSelectedTheme = storedId ?? readLocalSelectedTheme()
  try {
    localStorage.setItem(CUSTOM_THEMES_SETTING, serializeThemes(customThemes))
    localStorage.setItem(SELECTED_THEME_SETTING, cachedSelectedTheme)
  } catch { /* Тему всё равно сохраняет кэш в памяти. */ }
  const themes = allThemes(customThemes)
  applyTheme(findTheme(themes, cachedSelectedTheme) ?? findTheme(themes, DEFAULT_THEME_ID) ?? presetThemes[0])
}

export interface ThemeRegistry {
  /** Пресеты + мои темы. */
  themes: Theme[]
  customThemes: Theme[]
  selectedThemeId: string
  selectedTheme: Theme
  /** Кастомные темы прочитаны из хранилища (иначе список может мигнуть пустым). */
  ready: boolean
  selectTheme: (id: string) => void
  /** Создать или обновить свою тему (по id). */
  saveTheme: (theme: Theme) => void
  deleteTheme: (id: string) => void
  /** Копия темы в «Мои темы»; возвращает созданную тему. */
  copyTheme: (sourceId: string, name: string) => Theme | null
  /** Новая тема с полной палитрой (по умолчанию — как тёмная база или как образец). */
  makeTheme: (name: string, base?: Theme | null) => Theme
}

/**
 * Единый источник темы для лаунчера и настроек: применяет выбранную тему,
 * хранит свои темы и реагирует на изменения настроек из main (агент, другая вкладка).
 */
export function useThemeRegistry(): ThemeRegistry {
  const [customThemes, setCustomThemes] = useState<Theme[]>(() => readLocalCustomThemes())
  const [selectedThemeId, setSelectedThemeId] = useState<string>(() => readLocalSelectedTheme())
  const [ready, setReady] = useState(false)

  const themes = useMemo(() => allThemes(customThemes), [customThemes])
  const selectedTheme = useMemo(
    () => findTheme(themes, selectedThemeId) ?? findTheme(themes, DEFAULT_THEME_ID) ?? presetThemes[0],
    [themes, selectedThemeId]
  )

  // Первичная загрузка: темы и выбранный id из БД.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [storedThemes, storedTheme] = await Promise.all([
        loadCustomThemes(),
        window.electronAPI?.getSetting(SELECTED_THEME_SETTING).catch(() => undefined),
      ])
      if (cancelled) return
      cachedCustomThemes = storedThemes
      if (storedTheme !== undefined) cachedSelectedTheme = storedTheme
      setCustomThemes(storedThemes)
      if (storedTheme) setSelectedThemeId(storedTheme)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Применяем тему при любом изменении выбора или списка тем.
  useLayoutEffect(() => {
    if (!selectedTheme) return
    applyTheme(selectedTheme)
  }, [selectedTheme])

  // Изменения из main: тема и список своих тем (например, их правит агент).
  useEffect(() => {
    const off = window.electronAPI?.onSettingsUpdated?.(({ key, value }) => {
      if (key === SELECTED_THEME_SETTING) {
        cachedSelectedTheme = value
        try { window.localStorage.setItem(SELECTED_THEME_SETTING, value) } catch { /* БД остаётся источником правды. */ }
        setSelectedThemeId(value)
      } else if (key === CUSTOM_THEMES_SETTING) {
        cachedCustomThemes = parseThemes(value)
        try { window.localStorage.setItem(CUSTOM_THEMES_SETTING, serializeThemes(cachedCustomThemes)) } catch { /* БД остаётся источником правды. */ }
        setCustomThemes(cachedCustomThemes)
      }
    })
    return () => off?.()
  }, [])

  const selectTheme = useCallback((id: string) => {
    setSelectedThemeId(id)
    persistSelectedTheme(id)
  }, [])

  const saveTheme = useCallback((theme: Theme) => {
    setCustomThemes((current) => {
      const next = current.some((item) => item.id === theme.id)
        ? current.map((item) => (item.id === theme.id ? theme : item))
        : [...current, theme]
      persistCustomThemes(next)
      return next
    })
  }, [])

  const deleteTheme = useCallback((id: string) => {
    setCustomThemes((current) => {
      const next = current.filter((item) => item.id !== id)
      persistCustomThemes(next)
      return next
    })
    setSelectedThemeId((current) => {
      if (current !== id) return current
      persistSelectedTheme(DEFAULT_THEME_ID)
      return DEFAULT_THEME_ID
    })
  }, [])

  const makeTheme = useCallback(
    (name: string, base?: Theme | null) =>
      createCustomTheme(
        name,
        base,
        customThemes.map((item) => item.id)
      ),
    [customThemes]
  )

  const copyTheme = useCallback(
    (sourceId: string, name: string) => {
      const source = findTheme(themes, sourceId)
      if (!source) return null
      const copy = duplicateTheme(
        source,
        name,
        customThemes.map((item) => item.id)
      )
      saveTheme(copy)
      return copy
    },
    [themes, customThemes, saveTheme]
  )

  return {
    themes,
    customThemes,
    selectedThemeId,
    selectedTheme,
    ready,
    selectTheme,
    saveTheme,
    deleteTheme,
    copyTheme,
    makeTheme,
  }
}
