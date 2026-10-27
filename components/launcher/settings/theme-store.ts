import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import type { Theme } from "./types"
import { mergeLocalThemes, themeFromLocalFile } from "./theme-local"
import { presetThemes } from "./data"
import {
  applyTheme,
  createCustomTheme,
  duplicateTheme,
  findTheme,
  mergeThemes,
  parseThemes,
  serializeThemes,
  serializeThemeCss,
} from "./theme-model"

/**
 * Хранение тем и реестр «пресеты + мои темы».
 *
 * Кастомные темы лежат в двух местах: localStorage (мгновенный холодный старт)
 * и настройки в БД лаунчера (`settings:set`). Сохранение также пишет CSS и
 * метаданные в папку themes. При старте и внешней правке файл обновляет снимок
 * в БД; settings:updated синхронизирует изменения агента и других реестров.
 */

export const CUSTOM_THEMES_SETTING = "customThemes"
export const SELECTED_THEME_SETTING = "theme"
export const DEFAULT_THEME_ID = presetThemes[0]?.id ?? "orange"

/** Старые варианты Core объединены в один пресет с основой Deep. */
function normalizePresetId(id: string): string {
  return ["core-ink", "core-ember", "core-dune"].includes(id) ? "orange" : id
}

// Доступен и при запрещённом localStorage: React получает ту же тему,
// которая была прочитана и применена до первого рендера приложения.
let cachedCustomThemes: Theme[] | undefined
let cachedSelectedTheme: string | undefined
const pendingThemeWrites = new Set<string>()

async function writeThemeFiles(themes: Theme[], onlyMissing: boolean): Promise<Theme[]> {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  return Promise.all(themes.map(async theme => {
    if ((onlyMissing && theme.localFile) || !theme.id.startsWith("custom-") || !api?.saveLocalTheme) return theme
    try { return { ...theme, localFile: (await api.saveLocalTheme(theme, serializeThemeCss(theme))).fileName } }
    catch { return theme }
  }))
}

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
  if (cachedSelectedTheme) return normalizePresetId(cachedSelectedTheme)
  if (typeof window === "undefined") return DEFAULT_THEME_ID
  try {
    return normalizePresetId(window.localStorage.getItem(SELECTED_THEME_SETTING) || DEFAULT_THEME_ID)
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
    const saved = await writeThemeFiles(stored === undefined ? local : parseThemes(stored), true)
    const snapshot = await api.listLocalThemes?.().catch(() => undefined)
    const merged = snapshot ? mergeLocalThemes(saved, snapshot) : saved
    if (serializeThemes(merged) !== (stored ?? serializeThemes(local))) persistCustomThemes(merged)
    return merged
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
  const api = window.electronAPI
  if (api) {
    pendingThemeWrites.add(raw)
    void api.setSetting(CUSTOM_THEMES_SETTING, raw).catch(error => console.error("[Themes] Save failed", error)).finally(() => pendingThemeWrites.delete(raw))
  }
}

export function persistSelectedTheme(id: string): void {
  id = normalizePresetId(id)
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
  cachedSelectedTheme = normalizePresetId(storedId ?? readLocalSelectedTheme())
  if (storedId && storedId !== cachedSelectedTheme) persistSelectedTheme(cachedSelectedTheme)
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
  localErrors: string[]
  selectTheme: (id: string) => void
  /** Создать или обновить свою тему (по id). */
  saveTheme: (theme: Theme) => Promise<void>
  deleteTheme: (id: string) => Promise<void>
  /** Копия темы в «Мои темы»; возвращает созданную тему. */
  copyTheme: (sourceId: string, name: string) => Promise<Theme | null>
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
  const [localErrors, setLocalErrors] = useState<string[]>([])

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
      if (storedTheme !== undefined) cachedSelectedTheme = normalizePresetId(storedTheme)
      setCustomThemes(storedThemes)
      if (storedTheme) setSelectedThemeId(normalizePresetId(storedTheme))
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let revision = -1
    const receive = (snapshot: import("@xnlc/types").LocalThemeSnapshot) => {
      if (snapshot.revision <= revision) return
      revision = snapshot.revision
      setLocalErrors(snapshot.errors)
      setCustomThemes(current => {
        const merged = mergeLocalThemes(current, snapshot)
        if (serializeThemes(merged) === serializeThemes(current)) return current
        persistCustomThemes(merged)
        return merged
      })
    }
    const off = window.electronAPI?.onLocalThemesChanged?.(receive)
    let alive = true
    void window.electronAPI?.listLocalThemes?.().then(snapshot => { if (alive) receive(snapshot) }).catch(() => {})
    return () => { alive = false; off?.() }
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
        const pendingWrite = pendingThemeWrites.has(value)
        if (pendingWrite && serializeThemes(cachedCustomThemes ?? []) !== value) return
        const ownWrite = pendingWrite || serializeThemes(cachedCustomThemes ?? []) === value
        const incoming = parseThemes(value)
        cachedCustomThemes = incoming
        try { window.localStorage.setItem(CUSTOM_THEMES_SETTING, serializeThemes(cachedCustomThemes)) } catch { /* БД остаётся источником правды. */ }
        setCustomThemes(cachedCustomThemes)
        // Изменения из main (облако, агент) также доходят до связанного CSS.
        // Собственный снимок от наблюдателя повторно на диск не пишем.
        if (!ownWrite) void writeThemeFiles(incoming, false).then(mirrored => {
          if (cachedCustomThemes !== incoming || serializeThemes(mirrored) === value) return
          persistCustomThemes(mirrored)
          setCustomThemes(mirrored)
        })
      }
    })
    return () => off?.()
  }, [])

  const selectTheme = useCallback((id: string) => {
    setSelectedThemeId(id)
    persistSelectedTheme(id)
  }, [])

  const saveTheme = useCallback(async (theme: Theme) => {
    const file = await window.electronAPI?.saveLocalTheme?.(theme, serializeThemeCss(theme))
    const saved = file ? themeFromLocalFile(file, theme) ?? { ...theme, localFile: file.fileName } : theme
    setCustomThemes((current) => {
      const next = current.some((item) => item.id === theme.id)
        ? current.map((item) => (item.id === theme.id ? saved : item))
        : [...current, saved]
      persistCustomThemes(next)
      return next
    })
  }, [])

  const deleteTheme = useCallback(async (id: string) => {
    const theme = customThemes.find(item => item.id === id)
    if (theme?.localFile) await window.electronAPI?.deleteLocalTheme?.(theme.localFile)
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
  }, [customThemes])

  const makeTheme = useCallback(
    (name: string, base?: Theme | null) =>
      createCustomTheme(
        name,
        base === undefined ? selectedTheme : base,
        customThemes.map((item) => item.id)
      ),
    [customThemes, selectedTheme]
  )

  const copyTheme = useCallback(
    async (sourceId: string, name: string) => {
      const source = findTheme(themes, sourceId)
      if (!source) return null
      const copy = duplicateTheme(
        source,
        name,
        customThemes.map((item) => item.id)
      )
      await saveTheme(copy)
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
    localErrors,
    selectTheme,
    saveTheme,
    deleteTheme,
    copyTheme,
    makeTheme,
  }
}
