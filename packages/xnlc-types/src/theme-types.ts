/**
 * Все цвета, которыми может управлять тема. Встроенные пресеты меняют только
 * акценты, а кастомная тема задаёт всю палитру целиком — вплоть до фона окна,
 * поверхностей, текста, границ и свечения.
 */
export type ThemeColorKey =
  | "background"
  | "foreground"
  | "card"
  | "cardForeground"
  | "muted"
  | "mutedForeground"
  | "border"
  | "input"
  | "primary"
  | "primaryForeground"
  | "accent"
  | "accentForeground"
  | "ring"
  | "sidebar"
  | "sidebarForeground"
  | "sidebarPrimary"
  | "sidebarPrimaryForeground"
  | "sidebarAccent"
  | "sidebarAccentForeground"
  | "sidebarBorder"

/** Свечение: цвет и прозрачность (0…1), как в `--glow-*`. */
export interface ThemeGlow {
  color: string
  alpha: number
}

/** Гарнитура и базовый размер шрифта интерфейса (px). */
export interface ThemeFont {
  family?: string
  size?: number
  source?: string
}

/**
 * Фон лаунчера: картинка или видео.
 *
 * `source` — либо абсолютный путь к файлу (`file://`), либо http(s)-ссылка.
 * `dim`, `blur`, `opacity` необязательны: без них фон показывается как есть.
 */
export interface ThemeBackground {
  kind: "image" | "video" | "particles" | "halo"
  source: string
  /** Затемнение поверх фона, 0…1. */
  dim?: number
  /** Размытие фона в px, 0…24. */
  blur?: number
  /** Прозрачность самого фона, 0…1 (влияет на видимость обоев). */
  opacity?: number
  fit?: "cover" | "contain"
  volume?: number
  particleStyle?: "stars" | "snow" | "network"
}

export interface ThemeAppearance {
  colorMode?: "dark" | "light" | "system"
  lightPalette?: Partial<Record<ThemeColorKey, string>>
  darkPalette?: Partial<Record<ThemeColorKey, string>>
  titlebar?: string
  error?: string
  warning?: string
  info?: string
  success?: string
  blurTitlebar?: number
  blurSidebar?: number
  blurCard?: number
  radius?: number
  /** Анимация появления содержимого вкладок. */
  enterAnimation?: "default" | "fade" | "slide-up" | "slide-left" | "zoom" | "blur" | "none" | "custom"
  /** Длительность появления в миллисекундах. */
  enterDuration?: number
  /** Имя @keyframes из CSS темы при enterAnimation: "custom". */
  enterKeyframes?: string
}

export interface Theme {
  id: string
  name: string
  /** Необязательное описание пользовательской темы. */
  description?: string
  /** Акценты в hex — нужны миниатюрам и редактору. */
  primary: string
  accent: string
  /** Акценты в oklch — формат встроенных пресетов (`L C H` без `oklch()`). */
  primaryOklch?: string
  accentOklch?: string
  /**
   * Полная палитра в hex. Отсутствует у встроенных пресетов: они меняют только
   * акцент, а фон у них общий. Если палитра есть, `applyTheme` переопределяет
   * все перечисленные в ней переменные.
   */
  palette?: Partial<Record<ThemeColorKey, string>>
  glow?: {
    primary?: ThemeGlow
    accent?: ThemeGlow
  }
  /** Шрифт интерфейса: гарнитура и базовый размер. */
  font?: ThemeFont
  /** Фон окна лаунчера. */
  background?: ThemeBackground
  /** Дополнительный CSS темы из режима «CSS» редактора. */
  css?: string
  cssEnabled?: boolean
  appearance?: ThemeAppearance
  /** Тема собрана пользователем (или агентом) и хранится вне списка пресетов. */
  custom?: boolean
  createdAt?: number
  updatedAt?: number
}

