import type { Theme, ThemeBackground, ThemeColorKey, ThemeFont, ThemeGlow } from "./types"

/**
 * Модель кастомных тем.
 *
 * Встроенные пресеты меняют только два акцента, поэтому у них нет палитры.
 * Кастомная тема описывает всю палитру целиком: фон окна, поверхности, текст,
 * границы, боковую панель и свечение. Здесь же живёт единственная функция,
 * которая применяет тему к документу, — `applyTheme`, и все помощники, которые
 * нужны и редактору, и хранению, и миниатюрам.
 */

/** Порядок важен: он же порядок в редакторе и в превью. */
export const THEME_COLOR_KEYS: ThemeColorKey[] = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "muted",
  "mutedForeground",
  "border",
  "input",
  "primary",
  "primaryForeground",
  "accent",
  "accentForeground",
  "ring",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
]

/** Соответствие ключа палитры и CSS-переменной из `src/index.css`. */
export const THEME_CSS_VARS: Record<ThemeColorKey, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  border: "--border",
  input: "--input",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
}

/** Группы редактора: подписи берутся из i18n (`themeEditor.groups.*`). */
export const THEME_COLOR_GROUPS: { id: string; labelKey: string; keys: ThemeColorKey[] }[] = [
  {
    id: "accent",
    labelKey: "themeEditor.groups.accent",
    keys: ["primary", "primaryForeground", "accent", "accentForeground", "ring"],
  },
  {
    id: "surfaces",
    labelKey: "themeEditor.groups.surfaces",
    keys: ["background", "card", "cardForeground", "muted"],
  },
  { id: "text", labelKey: "themeEditor.groups.text", keys: ["foreground", "mutedForeground"] },
  { id: "borders", labelKey: "themeEditor.groups.borders", keys: ["border", "input"] },
  {
    id: "sidebar",
    labelKey: "themeEditor.groups.sidebar",
    keys: [
      "sidebar",
      "sidebarForeground",
      "sidebarPrimary",
      "sidebarPrimaryForeground",
      "sidebarAccent",
      "sidebarAccentForeground",
      "sidebarBorder",
    ],
  },
]

export const THEME_GLOW_KEYS = ["primary", "accent"] as const
export type ThemeGlowKey = (typeof THEME_GLOW_KEYS)[number]

export const DEFAULT_GLOW_ALPHA = 0.4
const SEMANTIC_COLOR_TOKENS = {
  error: ["red", "rose"], warning: ["yellow", "amber"], info: ["blue", "sky"], success: ["green", "emerald"],
} as const
const SEMANTIC_DEFAULTS = { error: "var(--primary)", warning: "var(--accent)", info: "var(--primary)", success: "var(--accent)" } as const
const semanticCssVars = Object.values(SEMANTIC_COLOR_TOKENS).flatMap((colors) => colors.flatMap((color) => [300, 400, 500, 600, 700].map((shade) => `--color-${color}-${shade}`)))

// Всплывающие панели и второстепенные поверхности следуют общей палитре.
// Ссылки через var() сохраняют возможность менять их пользовательским CSS.
const SURFACE_ALIASES: Record<string, string> = {
  "--popover": "var(--card)",
  "--popover-foreground": "var(--card-foreground)",
  "--secondary": "var(--muted)",
  "--secondary-foreground": "var(--foreground)",
  "--glass": "color-mix(in oklab, var(--card) 60%, transparent)",
  "--glass-border": "color-mix(in oklab, var(--border) 30%, transparent)",
  "--chart-1": "var(--primary)",
  "--chart-2": "var(--accent)",
  "--chart-3": "var(--sidebar-primary)",
  "--chart-4": "var(--sidebar-accent)",
  "--chart-5": "var(--muted-foreground)",
}

export const LIGHT_PALETTE: Record<ThemeColorKey, string> = {
  background: "#f3f5f9", foreground: "#202838", card: "#ffffff", cardForeground: "#202838",
  muted: "#e8edf4", mutedForeground: "#647089", border: "#d4dce8", input: "#edf1f7",
  primary: "#536bdf", primaryForeground: "#ffffff", accent: "#167f83", accentForeground: "#ffffff", ring: "#536bdf",
  sidebar: "#e9eef6", sidebarForeground: "#29344a", sidebarPrimary: "#536bdf", sidebarPrimaryForeground: "#ffffff",
  sidebarAccent: "#167f83", sidebarAccentForeground: "#ffffff", sidebarBorder: "#d4dce8",
}

export function themeMode(theme: Theme): "light" | "dark" {
  const mode = theme.appearance?.colorMode
  if (mode === "light" || mode === "dark") return mode
  if (mode === "system") return typeof matchMedia === "function" && !matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark"
  return hexLuminance(theme.palette?.background ?? DARK_PALETTE.background) > 0.35 ? "light" : "dark"
}

/** При смене режима меняются поверхности и текст; акценты остаются цветами темы. */
export function themePaletteForMode(theme: Theme, mode: "light" | "dark"): Record<ThemeColorKey, string> {
  const palette: Record<ThemeColorKey, string> = { ...DARK_PALETTE, ...theme.palette }
  palette.primary = normalizeHex(theme.palette?.primary) ?? normalizeHex(theme.primary) ?? DARK_PALETTE.primary
  palette.accent = normalizeHex(theme.palette?.accent) ?? normalizeHex(theme.accent) ?? DARK_PALETTE.accent
  const currentMode = hexLuminance(palette.background) > 0.35 ? "light" : "dark"
  const defaults = mode === "light" ? LIGHT_PALETTE : DARK_PALETTE
  const saved = mode === "light" ? theme.appearance?.lightPalette : theme.appearance?.darkPalette
  for (const key of ["background", "foreground", "card", "cardForeground", "muted", "mutedForeground", "border", "input", "sidebar", "sidebarForeground", "sidebarBorder"] as const) {
    palette[key] = saved?.[key] ?? (currentMode === mode ? palette[key] : defaults[key])
  }
  return palette
}

export function resolveTheme(theme: Theme): Theme {
  if (!theme.appearance?.colorMode) return theme
  const palette = themePaletteForMode(theme, themeMode(theme))
  return { ...theme, palette, primary: palette.primary, accent: palette.accent }
}

/**
 * Тёмная база лаунчера (`.dark` из `src/index.css`) в hex — с неё начинается
 * любая новая кастомная тема, поэтому «Создать тему» не меняет вид окна.
 */
export const DARK_PALETTE: Record<ThemeColorKey, string> = {
  background: "#010203",
  foreground: "#ffffff",
  card: "#020204",
  cardForeground: "#ffffff",
  muted: "#07090d",
  mutedForeground: "#555555",
  border: "#0d1014",
  input: "#040609",
  primary: "#f64b00",
  primaryForeground: "#030303",
  accent: "#ca6100",
  accentForeground: "#ffffff",
  ring: "#f64b00",
  sidebar: "#000102",
  sidebarForeground: "#ffffff",
  sidebarPrimary: "#f64b00",
  sidebarPrimaryForeground: "#030303",
  sidebarAccent: "#ca6100",
  sidebarAccentForeground: "#ffffff",
  sidebarBorder: "#090b0f",
}

/** `#abc` и `abc` → `#aabbcc`; мусор → null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null
  let hex = value.trim().replace(/^#/, "")
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("")
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null
  return `#${hex.toLowerCase()}`
}

export function isHexColor(value: unknown): boolean {
  return normalizeHex(value) !== null
}

/** Цвета поверхностей и состояний допускают также альфу. */
function appearanceColor(value: unknown): string | null {
  const opaque = normalizeHex(value)
  if (opaque) return opaque
  if (typeof value !== "string") return null
  const hex = value.trim().toLowerCase()
  if (/^#[0-9a-f]{8}$/.test(hex)) return hex
  if (/^#[0-9a-f]{4}$/.test(hex)) return "#" + [...hex.slice(1)].map(char => char + char).join("")
  return null
}

/** `#rrggbb` + альфа → `#rrggbbaa` (свечение задаётся одним цветом). */
export function hexWithAlpha(color: string, alpha: number): string | null {
  const hex = normalizeHex(color)
  if (!hex) return null
  const clamped = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : DEFAULT_GLOW_ALPHA))
  const byte = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")
  return `${hex}${byte}`
}

/** Относительная яркость (sRGB) — нужна, чтобы понять, светлая ли тема. */
export function hexLuminance(color: string): number {
  const hex = normalizeHex(color.length === 9 ? color.slice(0, 7) : color)
  if (!hex) return 0
  const channel = (from: number) => {
    const v = parseInt(hex.slice(from, from + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

export function isLightTheme(theme: Theme): boolean {
  return hexLuminance(themePreviewColors(theme).background) > 0.35
}

/** Палитра темы с подстановкой тёмной базы: удобно и превью, и редактору. */
export function themePreviewColors(theme: Theme): Record<ThemeColorKey, string> {
  theme = resolveTheme(theme)
  const palette: Record<ThemeColorKey, string> = { ...DARK_PALETTE, ...(theme.palette ?? {}) }
  palette.primary = normalizeHex(theme.palette?.primary) ?? normalizeHex(theme.primary) ?? DARK_PALETTE.primary
  palette.accent = normalizeHex(theme.palette?.accent) ?? normalizeHex(theme.accent) ?? DARK_PALETTE.accent
  if (!theme.palette || Object.keys(theme.palette).length === 0) {
    palette.ring = palette.primary
    palette.sidebarPrimary = palette.primary
    palette.sidebarAccent = palette.accent
  }
  return palette
}

/** Свечение темы: по умолчанию — её же акценты с прозрачностью 0.4. */
export function themeGlow(theme: Theme, key: ThemeGlowKey): ThemeGlow {
  const explicit = theme.glow?.[key]
  const palette = themePreviewColors(theme)
  const fallbackColor = key === "primary" ? palette.primary : palette.accent
  return {
    color: normalizeHex(explicit?.color) ?? fallbackColor,
    alpha: clampAlpha(explicit?.alpha),
  }
}

export function clampAlpha(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return DEFAULT_GLOW_ALPHA
  return Math.max(0, Math.min(1, num))
}

/** id тега `<style>`, в который попадает CSS из режима «CSS» редактора. */
export const THEME_CSS_STYLE_ID = "theme-custom-css"
export const THEME_BASE_STYLE_ID = "theme-base-css"

export const THEME_ENTER_ANIMATIONS = {
  default: "xneon-settings-content-enter",
  fade: "xneon-content-fade",
  "slide-up": "xneon-content-slide-up",
  "slide-left": "xneon-content-slide-left",
  zoom: "xneon-content-zoom",
  blur: "xneon-content-blur",
  none: "none",
  custom: "theme-content-enter",
} as const
export const THEME_ENTER_CSS_VARS = ["--theme-enter-name", "--theme-enter-duration", "--theme-enter-delay", "--theme-enter-easing"] as const

/** Допустимое имя CSS-анимации без служебных значений и CSS-деклараций. */
export function normalizeEnterKeyframes(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  return /^[a-z_][\w-]{0,63}$/i.test(name) && !/^(none|initial|inherit|unset|revert|revert-layer|default)$/i.test(name) ? name : null
}

export function hasThemeEnterKeyframes(css?: string): boolean {
  const source = (css ?? "").replace(/\/\*[\s\S]*?\*\//g, "")
  return /@(?:-webkit-)?keyframes\s+(?:theme-content-enter|"theme-content-enter"|'theme-content-enter')\s*\{/i.test(source)
}

export function themeEnterAnimation(theme: Theme): keyof typeof THEME_ENTER_ANIMATIONS {
  const choice = theme.appearance?.enterAnimation
  if (choice && Object.hasOwn(THEME_ENTER_ANIMATIONS, choice)) return choice
  return theme.cssEnabled !== false && hasThemeEnterKeyframes(theme.css) ? "custom" : "default"
}

export function themeEnterMotion(theme: Theme): { name: string; duration: number } {
  const appearance = theme.appearance
  const preset = themeEnterAnimation(theme)
  const name = preset === "custom"
    ? theme.cssEnabled === false ? THEME_ENTER_ANIMATIONS.default : normalizeEnterKeyframes(appearance?.enterKeyframes) ?? THEME_ENTER_ANIMATIONS.custom
    : THEME_ENTER_ANIMATIONS[preset]
  return { name, duration: clampRange(appearance?.enterDuration, 100, 2000, 300) }
}

/** Фолбэки для гарнитуры темы: без них экзотическая гарнитура даст «Times New Roman». */
const FONT_FALLBACKS = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** Разумные границы размера шрифта: за ними интерфейс разваливается. */
export const FONT_SIZE_MIN = 11
export const FONT_SIZE_MAX = 20
export const FONT_SIZE_DEFAULT = 16
export const BLUR_MAX = 24

function clampRange(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

/** Убирает всё, что тема могла выставить раньше, — чтобы пресеты вернулись к общему фону. */
function resetThemeVars(root: HTMLElement) {
  for (const key of THEME_COLOR_KEYS) root.style.removeProperty(THEME_CSS_VARS[key])
  root.style.removeProperty("--sidebar-ring")
  root.style.removeProperty("--glow-primary")
  root.style.removeProperty("--glow-accent")
  root.style.removeProperty("--ambient-primary")
  root.style.removeProperty("--ambient-accent")
  root.style.removeProperty("--font-sans")
  root.style.removeProperty("--theme-bg-opacity")
  root.style.removeProperty("--theme-bg-dim")
  root.style.removeProperty("--theme-bg-blur")
  for (const name of THEME_ENTER_CSS_VARS) root.style.removeProperty(name)
  root.style.fontSize = ""
  root.style.removeProperty("color-scheme")
  root.classList.remove("theme-with-background")
  document.getElementById(THEME_CSS_STYLE_ID)?.remove()
  document.getElementById(THEME_BASE_STYLE_ID)?.remove()
  for (const name of ["--theme-titlebar", "--destructive", "--destructive-foreground", "--warning", "--info", "--success", "--theme-blur-titlebar", "--theme-blur-sidebar", "--theme-blur-card", "--theme-radius"]) root.style.removeProperty(name)
  root.classList.remove("theme-appearance")
  for (const part of ["titlebar", "sidebar", "card"]) root.classList.remove(`theme-blur-${part}`)
  for (const name of semanticCssVars) root.style.removeProperty(name)
  for (const name of Object.keys(SURFACE_ALIASES)) root.style.removeProperty(name)
}

/**
 * Декоративные свечения фона (шапка лаунчера, панель Laby, превью скина).
 * Хранят только цвет — прозрачность каждый очаг задаёт сам через `color-mix`,
 * иначе один и тот же акцент в трёх местах светился бы одинаково ярко.
 */
function applyAmbientVars(root: HTMLElement, primary: string, accent: string) {
  const primaryHex = normalizeHex(primary)
  const accentHex = normalizeHex(accent)
  if (primaryHex) root.style.setProperty("--ambient-primary", primaryHex)
  if (accentHex) root.style.setProperty("--ambient-accent", accentHex)
}

/** Шрифт темы: гарнитура и базовый кегль (Tailwind считает в rem, поэтому масштабируется всё). */
function fontFamilyCss(font: Theme["font"]): string | undefined {
  if (!font) return undefined
  const family = typeof font.family === "string" && font.family.trim() ? font.family.trim() : font.source ? "XneonThemeFont" : ""
  if (family) {
    const generic = /^(system-ui|sans-serif|serif|monospace|ui-sans-serif|ui-serif|ui-monospace|cursive|fantasy)$/i.test(family)
    return `${generic ? family : JSON.stringify(family)}, ${FONT_FALLBACKS}`
  }
  return undefined
}

function applyFontVars(root: HTMLElement, font: Theme["font"]) {
  if (!font) return
  const family = fontFamilyCss(font)
  if (family) root.style.setProperty("--font-sans", family)
  if (typeof font.size === "number") {
    root.style.fontSize = `${clampRange(font.size, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT)}px`
  }
}

/** Переменные, которые читает слой фона (`ThemeBackgroundLayer`). */
function applyBackgroundVars(root: HTMLElement, background: Theme["background"]) {
  if (!background) return
  root.style.setProperty("--theme-bg-opacity", String(clampRange(background.opacity, 0, 1, 1)))
  root.style.setProperty("--theme-bg-dim", String(clampRange(background.dim, 0, 1, 0)))
  root.style.setProperty("--theme-bg-blur", `${clampRange(background.blur, 0, BLUR_MAX, 0)}px`)
}

/**
 * CSS из режима «CSS» редактора. Живёт отдельным тегом, а не в inline-стилях:
 * так пользователь может переопределить что угодно, и это снимается одной строкой.
 */
function applyCustomCss(css: string | undefined) {
  const content = typeof css === "string" ? css.trim() : ""
  if (!content) return
  // База темы идёт перед пользовательским CSS, чтобы обычный :root мог
  // переопределять её без борьбы с inline-стилями и без !important.
  const root = document.documentElement
  const names = [
    ...Object.values(THEME_CSS_VARS), "--sidebar-ring", "--glow-primary", "--glow-accent",
    "--ambient-primary", "--ambient-accent", "--font-sans", "--theme-bg-opacity",
    "--theme-bg-dim", "--theme-bg-blur", "color-scheme", "--theme-titlebar", "--destructive", "--destructive-foreground", "--warning", "--info", "--success",
    "--theme-blur-titlebar", "--theme-blur-sidebar", "--theme-blur-card", "--theme-radius", ...THEME_ENTER_CSS_VARS, ...semanticCssVars, ...Object.keys(SURFACE_ALIASES),
  ]
  const declarations: string[] = []
  for (const name of names) {
    const value = root.style.getPropertyValue(name)
    if (value) declarations.push(`${name}: ${value};`)
    root.style.removeProperty(name)
  }
  if (root.style.fontSize) declarations.push(`font-size: ${root.style.fontSize};`)
  root.style.fontSize = ""
  const baseStyle = document.createElement("style")
  baseStyle.id = THEME_BASE_STYLE_ID
  baseStyle.textContent = `:root {\n${declarations.join("\n")}\n}`
  document.head.appendChild(baseStyle)
  let style = document.getElementById(THEME_CSS_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = THEME_CSS_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = content
}

/** Кеш только цветов splash, без CSS, медиа и обращения к БД при следующем старте. */
function persistStartupTheme(root: HTMLElement) {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function" || !window.electronAPI?.setSetting) return
  const styles = getComputedStyle(root)
  const colors = Object.fromEntries(["--background", "--foreground", "--primary", "--accent", "--border", "--muted-foreground", "--glow-primary", "--glow-accent"].map(key => [key, styles.getPropertyValue(key).trim()]))
  const snapshot = JSON.stringify({ mode: root.classList.contains("dark") ? "dark" : "light", colors })
  void window.electronAPI.setSetting("_startupThemeSnapshot", snapshot).catch(() => {})
}

/**
 * Применяет тему к документу.
 *
 * Тема с палитрой переопределяет все свои переменные; тема без палитры
 * (встроенный пресет) по-прежнему меняет только акценты, а фон остаётся общим.
 * Шрифт, фон и пользовательский CSS применяются в обеих ветках.
 */
export function applyTheme(input: Theme) {
  const theme = resolveTheme(input)
  const root = document.documentElement
  resetThemeVars(root)
  root.classList.toggle("dark", themeMode(theme) === "dark")
  root.classList.toggle("theme-appearance", !!theme.appearance)
  if (root.dataset) root.dataset.themeMode = themeMode(theme)
  const appearance = theme.appearance
  if (appearance?.enterAnimation || themeEnterAnimation(theme) !== "default" || appearance?.enterDuration !== undefined) {
    const motion = themeEnterMotion(theme)
    root.style.setProperty("--theme-enter-name", motion.name)
    root.style.setProperty("--theme-enter-duration", `${motion.duration}ms`)
  }
  for (const part of ["titlebar", "sidebar", "card"] as const) {
    const key = `blur${part[0].toUpperCase()}${part.slice(1)}` as "blurTitlebar" | "blurSidebar" | "blurCard"
    root.classList.toggle(`theme-blur-${part}`, (appearance?.[key] ?? 0) > 0)
  }
  const applied = () => {
    persistStartupTheme(root)
    // Подписчики получают исходные независимые палитры и уже применённые стили.
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("theme:applied", { detail: input }))
  }
  // Старые цветовые классы тоже следуют теме. Явные цвета автора имеют приоритет.
  for (const key of Object.keys(SEMANTIC_COLOR_TOKENS) as Array<keyof typeof SEMANTIC_COLOR_TOKENS>) {
    const value = appearanceColor(appearance?.[key]) || SEMANTIC_DEFAULTS[key]
    for (const color of SEMANTIC_COLOR_TOKENS[key]) for (const shade of [300, 400, 500, 600, 700]) root.style.setProperty(`--color-${color}-${shade}`, value)
  }
  for (const [key, name] of Object.entries({ titlebar: "--theme-titlebar", error: "--destructive", warning: "--warning", info: "--info", success: "--success" })) {
    const value = appearanceColor(appearance?.[key as "titlebar" | "error" | "warning" | "info" | "success"])
    if (value) root.style.setProperty(name, value)
    else if (key !== "titlebar") root.style.setProperty(name, SEMANTIC_DEFAULTS[key as keyof typeof SEMANTIC_DEFAULTS])
  }
  const errorColor = appearanceColor(appearance?.error)
  root.style.setProperty("--destructive-foreground", errorColor ? (hexLuminance(errorColor) > 0.179 ? "#000000" : "#ffffff") : "var(--primary-foreground)")
  for (const [key, name] of Object.entries({ blurTitlebar: "--theme-blur-titlebar", blurSidebar: "--theme-blur-sidebar", blurCard: "--theme-blur-card", radius: "--theme-radius" })) {
    const value = appearance?.[key as "blurTitlebar" | "blurSidebar" | "blurCard" | "radius"]
    if (typeof value === "number") root.style.setProperty(name, `${value}px`)
  }

  applyFontVars(root, theme.font)
  applyBackgroundVars(root, theme.background)
  // Класс нужен CSS: с ним body становится прозрачным и видно слой фона.
  root.classList.toggle("theme-with-background", (!!theme.background && (!!theme.background.source || ["particles", "halo"].includes(theme.background.kind))) || (theme.cssEnabled !== false && /--custom-background-video\s*:\s*url\(/i.test(theme.css ?? "")))

  const palette = theme.palette
  const hasPalette = !!palette && Object.keys(palette).length > 0

  if (hasPalette) {
    for (const [name, value] of Object.entries(SURFACE_ALIASES)) root.style.setProperty(name, value)
    for (const key of THEME_COLOR_KEYS) {
      const value = normalizeHex(palette[key])
      if (value) root.style.setProperty(THEME_CSS_VARS[key], value)
    }
    // Кольцо боковой панели повторяет общее кольцо: отдельного выбора для него нет.
    const ring = normalizeHex(palette.ring)
    if (ring) root.style.setProperty("--sidebar-ring", ring)
    root.style.setProperty("color-scheme", isLightTheme(theme) ? "light" : "dark")

    // Свечение кастомной темы: свой цвет и своя прозрачность на каждый акцент.
    const primaryGlow = themeGlow(theme, "primary")
    const accentGlow = themeGlow(theme, "accent")
    const primaryGlowValue = hexWithAlpha(primaryGlow.color, primaryGlow.alpha)
    const accentGlowValue = hexWithAlpha(accentGlow.color, accentGlow.alpha)
    if (primaryGlowValue) root.style.setProperty("--glow-primary", primaryGlowValue)
    if (accentGlowValue) root.style.setProperty("--glow-accent", accentGlowValue)

    const preview = themePreviewColors(theme)
    applyAmbientVars(root, preview.primary, preview.accent)
    applyCustomCss(theme.cssEnabled === false ? undefined : theme.css)
    applied()
    return
  }

  if (!theme.primaryOklch || !theme.accentOklch) {
    applyCustomCss(theme.cssEnabled === false ? undefined : theme.css)
    applied()
    return
  }
  root.style.setProperty("--primary", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--ring", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--sidebar-primary", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--sidebar-ring", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--accent", `oklch(${theme.accentOklch})`)
  root.style.setProperty("--sidebar-accent", `oklch(${theme.accentOklch})`)

  // Пресетам нужен oklch-формат с альфой, как в index.css.
  if (theme.primaryOklch) root.style.setProperty("--glow-primary", `oklch(${theme.primaryOklch} / ${DEFAULT_GLOW_ALPHA})`)
  if (theme.accentOklch) root.style.setProperty("--glow-accent", `oklch(${theme.accentOklch} / ${DEFAULT_GLOW_ALPHA})`)

  // Свечения фона у пресета берут его hex-акценты (они есть у каждого пресета).
  applyAmbientVars(root, theme.primary, theme.accent)
  applyCustomCss(theme.cssEnabled === false ? undefined : theme.css)
  applied()
}

export const CUSTOM_THEME_PREFIX = "custom-"

export function isCustomThemeId(id: string): boolean {
  return typeof id === "string" && id.startsWith(CUSTOM_THEME_PREFIX)
}

function slugify(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  }
  const latin = name
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
  const slug = latin.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return slug.slice(0, 32) || "theme"
}

/** Уникальный id кастомной темы: `custom-<транслит>-<время>`. */
export function newThemeId(name: string, existing: string[] = []): string {
  const base = `${CUSTOM_THEME_PREFIX}${slugify(name)}`
  if (!existing.includes(base)) return base
  const withTime = `${base}-${Date.now().toString(36)}`
  if (!existing.includes(withTime)) return withTime
  let counter = 2
  while (existing.includes(`${withTime}-${counter}`)) counter += 1
  return `${withTime}-${counter}`
}

/** Новая кастомная тема: полная палитра, при желании — снятая с готовой темы. */
export function createCustomTheme(name: string, base?: Theme | null, existingIds: string[] = []): Theme {
  const palette = base ? themePreviewColors(base) : { ...DARK_PALETTE }
  const now = Date.now()
  return {
    id: newThemeId(name, existingIds),
    name: name.trim() || "Моя тема",
    ...(base?.description ? { description: base.description } : {}),
    primary: palette.primary,
    accent: palette.accent,
    palette: { ...palette },
    glow: {
      primary: base ? themeGlow(base, "primary") : { color: palette.primary, alpha: DEFAULT_GLOW_ALPHA },
      accent: base ? themeGlow(base, "accent") : { color: palette.accent, alpha: DEFAULT_GLOW_ALPHA },
    },
    custom: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** Копия любой темы (в том числе пресета) в виде кастомной. */
export function duplicateTheme(theme: Theme, name: string, existingIds: string[] = []): Theme {
  const copy = createCustomTheme(name, theme, existingIds)
  return { ...theme, ...copy, primary: theme.primary, accent: theme.accent }
}

/**
 * Приводит тему к безопасному виду. Строки из localStorage и БД может
 * подменить кто угодно (в том числе агент), поэтому палитра валидируется.
 */
export function sanitizeTheme(input: unknown): Theme | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const id = typeof raw.id === "string" ? raw.id.trim() : ""
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  if (!id || !name) return null

  const paletteInput = (raw.palette ?? {}) as Record<string, unknown>
  const palette: Partial<Record<ThemeColorKey, string>> = {}
  for (const key of THEME_COLOR_KEYS) {
    const value = normalizeHex(paletteInput[key])
    if (value) palette[key] = value
  }

  const glowInput = (raw.glow ?? {}) as Record<string, unknown>
  const glowOf = (key: ThemeGlowKey): ThemeGlow | undefined => {
    const value = glowInput[key] as Record<string, unknown> | undefined
    if (!value) return undefined
    const color = normalizeHex(value.color)
    if (!color) return undefined
    return { color, alpha: clampAlpha(value.alpha) }
  }
  const glowPrimary = glowOf("primary")
  const glowAccent = glowOf("accent")

  const primary = normalizeHex(raw.primary) ?? palette.primary ?? DARK_PALETTE.primary
  const accent = normalizeHex(raw.accent) ?? palette.accent ?? DARK_PALETTE.accent

  const theme: Theme = {
    id,
    name: name.slice(0, 60),
    primary,
    accent,
  }
  if (typeof raw.description === "string" && raw.description.trim()) theme.description = raw.description.trim().slice(0, 240)
  if (typeof raw.primaryOklch === "string" && raw.primaryOklch.trim()) theme.primaryOklch = raw.primaryOklch.trim()
  if (typeof raw.accentOklch === "string" && raw.accentOklch.trim()) theme.accentOklch = raw.accentOklch.trim()
  if (Object.keys(palette).length > 0) theme.palette = palette
  if (glowPrimary || glowAccent) theme.glow = { primary: glowPrimary, accent: glowAccent }

  const fontInput = raw.font as Record<string, unknown> | undefined
  if (fontInput && typeof fontInput === "object") {
    const family = typeof fontInput.family === "string" ? fontInput.family.trim().slice(0, 80) : ""
    const font: ThemeFont = {}
    if (family) font.family = family
    if (typeof fontInput.source === "string") font.source = fontInput.source.slice(0, 8192)
    if (typeof fontInput.size === "number" || typeof fontInput.size === "string") {
      font.size = clampRange(fontInput.size, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT)
    }
    if (font.family || font.size !== undefined || font.source) theme.font = font
  }

  const backgroundInput = raw.background as Record<string, unknown> | undefined
  if (backgroundInput && typeof backgroundInput === "object") {
    const source = typeof backgroundInput.source === "string" ? backgroundInput.source.trim() : ""
    if (source || backgroundInput.kind === "particles" || backgroundInput.kind === "halo") {
      const background: ThemeBackground = {
        kind: ["image", "video", "particles", "halo"].includes(String(backgroundInput.kind)) ? backgroundInput.kind as ThemeBackground["kind"] : "image",
        source: source.slice(0, 2048),
        dim: clampRange(backgroundInput.dim, 0, 1, 0),
        blur: clampRange(backgroundInput.blur, 0, BLUR_MAX, 0),
        opacity: clampRange(backgroundInput.opacity, 0, 1, 1),
        fit: backgroundInput.fit === "contain" ? "contain" : "cover",
        volume: clampRange(backgroundInput.volume, 0, 1, 0),
        particleStyle: ["stars", "snow", "network"].includes(String(backgroundInput.particleStyle)) ? backgroundInput.particleStyle as "stars" | "snow" | "network" : "stars",
      }
      theme.background = background
    }
  }

  if (typeof raw.css === "string" && raw.css.trim()) theme.css = raw.css.slice(0, 1024 * 1024)
  if (typeof raw.cssEnabled === "boolean") theme.cssEnabled = raw.cssEnabled
  if (raw.appearance && typeof raw.appearance === "object") {
    const input = raw.appearance as Record<string, unknown>
    const appearance: NonNullable<Theme["appearance"]> = {}
    if (typeof input.enterAnimation === "string" && Object.hasOwn(THEME_ENTER_ANIMATIONS, input.enterAnimation)) appearance.enterAnimation = input.enterAnimation as NonNullable<Theme["appearance"]>["enterAnimation"]
    if (input.enterDuration !== undefined) appearance.enterDuration = clampRange(input.enterDuration, 100, 2000, 300)
    const enterKeyframes = normalizeEnterKeyframes(input.enterKeyframes)
    if (enterKeyframes) appearance.enterKeyframes = enterKeyframes
    if (["light", "dark", "system"].includes(String(input.colorMode))) appearance.colorMode = input.colorMode as "light" | "dark" | "system"
    for (const mode of ["lightPalette", "darkPalette"] as const) {
      if (!input[mode] || typeof input[mode] !== "object") continue
      const palette: Partial<Record<ThemeColorKey, string>> = {}
      for (const key of THEME_COLOR_KEYS) {
        const color = normalizeHex((input[mode] as Record<string, unknown>)[key])
        if (color) palette[key] = color
      }
      appearance[mode] = palette
    }
    for (const key of ["titlebar", "error", "warning", "info", "success"] as const) {
      const color = appearanceColor(input[key])
      if (color) appearance[key] = color
    }
    for (const key of ["blurTitlebar", "blurSidebar", "blurCard", "radius"] as const) {
      if (input[key] !== undefined) appearance[key] = clampRange(input[key], 0, 40, 0)
    }
    theme.appearance = appearance
  }
  if (raw.custom === true || isCustomThemeId(id)) theme.custom = true
  if (typeof raw.createdAt === "number") theme.createdAt = raw.createdAt
  if (typeof raw.updatedAt === "number") theme.updatedAt = raw.updatedAt
  return theme
}

/** Разбор списка тем из localStorage/БД: битые записи молча отбрасываются. */
export function parseThemes(raw: string | null | undefined): Theme[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeTheme).filter((theme): theme is Theme => theme !== null)
  } catch {
    return []
  }
}

export function serializeThemes(themes: Theme[]): string {
  return JSON.stringify(themes)
}

/** Реестр: пресеты плюс кастомные темы. Кастомная тема с тем же id перекрывает пресет. */
export function mergeThemes<T extends Theme>(presets: T[], custom: Theme[]): Theme[] {
  const byId = new Map<string, Theme>()
  for (const theme of presets) byId.set(theme.id, theme)
  for (const theme of custom) byId.set(theme.id, theme)
  return [...byId.values()]
}

export function findTheme(themes: Theme[], id: string | undefined | null): Theme | undefined {
  if (!id) return undefined
  return themes.find((theme) => theme.id === id)
}

/** Обратная карта «CSS-переменная → ключ палитры» — для режима «CSS» в редакторе. */
const CSS_VAR_TO_KEY = new Map<string, ThemeColorKey>(
  THEME_COLOR_KEYS.map((key) => [THEME_CSS_VARS[key], key]),
)

/**
 * Текущая тема в виде CSS — то, что видно в textarea режима «CSS».
 * Это ровно те переменные, которые пишет `applyTheme`, плюс необязательный хвост
 * из `theme.css`.
 */
export function serializeThemeCss(theme: Theme): string {
  const palette = themePreviewColors(theme)
  const lines = THEME_COLOR_KEYS.map((key) => `  ${THEME_CSS_VARS[key]}: ${palette[key]};`)
  for (const key of THEME_GLOW_KEYS) {
    const glow = themeGlow(theme, key)
    lines.push(`  --glow-${key}: ${hexWithAlpha(glow.color, glow.alpha)};`)
  }
  const family = fontFamilyCss(theme.font)
  if (family) lines.push(`  --font-sans: ${family};`)
  if (typeof theme.font?.size === "number") lines.push(`  font-size: ${theme.font.size}px;`)
  if (theme.background) {
    lines.push(`  --theme-bg-opacity: ${theme.background.opacity ?? 1};`)
    lines.push(`  --theme-bg-dim: ${theme.background.dim ?? 0};`)
    lines.push(`  --theme-bg-blur: ${theme.background.blur ?? 0}px;`)
  }
  const head = `:root {\n${lines.join("\n")}\n}`
  return theme.css ? `${head}\n\n${theme.css}` : head
}

/**
 * Объявление внутри ведущего блока `:root`, которое `serializeThemeCss` умеет
 * пересоздать из палитры, шрифта или фона. Такие объявления не дублируем в
 * `theme.css`: шапку регенерирует сериализация при каждом открытии режима «CSS».
 */
function isRegenerableRootDeclaration(declaration: string, background: ThemeBackground | undefined): boolean {
  // !important перекрывает inline-переменные applyTheme — это осознанный приём, не трогаем.
  if (/!important/i.test(declaration)) return false
  // Кегль сериализуется как `font-size: Npx`; прочие варианты сохраняем как есть.
  if (/^font-size\s*:\s*[\d.]+\s*px$/i.test(declaration)) return true
  const varMatch = declaration.match(/^(--[a-z0-9-]+)\s*:\s*(.+)$/)
  if (!varMatch) return false
  const [, name, rawValue] = varMatch
  const value = rawValue.trim()
  if (/^--glow-(primary|accent)$/.test(name)) return /^#[0-9a-f]{8}$/i.test(value)
  if (CSS_VAR_TO_KEY.has(name)) return normalizeHex(value) !== null
  if (name === "--font-sans") return Boolean(value.split(",")[0]?.replace(/["']/g, "").trim())
  if (name === "--theme-bg-opacity" || name === "--theme-bg-dim" || name === "--theme-bg-blur") {
    return Boolean(background)
  }
  return false
}

/**
 * Разбор CSS из режима «CSS».
 *
 * Распознанные переменные переносятся в палитру/шрифт темы (по ним обновляются
 * миниатюры), а исходный текст сохраняется в `theme.css`, поэтому результат в
 * окне совпадает с тем, что человек написал. Единственное исключение — ведущий
 * блок `:root`: `serializeThemeCss` добавляет такую шапку из палитры заново при
 * каждом открытии, поэтому хранить её в `css` значит раздувать текст на дубль
 * шапки с каждым циклом «правка → сохранение». Свои переменные из ведущего блока
 * (которых нет в палитре) сохраняются. `null` — разобрать нечего, показываем
 * ошибку в редакторе.
 */
export function parseThemeCss(text: string, base: Theme): Theme | null {
  const source = typeof text === "string" ? text : ""
  if (!source.trim()) return { ...base, css: undefined }

  // Валидация формата: нужен минимум одно правило «селектор { … }» (или переменные).
  // Голый текст без скобок — ошибка в редакторе, а не тема.
  if (!/\{[^}]*\}/.test(source) && !source.includes("--") && !/^\s*@(import|charset|layer)\b[^;]*;/i.test(source) && source.replace(/\/\*[\s\S]*?\*\//g, "").trim()) return null

  // Переменные :root разбираем, только если блок :root явно присутствует в коде.
  // Если пользователь пишет произвольный CSS (например только правила селекторов),
  // не затираем палитру и параметры базовой темы.
  const rootBlockMatch = source.match(/:root\s*\{([^}]*)\}/i)
  const rootContent = rootBlockMatch ? rootBlockMatch[1] : (source.includes("--") ? source : "")
  const declarations = [...rootContent.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/gi)]
  const sizeMatch = rootContent.match(/font-size\s*:\s*([\d.]+)\s*px/i)

  const palette: Partial<Record<ThemeColorKey, string>> = { ...(base.palette ?? {}) }
  let fontFamily = base.font?.family
  let fontSize = base.font?.size
  const background: ThemeBackground | undefined = base.background ? { ...base.background } : undefined

  const glow = { primary: themeGlow(base, "primary"), accent: themeGlow(base, "accent") }

  for (const [, name, rawValue] of declarations) {
    const value = rawValue.trim()
    const varName = `--${name}`
    const key = CSS_VAR_TO_KEY.get(varName)
    if (key) {
      const hex = normalizeHex(value)
      if (hex) palette[key] = hex
      continue
    }
    if (/^--glow-(primary|accent)$/.test(varName) && /^#[0-9a-f]{8}$/i.test(value)) {
      const key = name.slice(5) as ThemeGlowKey
      glow[key] = { color: value.slice(0, 7), alpha: parseInt(value.slice(7), 16) / 255 }
      continue
    }
    if (varName === "--font-sans") {
      const family = value.split(",")[0]?.replace(/["']/g, "").trim()
      if (family) fontFamily = family
      continue
    }
    if (!background) continue
    if (varName === "--theme-bg-dim") background.dim = clampRange(value, 0, 1, background.dim ?? 0)
    else if (varName === "--theme-bg-opacity") background.opacity = clampRange(value, 0, 1, background.opacity ?? 1)
    else if (varName === "--theme-bg-blur") background.blur = clampRange(parseFloat(value), 0, BLUR_MAX, background.blur ?? 0)
  }

  if (sizeMatch) fontSize = clampRange(parseFloat(sizeMatch[1]), FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT)

  // Roundtrip без раздувания: serializeThemeCss ставит перед theme.css палитровую
  // шапку :root, поэтому хранить её в css — плодить дубль на каждый цикл правки.
  // Вырезаем только полностью восстановимые ведущие блоки (в т.ч. накопленные
  // дубли); блок с любым своим объявлением сохраняем целиком, чтобы не сломать
  // пересборкой экзотичные значения вида url(data:...;base64,...).
  let cssSource = source.trim()
  for (;;) {
    const leadingRoot = cssSource.match(/^:root\s*\{([^}]*)\}/i)
    if (!leadingRoot) break
    const rootDeclarations = leadingRoot[1].split(";").map((part) => part.trim()).filter(Boolean)
    const hasCustomDeclaration = rootDeclarations.some(
      (declaration) => !isRegenerableRootDeclaration(declaration, background),
    )
    if (hasCustomDeclaration) break
    cssSource = cssSource.slice(leadingRoot[0].length).replace(/^\s+/, "")
  }

  const next: Theme = { ...base, palette, glow, css: cssSource || undefined }
  if (hasThemeEnterKeyframes(cssSource)) {
    next.appearance = { ...next.appearance, enterAnimation: "custom", enterKeyframes: THEME_ENTER_ANIMATIONS.custom }
  }
  if (next.appearance?.colorMode) next.appearance = { ...next.appearance, [themeMode(next) === "light" ? "lightPalette" : "darkPalette"]: { ...palette } }
  next.primary = palette.primary ?? base.primary
  next.accent = palette.accent ?? base.accent
  const font: ThemeFont = { ...base.font }
  if (fontFamily) font.family = fontFamily
  if (font.source && fontFamily && fontFamily !== "XneonThemeFont" && fontFamily !== base.font?.family) delete font.source
  if (typeof fontSize === "number") font.size = fontSize
  if (font.family || font.size !== undefined || font.source) next.font = font
  if (background) next.background = background
  return next
}
