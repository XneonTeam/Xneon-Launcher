import Editor from "react-simple-code-editor"
import Prism from "prismjs"
import { useEffect, useMemo, useState, type SetStateAction } from "react"
import { useTranslation } from "react-i18next"
import {
  IconAlertTriangle,
  IconCheck,
  IconCode,
  IconPalette,
  IconLayersIntersect,
  IconBorderOuter,
  IconBlur,
  IconLayoutSidebar,
  IconFolder,
  IconLoader2,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconTypography,
  IconVideo,
  IconX,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { ModalLayer } from "@/components/ui/modal-layer"
import { ActionConfirmDialog } from "@/components/launcher/instance/action-confirm-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Theme, ThemeBackground, ThemeColorKey, ThemeFont, ThemeGlow } from "./types"
import {
  applyTheme,
  BLUR_MAX,
  clampAlpha,
  DEFAULT_GLOW_ALPHA,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  isCustomThemeId,
  normalizeHex,
  parseThemeCss,
  serializeThemeCss,
  THEME_COLOR_GROUPS,
  THEME_COLOR_KEYS,
  THEME_GLOW_KEYS,
  themeGlow,
  themePreviewColors,
  themeMode,
} from "./theme-model"
import { ThemeAppearanceControls, ThemeAppearanceEffects, ThemeCssToggle } from "./theme-appearance-controls"
import { ThemeMiniPreview } from "./theme-preview"
import { themePaletteFromImage } from "./theme-from-image"

type GlowKey = (typeof THEME_GLOW_KEYS)[number]
type EditorMode = "visual" | "css"

interface ThemeEditorProps {
  initialTheme: Theme
  isNew: boolean
  themes: Theme[]
  onSave: (theme: Theme) => void
  onDelete?: (theme: Theme) => void
  onClose: () => void
}

const COLOR_GROUP_ICONS: Record<string, typeof IconPalette> = {
  accent: IconPalette,
  surfaces: IconLayersIntersect,
  text: IconTypography,
  borders: IconBorderOuter,
  sidebar: IconLayoutSidebar,
}

const PRESET_FONTS = [
  { labelKey: "themeEditor.font.system", value: "system-ui" },
  { label: "Plus Jakarta Sans", value: "Plus Jakarta Sans" },
  { label: "Sans-serif", value: "sans-serif" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "monospace" },
  { label: "Arial", value: "Arial" },
  { label: "Segoe UI", value: "Segoe UI" },
  { label: "Georgia", value: "Georgia" },
  { label: "Consolas", value: "Consolas" },
]

/** Полная палитра темы: у пресета палитры нет, поэтому недостающее берётся из тёмной базы. */
function paletteOf(theme: Theme): Record<ThemeColorKey, string> {
  return themePreviewColors(theme)
}

function hexMap(palette: Record<ThemeColorKey, string>): Record<ThemeColorKey, string> {
  const map = {} as Record<ThemeColorKey, string>
  for (const key of THEME_COLOR_KEYS) map[key] = palette[key]
  return map
}

/**
 * Черновик редактора: всегда с полной палитрой, свечениями, шрифтом и фоном,
 * чтобы живой предпросмотр и сохранение работали одинаково.
 */
function draftFrom(theme: Theme): Theme {
  const palette = paletteOf(theme)
  return {
    ...theme,
    id: theme.id,
    name: theme.name,
    primary: palette.primary,
    accent: palette.accent,
    palette: { ...palette },
    glow: {
      primary: themeGlow(theme, "primary"),
      accent: themeGlow(theme, "accent"),
    },
    font: theme.font ? { ...theme.font } : undefined,
    background: theme.background ? { ...theme.background } : undefined,
    css: theme.css,
    custom: true,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
  }
}

function sameGlow(a: ThemeGlow, b: ThemeGlow): boolean {
  return normalizeHex(a.color) === normalizeHex(b.color) && Math.abs(a.alpha - b.alpha) < 0.005
}

/** Визуальная часть темы, которую заменяет выбор основы и сброс к ней. */
function visualStateFrom(base: Theme): Pick<
  Theme,
  "baseThemeId" | "primary" | "accent" | "primaryOklch" | "accentOklch" | "palette" | "glow" |
  "font" | "background" | "css" | "readerCss" | "cssEnabled" | "appearance"
> {
  const colors = paletteOf(base)
  return {
    baseThemeId: base.id,
    primary: colors.primary,
    accent: colors.accent,
    primaryOklch: base.primaryOklch,
    accentOklch: base.accentOklch,
    palette: { ...colors },
    glow: { primary: themeGlow(base, "primary"), accent: themeGlow(base, "accent") },
    font: base.font ? { ...base.font } : undefined,
    background: base.background ? { ...base.background } : undefined,
    css: base.css,
    readerCss: base.readerCss,
    cssEnabled: base.cssEnabled,
    appearance: base.appearance
      ? {
          ...base.appearance,
          lightPalette: base.appearance.lightPalette ? { ...base.appearance.lightPalette } : undefined,
          darkPalette: base.appearance.darkPalette ? { ...base.appearance.darkPalette } : undefined,
        }
      : undefined,
  }
}

const swatchClass =
  "h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-border bg-muted/30 transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0"

const hexInputClass =
  "min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/40"

const ghostButtonClass =
  "flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"

/**
 * Редактор кастомной темы: визуальный режим и режим прямого редактирования CSS.
 * Поддерживает палитру, свечения, выбор шрифта/размера, фон из картинки/видео
 * и генерацию палитры по изображению.
 */
export function ThemeEditor({ initialTheme, isNew, themes, onSave, onDelete, onClose }: ThemeEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraftState] = useState<Theme>(() => draftFrom(initialTheme))
  const setDraft = (action: SetStateAction<Theme>) => setDraftState((current) => {
    const next = typeof action === "function" ? action(current) : action
    if (next.palette !== current.palette && next.appearance?.colorMode) {
      return { ...next, appearance: { ...next.appearance, [themeMode(next) === "light" ? "lightPalette" : "darkPalette"]: { ...next.palette } } }
    }
    return next
  })
  const [hexInputs, setHexInputs] = useState<Record<ThemeColorKey, string>>(() => hexMap(paletteOf(initialTheme)))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [fontBusy, setFontBusy] = useState(false)
  const [customFontEditing, setCustomFontEditing] = useState(false)
  const [customFontInput, setCustomFontInput] = useState("")
  const [fontError, setFontError] = useState<string | null>(null)

  // Переключение режима: визуальный или прямой CSS
  const [section, setSection] = useState("accent")
  const [mode, setMode] = useState<EditorMode>("visual")
  const [cssText, setCssText] = useState<string>(() => serializeThemeCss(draft))
  const [cssError, setCssError] = useState<string | null>(null)

  // Генерация палитры из изображения
  const [extractingPalette, setExtractingPalette] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

  useEffect(() => {
    setHexInputs(hexMap(paletteOf(draft)))
  }, [draft.appearance?.colorMode])

  const palette = paletteOf(draft)

  // Без явного background кнопка «Изображение» уже считается выбранной,
  // поэтому её поля должны быть видны сразу, а не появляться по повторному клику.
  const bgIsVideo = draft.background?.kind === "video"
  const bgIsMedia = !draft.background || draft.background.kind === "image" || bgIsVideo

  // Живой предпросмотр: каждое изменение черновика сразу попадает в документ
  useEffect(() => {
    applyTheme(draft)
  }, [draft])

  // Сохранённая основа не теряется после правки цветов. Для старых тем без
  // этого поля узнаём основу по палитре, а при отсутствии совпадения берём
  // первый пресет (стандартную тёмную тему).
  const baseId = useMemo(() => {
    if (draft.baseThemeId && themes.some((theme) => theme.id === draft.baseThemeId)) return draft.baseThemeId
    const colors = paletteOf(draft)
    const primaryGlow = themeGlow(draft, "primary")
    const accentGlow = themeGlow(draft, "accent")
    const match = themes.find((theme) => {
      if (theme.id === draft.id) return false
      const candidate = paletteOf(theme)
      if (THEME_COLOR_KEYS.some((key) => candidate[key] !== colors[key])) return false
      return sameGlow(themeGlow(theme, "primary"), primaryGlow) && sameGlow(themeGlow(theme, "accent"), accentGlow)
    })
    return match?.id ?? themes.find(theme => !theme.custom)?.id ?? themes.find(theme => theme.id !== draft.id)?.id ?? initialTheme.id
  }, [draft, themes, initialTheme.id])

  const canDelete = !isNew && isCustomThemeId(initialTheme.id) && !onDelete
  const nameEmpty = draft.name.trim().length === 0

  const isHexInvalid = (key: ThemeColorKey) => {
    const raw = (hexInputs[key] ?? "").trim()
    return raw.length > 0 && normalizeHex(raw) === null
  }

  const setColor = (key: ThemeColorKey, value: string) => {
    const hex = normalizeHex(value)
    if (!hex) return
    setDraft((current) => {
      const currentPalette = paletteOf(current)
      const previous = currentPalette[key]
      const nextPalette = { ...currentPalette, [key]: hex }
      const nextGlow = { ...current.glow }
      if (key === "primary" || key === "accent") {
        const glow = themeGlow(current, key)
        if (normalizeHex(glow.color) === normalizeHex(previous)) nextGlow[key] = { ...glow, color: hex }
      }
      return {
        ...current,
        primary: nextPalette.primary,
        accent: nextPalette.accent,
        palette: nextPalette,
        glow: nextGlow,
      }
    })
    setHexInputs((current) => ({ ...current, [key]: hex }))
  }

  const onHexInput = (key: ThemeColorKey, raw: string) => {
    setHexInputs((current) => ({ ...current, [key]: raw }))
    const hex = normalizeHex(raw)
    if (hex) setColor(key, hex)
  }

  const onHexBlur = (key: ThemeColorKey) => {
    const current = paletteOf(draft)
    setHexInputs((map) => ({ ...map, [key]: current[key] }))
  }

  const renderColorGroup = (group: (typeof THEME_COLOR_GROUPS)[number]) => {
    const GroupIcon = COLOR_GROUP_ICONS[group.id] ?? IconPalette
    return <section data-ui="settings-theme-editor-section-3" key={group.id} className="rounded-2xl border border-border bg-muted/15 p-4">
      <h4 data-ui="settings-theme-editor-h4-3" className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <GroupIcon className="h-4 w-4 text-primary" strokeWidth={1.75} />{t(group.labelKey)}
      </h4>
      <div data-ui="settings-theme-editor-div-28" className="grid gap-2 sm:grid-cols-2">
        {group.keys.map((key) => {
          const label = t(`themeEditor.vars.${key}`)
          const invalid = isHexInvalid(key)
          return <div data-ui="settings-theme-editor-div-29" key={key} className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 p-2">
            <input data-ui="settings-theme-editor-input-8" type="color" value={palette[key]} onChange={(event) => setColor(key, event.target.value)} aria-label={label} title={label} className={swatchClass} />
            <div data-ui="settings-theme-editor-div-30" className="min-w-0 flex-1">
              <div data-ui="settings-theme-editor-div-31" className="truncate text-[11px] font-medium text-foreground">{label}</div>
              <input data-ui="settings-theme-editor-input-9" value={hexInputs[key] ?? ""} onChange={(event) => onHexInput(key, event.target.value)} onBlur={() => onHexBlur(key)} spellCheck={false} aria-label={`${label} — ${t("themeEditor.hex")}`} aria-invalid={invalid} placeholder="#000000" className={cn(hexInputClass, "mt-1", invalid && "border-destructive/60 text-destructive focus:border-destructive focus:ring-destructive/40")} />
            </div>
          </div>
        })}
      </div>
    </section>
  }

  const setGlow = (key: GlowKey, patch: Partial<ThemeGlow>) => {
    setDraft((current) => {
      const base = themeGlow(current, key)
      return { ...current, glow: { ...current.glow, [key]: { ...base, ...patch } } }
    })
  }

  // Шрифт
  const setFont = (patch: Partial<ThemeFont>) => {
    setDraft((current) => {
      const nextFont = { ...(current.font ?? {}), ...patch }
      if ("family" in patch && patch.family !== "XneonThemeFont") delete nextFont.source
      if (nextFont.family !== undefined && !nextFont.family.trim()) delete nextFont.family
      return {
        ...current,
        font: Object.keys(nextFont).length > 0 ? nextFont : undefined,
      }
    })
  }

  const handlePickFontFile = async () => {
    setFontBusy(true)
    setFontError(null)
    try {
      const media = await window.electronAPI?.pickThemeMedia("font")
      if (media) {
        setCustomFontEditing(false)
        setCustomFontInput("")
        setFont({ family: "XneonThemeFont", source: media.source })
      }
    } catch {
      setFontError(t("themeAdvanced.fileError"))
    } finally {
      setFontBusy(false)
    }
  }

  // Фон
  const setBackground = (patch: Partial<ThemeBackground>) => {
    setDraft((current) => {
      const currentBg = current.background ?? {
        kind: "image",
        source: "",
        dim: 0,
        blur: 0,
        opacity: 1,
      }
      return {
        ...current,
        background: { ...currentBg, ...patch },
      }
    })
  }

  const clearBackground = () => {
    setDraft((current) => ({ ...current, background: undefined }))
    setExtractError(null)
  }

  const handlePickBgFile = async () => {
    const kind = draft.background?.kind ?? "image"
    if (kind !== "image" && kind !== "video") return
    try {
      const picked = await window.electronAPI?.pickThemeMedia(kind)
      if (picked) {
        setBackground({ source: picked.source })
        setExtractError(null)
      }
    } catch { setExtractError(t("themeAdvanced.fileError")) }
  }

  const handleExtractPalette = async () => {
    const source = draft.background?.source?.trim()
    if (!source) return
    setExtractingPalette(true)
    setExtractError(null)
    try {
      const extracted = await themePaletteFromImage(source, { kind: draft.background?.kind === "video" ? "video" : "image" })
      if (!extracted || Object.keys(extracted).length === 0) {
        setExtractError(t(draft.background?.kind === "video" ? "themeEditor.paletteFromVideoFailed" : "themeEditor.paletteFromImageFailed"))
        return
      }
      setDraft((curr) => {
        const nextPalette = { ...paletteOf(curr), ...extracted }
        const primary = extracted.primary ?? curr.primary
        const accent = extracted.accent ?? curr.accent
        return {
          ...curr,
          primary,
          accent,
          palette: nextPalette,
          glow: {
            primary: { color: primary, alpha: curr.glow?.primary?.alpha ?? DEFAULT_GLOW_ALPHA },
            accent: { color: accent, alpha: curr.glow?.accent?.alpha ?? DEFAULT_GLOW_ALPHA },
          },
        }
      })
      setHexInputs((prev) => ({ ...prev, ...(extracted as Record<ThemeColorKey, string>) }))
    } catch {
      setExtractError(t(draft.background?.kind === "video" ? "themeEditor.paletteFromVideoFailed" : "themeEditor.paletteFromImageFailed"))
    } finally {
      setExtractingPalette(false)
    }
  }

  // Режим CSS
  const handleSwitchMode = (target: EditorMode) => {
    if (target === mode) return
    if (target === "css") {
      setCssText(serializeThemeCss(draft))
      setCssError(null)
      setMode("css")
    } else {
      const parsed = parseThemeCss(cssText, draft)
      if (!parsed) {
        setCssError(t("themeEditor.css.invalid"))
        return
      }
      if (parsed) {
        setDraft(parsed)
        setHexInputs(hexMap(paletteOf(parsed)))
        setCssError(null)
      }
      setMode("visual")
    }
  }

  const handleApplyCss = () => {
    const parsed = parseThemeCss(cssText, draft)
    if (!parsed) {
      setCssError(t("themeEditor.css.invalid"))
      return
    }
    setCssError(null)
    setDraft(parsed)
    setHexInputs(hexMap(paletteOf(parsed)))
    applyTheme(parsed)
  }

  const applyBase = (id: string) => {
    const base = themes.find((theme) => theme.id === id)
    if (!base) return
    const colors = paletteOf(base)
    // Основа уже содержит согласованные light/dark палитры, поэтому не
    // прогоняем её через синхронизацию правки одного активного режима.
    setDraftState((current) => ({
      ...current,
      ...visualStateFrom(base),
    }))
    setCustomFontEditing(false)
    setCustomFontInput("")
    setHexInputs(hexMap(colors))
    setCssText(serializeThemeCss(base))
    setExtractError(null)
    setCssError(null)
  }

  const resetToBase = () => applyBase(baseId)

  const buildTheme = (base: Theme = draft): Theme => {
    const colors = paletteOf(base)
    const now = Date.now()
    return {
      ...base,
      id: isNew ? base.id : initialTheme.id,
      name: base.name.trim() || t("themeEditor.namePlaceholder"),
      primary: colors.primary,
      accent: colors.accent,
      palette: { ...colors },
      glow: { primary: themeGlow(base, "primary"), accent: themeGlow(base, "accent") },
      font: base.font,
      background: base.background,
      css: base.css,
      custom: true,
      createdAt: initialTheme.createdAt ?? base.createdAt ?? now,
      updatedAt: now,
    }
  }

  const handleSave = () => {
    // В CSS-режиме: текст могли набрать и не нажать «Применить» — сохраняем
    // его, иначе набранный CSS молча теряется при сохранении темы.
    if (mode === "css") {
      const parsed = parseThemeCss(cssText, draft)
      if (!parsed) {
        setCssError(t("themeEditor.css.invalid"))
        return
      }
      onSave(buildTheme(parsed))
      return
    }
    onSave(buildTheme())
  }

  const currentFontFamily = draft.font?.family ?? (draft.font?.source ? "XneonThemeFont" : "Plus Jakarta Sans")
  const currentFontSize = draft.font?.size ?? FONT_SIZE_DEFAULT
  const isCustomFontFamily = !PRESET_FONTS.some((f) => f.value === currentFontFamily)

  return (
    <ModalLayer windowId="settings-theme-editor-window-1" onClose={onClose} className="animate-in fade-in-0 px-3 pb-3 pt-10">
      <div data-ui="settings-theme-editor-div-1" data-component="theme-editor" data-mode={mode} data-tab={section} className="flex h-[min(680px,calc(100dvh-3.25rem))] max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
        {/* Заголовок с переключателем режимов Visual / CSS */}
        <div data-ui="settings-theme-editor-div-2" className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
          <div data-ui="settings-theme-editor-div-3" className="flex min-w-0 items-center gap-3">
            <span data-ui="settings-theme-editor-span-1" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <IconPalette className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div data-ui="settings-theme-editor-div-4" className="min-w-0">
              <h3 data-ui="settings-theme-editor-h3-1" className="truncate text-base font-semibold text-foreground">
                {isNew ? t("themeEditor.titleNew") : t("themeEditor.titleEdit")}
              </h3>
              <p data-ui="settings-theme-editor-p-1" className="truncate text-xs text-muted-foreground">{draft.name}</p>
            </div>
          </div>

          <div data-ui="settings-theme-editor-div-5" className="flex shrink-0 items-center gap-2">
            {/* Переключатель режимов Визуально / CSS */}
            <div data-ui="settings-theme-editor-div-6" className="flex items-center rounded-xl border border-border bg-muted/40 p-1">
              <button data-ui="settings-theme-editor-button-1"
                type="button"
                onClick={() => handleSwitchMode("visual")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                  mode === "visual"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <IconPalette className="h-3.5 w-3.5" />
                {t("themeEditor.mode.visual")}
              </button>
              <button data-ui="settings-theme-editor-button-2"
                type="button"
                onClick={() => handleSwitchMode("css")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                  mode === "css"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <IconCode className="h-3.5 w-3.5" />
                {t("themeEditor.mode.css")}
              </button>
            </div>

            <button data-ui="settings-theme-editor-button-3"
              type="button"
              onClick={onClose}
              aria-label={t("themeEditor.cancel")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <IconX className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Тело редактора */}
        <div data-ui="settings-theme-editor-div-7" className="min-h-0 flex-1 overflow-y-auto p-4">
          <div data-ui="settings-theme-editor-div-8" className="space-y-3">
            {/* Имя темы и база */}
            <div data-ui="settings-theme-editor-div-9" className="grid gap-3 sm:grid-cols-2">
              <label data-ui="settings-theme-editor-label-1" className="flex flex-col gap-1.5">
                <span data-ui="settings-theme-editor-span-2" className="text-xs font-medium text-muted-foreground">{t("themeEditor.name")}</span>
                <input data-ui="settings-theme-editor-input-1"
                  autoFocus
                  value={draft.name}
                  maxLength={60}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t("themeEditor.namePlaceholder")}
                  className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
              </label>

              <label data-ui="settings-theme-editor-label-2" className="flex flex-col gap-1.5">
                <span data-ui="settings-theme-editor-span-3" className="text-xs font-medium text-muted-foreground">{t("themeEditor.base")}</span>
                <Select
                  value={baseId}
                  onValueChange={(value) => applyBase(value)}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-border bg-muted/40 text-foreground">
                    <SelectValue placeholder={t("themeEditor.basePlaceholder")}>
                      {baseId
                        ? (() => {
                            const theme = themes.find((item) => item.id === baseId)
                            if (!theme) return null
                            return (
                              <span data-ui="settings-theme-editor-span-4" className="flex min-w-0 items-center gap-2.5">
                                <ThemeMiniPreview theme={theme} />
                                <span data-ui="settings-theme-editor-span-5" className="truncate">{theme.name}</span>
                              </span>
                            )
                          })()
                        : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {themes.map((theme) => (
                      <SelectItem key={theme.id} value={theme.id} textValue={theme.name}>
                        <span data-ui="settings-theme-editor-span-6" className="flex min-w-0 items-center gap-2.5">
                          {/* Миниатюра темы прямо в пункте: видно палитру до применения. */}
                          <ThemeMiniPreview theme={theme} />
                          <span data-ui="settings-theme-editor-span-7" className="truncate">{theme.name}</span>
                          {theme.custom && (
                            <span data-ui="settings-theme-editor-span-8" className="shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {t("settings.themes.customBadge")}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("themeEditor.description")}</span>
              <textarea
                value={draft.description || ""}
                maxLength={240}
                rows={2}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder={t("themeEditor.descriptionPlaceholder")}
                className="w-full resize-y rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
            </label>

            {mode === "visual" && (
              <nav data-ui="settings-theme-editor-nav-1" aria-label={t("themeEditor.mode.visual")} className="grid grid-cols-2 gap-1 rounded-xl bg-muted/30 p-1 sm:grid-cols-4">
                {[
                  ...THEME_COLOR_GROUPS.filter((group) => group.id !== "text").map((group) => ({ ...group, icon: COLOR_GROUP_ICONS[group.id] ?? IconPalette })),
                  { id: "text", labelKey: "themeEditor.sections.text", icon: IconTypography },
                  { id: "background", labelKey: "themeEditor.sections.background", icon: IconPhoto },
                  { id: "effects", labelKey: "themeAdvanced.effectsTitle", icon: IconBlur },
                  { id: "glow", labelKey: "themeEditor.groups.glow", icon: IconSparkles },
                ].map((item) => (
                  <button data-ui="settings-theme-editor-button-4" key={item.id} type="button" aria-pressed={section === item.id} onClick={() => setSection(item.id)}
                    className={cn("flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors", section === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                    <item.icon className="h-4 w-4 shrink-0" /><span data-ui="settings-theme-editor-span-9">{t(item.labelKey)}</span>
                  </button>
                ))}
              </nav>
            )}
            {mode === "visual" ? (
              <>
                <ThemeAppearanceControls theme={draft} onChange={setDraft} active={section === "surfaces"} />
                <ThemeAppearanceEffects theme={draft} onChange={setDraft} active={section === "effects"} />
                {/* Секция: Шрифт (гарнитура и размер) */}
                <section data-ui="settings-theme-editor-section-1" hidden={section !== "text"} className="rounded-2xl border border-border bg-muted/15 p-4">
                  <h4 data-ui="settings-theme-editor-h4-1" className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <IconTypography className="h-4 w-4 text-primary" strokeWidth={1.75} />
                    {t("themeEditor.sections.font")}
                  </h4>
                  <div data-ui="settings-theme-editor-div-10" className="grid gap-3 sm:grid-cols-2">
                    <div data-ui="settings-theme-editor-div-11" className="space-y-1.5">
                      <span data-ui="settings-theme-editor-span-10" className="text-xs font-medium text-foreground">{t("themeEditor.font.family")}</span>
                      <Select
                        value={isCustomFontFamily || customFontEditing ? "__custom__" : currentFontFamily || "__system__"}
                        onValueChange={(val) => {
                          if (val === "__custom__") {
                            setCustomFontInput(isCustomFontFamily ? currentFontFamily : "")
                            setCustomFontEditing(true)
                            return
                          }
                          setCustomFontEditing(false)
                          // Radix не принимает пустое значение, поэтому системный
                          // шрифт помечен служебным маркером.
                          setFont({ family: val === "__system__" ? undefined : val })
                        }}
                      >
                        <SelectTrigger className="h-10 w-full rounded-xl border-border bg-muted/40 text-foreground">
                          <SelectValue>
                            {isCustomFontFamily
                              ? `${t("themeEditor.font.custom")}: ${currentFontFamily}`
                              : currentFontFamily
                                ? (PRESET_FONTS.find((font) => font.value === currentFontFamily)?.labelKey
                                    ? t(PRESET_FONTS.find((font) => font.value === currentFontFamily)!.labelKey as string)
                                    : PRESET_FONTS.find((font) => font.value === currentFontFamily)?.label)
                                : t("themeEditor.font.system")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {PRESET_FONTS.map((font) => (
                            <SelectItem
                              key={font.value}
                              value={font.value || "__system__"}
                              textValue={"labelKey" in font && font.labelKey ? t(font.labelKey) : font.label}
                            >
                              {"labelKey" in font && font.labelKey ? t(font.labelKey) : font.label}
                            </SelectItem>
                          ))}
                          <SelectItem value="__custom__" textValue={t("themeEditor.font.custom")}>
                            {isCustomFontFamily
                              ? `${t("themeEditor.font.custom")}: ${currentFontFamily}`
                              : t("themeEditor.font.other")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {(isCustomFontFamily || customFontEditing) && (
                        <input data-ui="settings-theme-editor-input-2"
                          value={customFontEditing ? customFontInput : currentFontFamily}
                          onChange={(e) => { setCustomFontEditing(true); setCustomFontInput(e.target.value); setFont({ family: e.target.value }) }}
                          placeholder={t("themeEditor.font.customPlaceholder")}
                          className="mt-1 w-full rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
                        />
                      )}
                    </div>

                    <div data-ui="settings-theme-editor-div-12" className="space-y-1.5">
                      <div data-ui="settings-theme-editor-div-13" className="flex items-center justify-between">
                        <span data-ui="settings-theme-editor-span-11" className="text-xs font-medium text-foreground">{t("themeEditor.font.size")}</span>
                        <span data-ui="settings-theme-editor-span-12" className="text-xs font-mono text-muted-foreground">{currentFontSize}px</span>
                      </div>
                      <div data-ui="settings-theme-editor-div-14" className="flex items-center gap-2 pt-1.5">
                        <span data-ui="settings-theme-editor-span-13" className="text-[10px] text-muted-foreground">{FONT_SIZE_MIN}px</span>
                        <input data-ui="settings-theme-editor-input-3"
                          type="range"
                          min={FONT_SIZE_MIN}
                          max={FONT_SIZE_MAX}
                          step={1}
                          value={currentFontSize}
                          onChange={(e) => setFont({ size: Number(e.target.value) })}
                          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        />
                        <span data-ui="settings-theme-editor-span-14" className="text-[10px] text-muted-foreground">{FONT_SIZE_MAX}px</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 rounded-xl border border-border bg-card/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button data-ui="theme-load-font" disabled={fontBusy} className={cn(ghostButtonClass, "text-foreground")} type="button" onClick={() => void handlePickFontFile()}>
                        {fontBusy ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconFolder className="h-3.5 w-3.5 text-primary" />}
                        {t(draft.font?.source ? "themeAdvanced.fontLoaded" : "themeAdvanced.fontFile")}
                      </button>
                      {draft.font?.source && <button data-ui="theme-remove-font" type="button" className={ghostButtonClass} onClick={() => setFont({ family: undefined, source: undefined })}>
                        <IconTrash className="h-3.5 w-3.5" />{t("themeAdvanced.removeFont")}
                      </button>}
                    </div>
                    {fontError && <p role="alert" className="text-xs text-destructive">{fontError}</p>}
                  </div>
                </section>

                {/* Секция: Фон (изображение / видео, стилизация, палитра из картинки) */}
                <section data-ui="settings-theme-editor-section-2" hidden={section !== "background"} className="rounded-2xl border border-border bg-muted/15 p-4">
                  <div data-ui="settings-theme-editor-div-15" className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 data-ui="settings-theme-editor-h4-2" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {draft.background?.kind === "video" ? (
                        <IconVideo className="h-4 w-4 text-primary" strokeWidth={1.75} />
                      ) : (
                        <IconPhoto className="h-4 w-4 text-primary" strokeWidth={1.75} />
                      )}
                      {t("themeEditor.sections.background")}
                    </h4>
                    {draft.background && (!!draft.background.source || ["particles", "halo"].includes(draft.background.kind)) && (
                      <button data-ui="settings-theme-editor-button-5"
                        type="button"
                        onClick={clearBackground}
                        className="flex items-center gap-1 text-[11px] text-destructive hover:underline"
                      >
                        <IconTrash className="h-3 w-3" />
                        {t("themeEditor.background.clear")}
                      </button>
                    )}
                  </div>

                  <div data-ui="settings-theme-editor-div-16" className="space-y-3">
                    {/* Переключатель: Картинка / Видео */}
                    <div data-ui="settings-theme-editor-div-17" className="flex items-center gap-2">
                      <button data-ui="settings-theme-editor-button-6"
                        type="button"
                        onClick={() => setBackground({ kind: "image", source: draft.background?.kind === "image" ? draft.background.source : "" })}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                          (!draft.background || draft.background.kind === "image")
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border bg-card/40 text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <IconPhoto className="h-3.5 w-3.5" />
                        {t("themeEditor.background.image")}
                      </button>
                      <button data-ui="settings-theme-editor-button-7"
                        type="button"
                        onClick={() => setBackground({ kind: "video", source: draft.background?.kind === "video" ? draft.background.source : "" })}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                          draft.background?.kind === "video"
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border bg-card/40 text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <IconVideo className="h-3.5 w-3.5" />
                        {t("themeEditor.background.video")}
                      </button>
                    </div>

                    {bgIsMedia && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs text-muted-foreground">
                          <span>{t("themeAdvanced.fit")}</span>
                          <Select value={draft.background?.fit ?? "cover"} onValueChange={(value) => setBackground({ fit: value as "cover" | "contain" })}>
                            <SelectTrigger className="h-10 w-full rounded-xl border-border bg-muted/40 text-xs text-foreground"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(["cover", "contain"] as const).map((value) => <SelectItem key={value} value={value}>{t(`themeAdvanced.fit.${value}`)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </label>
                        {bgIsVideo && (
                          <label className="space-y-2 text-xs text-muted-foreground">
                            <span className="flex justify-between"><span>{t("themeAdvanced.videoVolume")}</span><span>{Math.round((draft.background?.volume ?? 0) * 100)}%</span></span>
                            <input type="range" min={0} max={1} step={0.01} value={draft.background?.volume ?? 0} onChange={(event) => setBackground({ volume: Number(event.target.value) })} className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary" />
                          </label>
                        )}
                      </div>
                    )}

                    {/* Выбор файла или ввод URL */}
                    {bgIsMedia && <div data-ui="settings-theme-editor-div-18" className="flex items-center gap-2">
                      <input data-ui="settings-theme-editor-input-4"
                        value={draft.background?.source ?? ""}
                        onChange={(e) => setBackground({ source: e.target.value })}
                        placeholder={t(bgIsVideo ? "themeEditor.background.urlPlaceholder" : "themeEditor.background.urlPlaceholderImage")}
                        className="min-w-0 flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/40"
                      />
                      <button data-ui="settings-theme-editor-button-8"
                        type="button"
                        onClick={handlePickBgFile}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <IconFolder className="h-3.5 w-3.5 text-primary" />
                        {t("themeEditor.background.pickFile")}
                      </button>
                    </div>}

                    {/* Эффекты фона и генерация палитры (когда источник задан) */}
                    {draft.background?.source && (
                      <div data-ui="settings-theme-editor-div-19" className="space-y-3 pt-2">
                        {/* Кнопка "Взять цвета из картинки" */}
                        <div data-ui="settings-theme-editor-div-20" className="flex flex-wrap items-center gap-2" hidden={!draft.background?.source || ["particles", "halo"].includes(draft.background.kind)}>
                          <button data-ui="settings-theme-editor-button-9"
                            type="button"
                            onClick={handleExtractPalette}
                            disabled={extractingPalette}
                            className={cn(
                              "flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20",
                              "disabled:cursor-not-allowed disabled:opacity-50"
                            )}
                          >
                            {extractingPalette ? (
                              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <IconSparkles className="h-3.5 w-3.5" />
                            )}
                            {extractingPalette
                              ? t("themeEditor.paletteFromImageBusy")
                              : t(draft.background.kind === "video" ? "themeEditor.paletteFromVideo" : "themeEditor.paletteFromImage")}
                          </button>
                          {extractError && (
                            <span data-ui="settings-theme-editor-span-15" className="text-[11px] text-destructive">{extractError}</span>
                          )}
                        </div>

                        {/* Ползунки: Затемнение, Размытие, Прозрачность */}
                        <div data-ui="settings-theme-editor-div-21" className="grid gap-3 sm:grid-cols-3">
                          <div data-ui="settings-theme-editor-div-22" className="rounded-xl border border-border/70 bg-card/40 p-2.5">
                            <div data-ui="settings-theme-editor-div-23" className="flex items-center justify-between text-[11px]">
                              <span data-ui="settings-theme-editor-span-16" className="text-muted-foreground">{t("themeEditor.background.dim")}</span>
                              <span data-ui="settings-theme-editor-span-17" className="font-mono text-foreground">
                                {Math.round((draft.background?.dim ?? 0) * 100)}%
                              </span>
                            </div>
                            <input data-ui="settings-theme-editor-input-5"
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={draft.background?.dim ?? 0}
                              onChange={(e) => setBackground({ dim: Number(e.target.value) })}
                              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                            />
                          </div>

                          <div data-ui="settings-theme-editor-div-24" className="rounded-xl border border-border/70 bg-card/40 p-2.5">
                            <div data-ui="settings-theme-editor-div-25" className="flex items-center justify-between text-[11px]">
                              <span data-ui="settings-theme-editor-span-18" className="text-muted-foreground">{t("themeEditor.background.blur")}</span>
                              <span data-ui="settings-theme-editor-span-19" className="font-mono text-foreground">{draft.background?.blur ?? 0}px</span>
                            </div>
                            <input data-ui="settings-theme-editor-input-6"
                              type="range"
                              min={0}
                              max={BLUR_MAX}
                              step={1}
                              value={draft.background?.blur ?? 0}
                              onChange={(e) => setBackground({ blur: Number(e.target.value) })}
                              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                            />
                          </div>

                          <div data-ui="settings-theme-editor-div-26" className="rounded-xl border border-border/70 bg-card/40 p-2.5">
                            <div data-ui="settings-theme-editor-div-27" className="flex items-center justify-between text-[11px]">
                              <span data-ui="settings-theme-editor-span-20" className="text-muted-foreground">{t("themeEditor.background.opacity")}</span>
                              <span data-ui="settings-theme-editor-span-21" className="font-mono text-foreground">
                                {Math.round((draft.background?.opacity ?? 1) * 100)}%
                              </span>
                            </div>
                            <input data-ui="settings-theme-editor-input-7"
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={draft.background?.opacity ?? 1}
                              onChange={(e) => setBackground({ opacity: Number(e.target.value) })}
                              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Группы цветов палитры */}
                {THEME_COLOR_GROUPS.filter((group) => group.id !== "text").map((group) => <div key={group.id} hidden={section !== group.id}>{renderColorGroup(group)}</div>)}
                <div hidden={section !== "text"} className="space-y-3">
                  {THEME_COLOR_GROUPS.filter((group) => group.id === "text").map(renderColorGroup)}
                </div>

                {/* Свечения акцентов */}
                <section data-ui="settings-theme-editor-section-4" hidden={section !== "glow"} className="rounded-2xl border border-border bg-muted/15 p-4">
                  <h4 data-ui="settings-theme-editor-h4-4" className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <IconSparkles className="h-4 w-4 text-primary" strokeWidth={1.75} />
                    {t("themeEditor.groups.glow")}
                  </h4>
                  <div data-ui="settings-theme-editor-div-32" className="grid gap-2 sm:grid-cols-2">
                    {THEME_GLOW_KEYS.map((key) => {
                      const glow = themeGlow(draft, key)
                      const label = t(`themeEditor.glow.${key}`)
                      const alphaLabel = `${Math.round(glow.alpha * 100)}%`
                      return (
                        <div data-ui="settings-theme-editor-div-33" key={key} className="rounded-xl border border-border/70 bg-card/40 p-3">
                          <div data-ui="settings-theme-editor-div-34" className="flex items-center gap-2">
                            <input data-ui="settings-theme-editor-input-10"
                              type="color"
                              value={glow.color}
                              onChange={(event) =>
                                setGlow(key, { color: normalizeHex(event.target.value) ?? glow.color })
                              }
                              aria-label={label}
                              title={label}
                              className={swatchClass}
                            />
                            <span data-ui="settings-theme-editor-span-22" className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{label}</span>
                            <span data-ui="settings-theme-editor-span-23" className="shrink-0 text-xs tabular-nums text-muted-foreground">{alphaLabel}</span>
                          </div>
                          <div data-ui="settings-theme-editor-div-35" className="mt-3 flex items-center gap-2">
                            <span data-ui="settings-theme-editor-span-24" className="shrink-0 text-[11px] text-muted-foreground">
                              {t("themeEditor.glow.alpha")}
                            </span>
                            <input data-ui="settings-theme-editor-input-11"
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={glow.alpha}
                              onChange={(event) => setGlow(key, { alpha: clampAlpha(event.target.value) })}
                              aria-label={`${label} — ${t("themeEditor.glow.alpha")}`}
                              aria-valuetext={alphaLabel}
                              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                            />
                          </div>
                          <div data-ui="settings-theme-editor-div-36"
                            className="mt-3 h-6 rounded-lg border border-border/60"
                            style={{
                              background: `radial-gradient(circle at 50% 50%, ${glow.color} 0%, transparent 72%)`,
                              opacity: glow.alpha,
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </section>
              </>
            ) : (
              /* Режим CSS */
              <section data-ui="settings-theme-editor-section-5" className="space-y-3 rounded-2xl border border-border bg-muted/15 p-4">
                <ThemeCssToggle enabled={draft.cssEnabled !== false} onEnabled={(value) => setDraft((current) => ({ ...current, cssEnabled: value }))} />
                <div data-ui="settings-theme-editor-div-37" className="flex flex-wrap items-start justify-between gap-2">
                  <div data-ui="settings-theme-editor-div-38" className="min-w-0 space-y-1">
                    <p data-ui="settings-theme-editor-p-2" className="text-xs text-muted-foreground">{t("themeEditor.css.hint")}</p>
                    <p data-ui="settings-theme-editor-p-3" className="text-[11px] text-muted-foreground/80">{t("themeEditor.css.hintStructure")}</p>
                  </div>
                  <button data-ui="theme-editor-inspect" type="button"
                    onClick={() => window.dispatchEvent(new Event("theme-inspector:toggle"))}
                    className={ghostButtonClass}>
                    <IconCode className="h-3.5 w-3.5" />
                    {t("themeInspector.title")}
                  </button>
                  <button data-ui="settings-theme-editor-button-10"
                    type="button"
                    onClick={handleApplyCss}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <IconCheck className="h-3.5 w-3.5" />
                    {t("themeEditor.css.apply")}
                  </button>
                </div>

                {cssError && (
                  <div data-ui="settings-theme-editor-div-39" className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                    <IconAlertTriangle className="h-4 w-4 shrink-0" />
                    <span data-ui="settings-theme-editor-span-25">{cssError}</span>
                  </div>
                )}

                <div data-ui="settings-theme-editor-div-40" className="max-h-[calc(100dvh-22rem)] min-h-40 overflow-auto rounded-xl border border-border bg-muted/30 focus-within:border-primary">
                <Editor
                  value={cssText}
                  onValueChange={setCssText}
                  highlight={(code) => Prism.highlight(code, Prism.languages.css, "css")}
                  padding={12}
                  textareaId="theme-css-editor"
                  textareaClassName="outline-none focus:outline-none"
                  aria-label={t("themeEditor.mode.css")}
                  style={{ fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 12, lineHeight: 1.6, minHeight: 240 }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault()
                      handleApplyCss()
                    }
                  }}
                  spellCheck={false}
                  className="theme-code-editor text-foreground"
                />
                </div>
              </section>
            )}
          </div>

        </div>

        {/* Футер */}
        <div data-ui="settings-theme-editor-div-41" className="shrink-0 border-t border-border px-4 py-3">
          {!confirmDelete ? (
            <div data-ui="settings-theme-editor-div-44" className="flex flex-wrap items-center justify-between gap-3">
              <button data-ui="settings-theme-editor-button-13" type="button" onClick={resetToBase} className={ghostButtonClass}>
                <IconRefresh className="h-4 w-4" strokeWidth={1.75} />
                {t("themeEditor.reset")}
              </button>
              <div data-ui="settings-theme-editor-div-45" className="flex flex-wrap items-center gap-2">
                {canDelete && (
                  <button data-ui="settings-theme-editor-button-14"
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60"
                  >
                    <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                    {t("themeEditor.delete")}
                  </button>
                )}
                <button data-ui="settings-theme-editor-button-15" type="button" onClick={onClose} className={ghostButtonClass}>
                  {t("themeEditor.cancel")}
                </button>
                <button data-ui="settings-theme-editor-button-16"
                  type="button"
                  onClick={handleSave}
                  disabled={nameEmpty}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                >
                  <IconCheck className="h-4 w-4" strokeWidth={2.25} />
                  {t("themeEditor.save")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <ActionConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => onDelete?.(buildTheme())}
        title={t("settings.themes.deleteConfirmTitle")}
        description={t("settings.themes.deleteConfirm", { name: draft.name })}
        confirmText={t("themeEditor.delete")}
        cancelText={t("themeEditor.cancel")}
        variant="danger"
        icon="warning"
      />
    </ModalLayer>
  )
}
