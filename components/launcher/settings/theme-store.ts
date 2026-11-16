import { createContext, createElement, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useState, type PropsWithChildren } from "react"
import type { Theme } from "./types"
import { mergeLocalThemes, themeFromLocalFile } from "./theme-local"
import { presetThemes } from "./data"
import { EVENT_THEME_SETTING, SELECTED_THEME_SETTING, LIVEOPS_AUTO_APPLY_SETTING, parseEventTheme, refFromThemeId } from "@/lib/liveops-theme-refs"
export { SELECTED_THEME_SETTING } from "@/lib/liveops-theme-refs"
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
export const DEFAULT_THEME_ID = presetThemes[0]?.id ?? "orange"
const THEME_SETTINGS = [SELECTED_THEME_SETTING, EVENT_THEME_SETTING, LIVEOPS_AUTO_APPLY_SETTING]

/** Старые варианты Core объединены в один пресет с основой Deep. */
function normalizePresetId(id: string): string {
  return ["core-ink", "core-ember", "core-dune"].includes(id) ? "orange" : id
}

// Доступен и при запрещённом localStorage: React получает ту же тему,
// которая была прочитана и применена до первого рендера приложения.
let cachedCustomThemes: Theme[] | undefined
let cachedSelectedTheme: string | undefined
let cachedEventTheme: Theme | null = null
let cachedAutoApplyLiveops = true
let initialized = false
let cachedLocalSnapshot: import("@xnlc/types").LocalThemeSnapshot | undefined
const pendingThemeWrites = new Set<string>()

async function writeThemeFiles(themes: Theme[], onlyMissing: boolean): Promise<Theme[]> {
  const api = typeof window !== "undefined" ? window.electrobunAPI : undefined
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
  const api = typeof window !== "undefined" ? window.electrobunAPI : undefined
  if (!api?.getSetting) return local
  try {
    const stored = await api.getSetting(CUSTOM_THEMES_SETTING)
    const saved = await writeThemeFiles(stored === undefined ? local : parseThemes(stored), true)
    const snapshot = await api.listLocalThemes?.().catch(() => undefined)
    if (snapshot) cachedLocalSnapshot = snapshot
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
  const api = window.electrobunAPI
  if (api) {
    pendingThemeWrites.add(raw)
    void api.setSetting(CUSTOM_THEMES_SETTING, raw).catch(error => console.error("[Themes] Save failed", error)).finally(() => pendingThemeWrites.delete(raw))
  }
}

export async function persistSelectedTheme(id: string): Promise<void> {
  id = normalizePresetId(id)
  const ref = refFromThemeId(id)
  if (!ref) throw new Error("Invalid theme reference")
  const api = window.electrobunAPI
  if (api?.liveopsSelect) id = (await api.liveopsSelect(ref)).selected ?? id
  else if (api) await api.setSetting(SELECTED_THEME_SETTING, id)
  cachedSelectedTheme = id
  try {
    window.localStorage.setItem(SELECTED_THEME_SETTING, id)
  } catch {
    /* см. выше */
  }
}

/** Пресеты вместе с кастомными темами; кастомная тема с тем же id перекрывает пресет. */
export function allThemes(custom: Theme[], eventTheme: Theme | null = cachedEventTheme): Theme[] {
  return mergeThemes(mergeThemes(presetThemes, custom), eventTheme ? [eventTheme] : [])
}

/** БД — источник истины; тема и её CSS применяются до монтирования React. */
export async function initializeTheme(): Promise<void> {
  const [customThemes, settings] = await Promise.all([
    loadCustomThemes(),
    window.electrobunAPI?.getSettings(THEME_SETTINGS).catch(() => undefined),
  ])
  const storedId = settings?.[SELECTED_THEME_SETTING]
  cachedEventTheme = parseEventTheme(settings?.[EVENT_THEME_SETTING])
  cachedAutoApplyLiveops = settings?.[LIVEOPS_AUTO_APPLY_SETTING] !== "false"
  cachedCustomThemes = customThemes
  cachedSelectedTheme = normalizePresetId(storedId ?? readLocalSelectedTheme())
  // Совместимость старого ID — только локальное отображение, не ручной выбор.
  // Запись через liveopsSelect здесь могла бы отклонить уже пришедший в фоне ивент.
  try {
    localStorage.setItem(CUSTOM_THEMES_SETTING, serializeThemes(customThemes))
    localStorage.setItem(SELECTED_THEME_SETTING, cachedSelectedTheme)
  } catch { /* Тему всё равно сохраняет кэш в памяти. */ }
  const themes = allThemes(customThemes)
  applyTheme(findTheme(themes, cachedSelectedTheme) ?? findTheme(themes, DEFAULT_THEME_ID) ?? presetThemes[0])
  initialized = true
}

export interface ThemeRegistry {
  /** Пресеты + мои темы. */
  themes: Theme[]
  customThemes: Theme[]
  selectedThemeId: string
  selectedTheme: Theme
  autoApplyLiveops: boolean
  setAutoApplyLiveops: (enabled: boolean) => Promise<void>
  /** Кастомные темы прочитаны из хранилища (иначе список может мигнуть пустым). */
  ready: boolean
  localErrors: string[]
  selectTheme: (id: string) => Promise<void>
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
function useThemeRegistryState(): ThemeRegistry {
  const [customThemes, setCustomThemes] = useState<Theme[]>(() => readLocalCustomThemes())
  const [selectedThemeId, setSelectedThemeId] = useState<string>(() => readLocalSelectedTheme())
  const [eventTheme, setEventTheme] = useState<Theme | null>(() => cachedEventTheme)
  const [autoApplyLiveops, setAutoApplyLiveopsState] = useState(() => cachedAutoApplyLiveops)
  const [ready, setReady] = useState(initialized)
  const [localErrors, setLocalErrors] = useState<string[]>([])

  const themes = useMemo(() => allThemes(customThemes, eventTheme), [customThemes, eventTheme])
  const selectedTheme = useMemo(
    () => findTheme(themes, selectedThemeId) ?? findTheme(themes, DEFAULT_THEME_ID) ?? presetThemes[0],
    [themes, selectedThemeId]
  )

  // Первичная загрузка: темы и выбранный id из БД.
  useEffect(() => {
    if (initialized) return
    let cancelled = false
    void (async () => {
      const [storedThemes, settings] = await Promise.all([
        loadCustomThemes(),
        window.electrobunAPI?.getSettings(THEME_SETTINGS).catch(() => undefined),
      ])
      if (cancelled) return
      const storedTheme = settings?.[SELECTED_THEME_SETTING]
      cachedEventTheme = parseEventTheme(settings?.[EVENT_THEME_SETTING])
      cachedAutoApplyLiveops = settings?.[LIVEOPS_AUTO_APPLY_SETTING] !== "false"
      setAutoApplyLiveopsState(cachedAutoApplyLiveops)
      setEventTheme(cachedEventTheme)
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
      cachedLocalSnapshot = snapshot
      setLocalErrors(snapshot.errors)
      setCustomThemes(current => {
        const merged = mergeLocalThemes(current, snapshot)
        if (serializeThemes(merged) === serializeThemes(current)) return current
        persistCustomThemes(merged)
        return merged
      })
    }
    const off = window.electrobunAPI?.onLocalThemesChanged?.(receive)
    let alive = true
    if (cachedLocalSnapshot) receive(cachedLocalSnapshot)
    else void window.electrobunAPI?.listLocalThemes?.().then(snapshot => { if (alive) receive(snapshot) }).catch(() => {})
    return () => { alive = false; off?.() }
  }, [])

  // Применяем тему при любом изменении выбора или списка тем.
  useLayoutEffect(() => {
    if (!selectedTheme) return
    applyTheme(selectedTheme)
  }, [selectedTheme])

  // Изменения из main: тема и список своих тем (например, их правит агент).
  useEffect(() => {
    let revision = 0
    const off = window.electrobunAPI?.onSettingsUpdated?.(({ key, value }) => {
      if (THEME_SETTINGS.includes(key)) revision++
      if (key === SELECTED_THEME_SETTING) {
        cachedSelectedTheme = normalizePresetId(value)
        try { window.localStorage.setItem(SELECTED_THEME_SETTING, cachedSelectedTheme) } catch { /* БД остаётся источником правды. */ }
        setSelectedThemeId(cachedSelectedTheme)
      } else if (key === EVENT_THEME_SETTING) {
        cachedEventTheme = parseEventTheme(value)
        setEventTheme(cachedEventTheme)
      } else if (key === LIVEOPS_AUTO_APPLY_SETTING) {
        cachedAutoApplyLiveops = value !== "false"
        setAutoApplyLiveopsState(cachedAutoApplyLiveops)
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
    // Закрываем окно между initializeTheme и установкой push-подписки.
    let alive = true
    const initialRevision = revision
    void window.electrobunAPI?.getSettings(THEME_SETTINGS).then(settings => {
      if (!alive || revision !== initialRevision) return
      cachedEventTheme = parseEventTheme(settings[EVENT_THEME_SETTING])
      setEventTheme(cachedEventTheme)
      cachedAutoApplyLiveops = settings[LIVEOPS_AUTO_APPLY_SETTING] !== "false"
      setAutoApplyLiveopsState(cachedAutoApplyLiveops)
      const id = settings[SELECTED_THEME_SETTING]
      if (id) { cachedSelectedTheme = normalizePresetId(id); setSelectedThemeId(cachedSelectedTheme) }
    }).catch(() => {})
    return () => { alive = false; off?.() }
  }, [])

  const selectTheme = useCallback(async (id: string) => {
    await persistSelectedTheme(id)
    setSelectedThemeId(readLocalSelectedTheme())
  }, [])

  const setAutoApplyLiveops = useCallback(async (enabled: boolean) => {
    await window.electrobunAPI?.setSetting(LIVEOPS_AUTO_APPLY_SETTING, String(enabled))
    cachedAutoApplyLiveops = enabled
    setAutoApplyLiveopsState(enabled)
  }, [])

  const saveTheme = useCallback(async (theme: Theme) => {
    const file = await window.electrobunAPI?.saveLocalTheme?.(theme, serializeThemeCss(theme))
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
    if (selectedThemeId === id) await selectTheme(DEFAULT_THEME_ID)
    const theme = customThemes.find(item => item.id === id)
    if (theme?.localFile) await window.electrobunAPI?.deleteLocalTheme?.(theme.localFile)
    setCustomThemes((current) => {
      const next = current.filter((item) => item.id !== id)
      persistCustomThemes(next)
      return next
    })
  }, [customThemes, selectedThemeId, selectTheme])

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
    autoApplyLiveops,
    setAutoApplyLiveops,
    ready,
    localErrors,
    selectTheme,
    saveTheme,
    deleteTheme,
    copyTheme,
    makeTheme,
  }
}

const ThemeRegistryContext = createContext<ThemeRegistry | null>(null)

/** Один владелец IPC-подписок и применения CSS для лаунчера и настроек. */
export function ThemeRegistryProvider({ children }: PropsWithChildren) {
  const registry = useThemeRegistryState()
  return createElement(ThemeRegistryContext.Provider, { value: registry }, children)
}

export function useThemeRegistry(): ThemeRegistry {
  const registry = useContext(ThemeRegistryContext)
  if (!registry) throw new Error("useThemeRegistry must be used inside ThemeRegistryProvider")
  return registry
}
