import { cn } from "@/lib/utils"
import type { Theme } from "./types"
import { hexWithAlpha, themeGlow, themePreviewColors } from "./theme-model"

/**
 * Размеры внутри миниатюры заданы в единицах контейнера (`cqh`, `cqw`), поэтому
 * одна и та же разметка одинаково выглядит и в карточке списка (`h-24`), и в
 * большой панели редактора (`h-40`). Tailwind такие единицы в произвольных
 * значениях не принимает, поэтому размеры проставлены инлайново.
 */

/** В селекторе используется тот же рисунок, что и на карточках готовых тем. */
export function ThemeMiniPreview({ theme, className }: { theme: Theme; className?: string }) {
  return <ThemeCompactPreview theme={theme} size="mini" className={className} />
}

/**
 * Компактная миниатюра окна лаунчера (как в исходном дизайне настроек):
 * полоска сайдбара, две строчки контента и кнопка акцента в h-12.
 */
export function ThemeCompactPreview({
  theme,
  className,
  size = "card",
}: {
  theme: Theme
  className?: string
  size?: "card" | "mini"
}) {
  const bg = theme.palette?.background ?? "#18181b"
  const primary = theme.palette?.primary ?? theme.primary
  const accent = theme.palette?.accent ?? theme.accent

  return (
    <div data-ui="settings-theme-preview-div-1" data-component="theme-compact-preview"
      aria-hidden
      className={cn(
        "relative flex overflow-hidden border border-border/60",
        size === "mini" ? "h-7 w-16 shrink-0 rounded-md" : "h-12 w-full rounded-xl",
        className
      )}
      style={{ backgroundColor: bg }}
    >
      <div data-ui="settings-theme-preview-div-2" className={cn("h-full shrink-0", size === "mini" ? "w-2" : "w-3.5")} style={{ backgroundColor: primary }} />
      <div data-ui="settings-theme-preview-div-3" className={cn("flex min-w-0 flex-1 flex-col", size === "mini" ? "gap-[3px] p-1" : "gap-1.5 p-2")}>
        <div data-ui="settings-theme-preview-div-4" className={cn("w-3/5 shrink-0 rounded-full", size === "mini" ? "h-[3px]" : "h-1.5")} style={{ backgroundColor: primary }} />
        <div data-ui="settings-theme-preview-div-5" className={cn("w-2/5 shrink-0 rounded-full", size === "mini" ? "h-[3px]" : "h-1.5")} style={{ backgroundColor: themePreviewColors(theme).mutedForeground, opacity: 0.35 }} />
        <div data-ui="settings-theme-preview-div-6" className={cn("mt-auto w-1/3 shrink-0", size === "mini" ? "h-[5px] rounded-sm" : "h-2.5 rounded-md")} style={{ backgroundColor: accent }} />
      </div>
    </div>
  )
}

/**
 * Миниатюра окна лаунчера в цветах темы.
 *
 * Рисуется обычными блоками, а не картинкой: превью честно показывает палитру
 * черновика (в том числе прямо во время правки) и остаётся чётким на любом
 * размере. Показывает то, что тема реально меняет: фон окна, боковую панель,
 * поверхности, текст, границы, поле ввода, акценты и оба свечения.
 */
export function ThemeWindowPreview({ theme, className }: { theme: Theme; className?: string }) {
  const colors = themePreviewColors(theme)
  const primaryGlow = themeGlow(theme, "primary")
  const accentGlow = themeGlow(theme, "accent")
  const primaryGlowValue = hexWithAlpha(primaryGlow.color, primaryGlow.alpha) ?? colors.primary
  const accentGlowValue = hexWithAlpha(accentGlow.color, accentGlow.alpha) ?? colors.accent

  return (
    <div data-ui="settings-theme-preview-div-7" data-component="theme-window-preview"
      aria-hidden
      className={cn(
        "relative isolate flex h-24 w-full overflow-hidden rounded-xl border [container-type:size]",
        className
      )}
      style={{ backgroundColor: colors.background, borderColor: colors.border }}
    >
      {/* Свечение акцентов — как у кнопки запуска в настоящем окне. */}
      <div data-ui="settings-theme-preview-div-8"
        className="pointer-events-none absolute rounded-full blur-2xl"
        style={{
          top: "-25%",
          right: "-10%",
          height: "70cqh",
          width: "45cqw",
          backgroundColor: primaryGlowValue,
        }}
      />
      <div data-ui="settings-theme-preview-div-9"
        className="pointer-events-none absolute rounded-full blur-2xl"
        style={{
          bottom: "-20%",
          left: "-8%",
          height: "70cqh",
          width: "45cqw",
          backgroundColor: accentGlowValue,
        }}
      />

      {/* Боковая панель: фон, активный пункт, приглушённые пункты и доп. акцент. */}
      <div data-ui="settings-theme-preview-div-10"
        className="relative flex w-[24%] shrink-0 flex-col justify-center"
        style={{
          padding: "5%",
          gap: "6cqh",
          backgroundColor: colors.sidebar,
          borderRight: `1px solid ${colors.sidebarBorder}`,
        }}
      >
        <div data-ui="settings-theme-preview-div-11" style={{ height: "7cqh", width: "55%", borderRadius: "9999px", backgroundColor: colors.sidebarPrimary }} />
        <div data-ui="settings-theme-preview-div-12"
          style={{
            height: "5cqh",
            width: "85%",
            borderRadius: "9999px",
            backgroundColor: colors.sidebarPrimary,
            opacity: 0.55,
          }}
        />
        <div data-ui="settings-theme-preview-div-13"
          style={{
            height: "5cqh",
            width: "70%",
            borderRadius: "9999px",
            backgroundColor: colors.sidebarForeground,
            opacity: 0.3,
          }}
        />
        <div data-ui="settings-theme-preview-div-14"
          style={{
            height: "5cqh",
            width: "80%",
            borderRadius: "9999px",
            backgroundColor: colors.sidebarAccent,
            opacity: 0.7,
          }}
        />
      </div>

      {/* Контент: заголовок, карточка, поле ввода и кнопки акцентов. */}
      <div data-ui="settings-theme-preview-div-15" className="relative flex flex-1 flex-col" style={{ padding: "5%", gap: "5cqh" }}>
        <div data-ui="settings-theme-preview-div-16" className="flex items-center justify-between" style={{ gap: "6cqw" }}>
          <div data-ui="settings-theme-preview-div-17"
            style={{
              height: "5cqh",
              width: "42%",
              borderRadius: "9999px",
              backgroundColor: colors.foreground,
              opacity: 0.75,
            }}
          />
          <div data-ui="settings-theme-preview-div-18"
            style={{ height: "6cqh", width: "16%", borderRadius: "9999px", backgroundColor: colors.primary }}
          />
        </div>

        <div data-ui="settings-theme-preview-div-19"
          className="flex flex-1 flex-col justify-center rounded-lg border"
          style={{
            padding: "5%",
            gap: "4cqh",
            backgroundColor: colors.card,
            borderColor: colors.border,
          }}
        >
          <div data-ui="settings-theme-preview-div-20"
            style={{
              height: "4cqh",
              width: "70%",
              borderRadius: "9999px",
              backgroundColor: colors.cardForeground,
              opacity: 0.6,
            }}
          />
          <div data-ui="settings-theme-preview-div-21"
            style={{
              height: "4cqh",
              width: "45%",
              borderRadius: "9999px",
              backgroundColor: colors.mutedForeground,
              opacity: 0.85,
            }}
          />
          <div data-ui="settings-theme-preview-div-22"
            style={{
              height: "4cqh",
              width: "58%",
              borderRadius: "9999px",
              backgroundColor: colors.muted,
            }}
          />
        </div>

        <div data-ui="settings-theme-preview-div-23" className="flex items-center" style={{ gap: "3cqw" }}>
          <div data-ui="settings-theme-preview-div-24"
            style={{
              height: "9cqh",
              width: "32%",
              borderRadius: "0.375rem",
              backgroundColor: colors.primary,
              boxShadow: `0 0 12px ${primaryGlowValue}`,
            }}
          />
          <div data-ui="settings-theme-preview-div-25"
            style={{
              height: "9cqh",
              width: "22%",
              borderRadius: "0.375rem",
              backgroundColor: colors.accent,
              boxShadow: `0 0 12px ${accentGlowValue}`,
            }}
          />
          <div data-ui="settings-theme-preview-div-26"
            className="flex-1 border"
            style={{
              height: "9cqh",
              borderRadius: "0.375rem",
              backgroundColor: colors.input,
              borderColor: colors.border,
            }}
          />
          <div data-ui="settings-theme-preview-div-27"
            style={{ height: "9cqh", width: "14%", borderRadius: "0.375rem", backgroundColor: colors.muted }}
          />
        </div>
      </div>
    </div>
  )
}