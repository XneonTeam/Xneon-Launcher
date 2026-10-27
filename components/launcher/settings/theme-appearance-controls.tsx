import { type Dispatch, type SetStateAction, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconAdjustmentsHorizontal } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import type { Theme, ThemeAppearance } from "./types"
import { THEME_ENTER_ANIMATIONS, normalizeEnterKeyframes, normalizeHex, themeEnterAnimation, themeEnterMotion, themeMode, themePaletteForMode, themePreviewColors } from "./theme-model"

const swatchClass = "h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-border bg-muted/30 transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0"
const hexInputClass = "min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/40"
const range = "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

function isAppearanceHex(value: string): boolean {
  return normalizeHex(value) !== null || /^#[\da-f]{4}(?:[\da-f]{4})?$/i.test(value.trim())
}

function AppearanceColorField({
  colorKey,
  label,
  value,
  fallback,
  onChange,
}: {
  colorKey: "titlebar" | "error" | "warning" | "info" | "success"
  label: string
  value: string | undefined
  fallback: string
  onChange: (value: string | undefined) => void
}) {
  const [raw, setRaw] = useState(value ?? "")
  useEffect(() => setRaw(value ?? ""), [value])
  const valid = raw.length === 0 || isAppearanceHex(raw)
  const pickerValue = normalizeHex(value) ?? (value && /^#[\da-f]{8}$/i.test(value) ? value.slice(0, 7) : null) ?? fallback

  return <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 p-2">
    <input
      data-ui="theme-extra-color-picker"
      data-color={colorKey}
      type="color"
      value={pickerValue}
      onChange={(event) => {
        setRaw(event.target.value)
        onChange(event.target.value)
      }}
      aria-label={label}
      title={label}
      className={swatchClass}
    />
    <div className="min-w-0 flex-1">
      <div className="truncate text-[11px] font-medium text-foreground">{label}</div>
      <input
        data-ui="theme-extra-color"
        data-color={colorKey}
        value={raw}
        onChange={(event) => {
          const next = event.target.value
          setRaw(next)
          if (!next.trim()) onChange(undefined)
          else if (isAppearanceHex(next)) onChange(next.trim().startsWith("#") ? next.trim().toLowerCase() : `#${next.trim().toLowerCase()}`)
        }}
        onBlur={() => {
          if (!valid) setRaw(value ?? "")
        }}
        spellCheck={false}
        aria-label={`${label} — HEX`}
        aria-invalid={!valid}
        placeholder="#000000"
        className={`${hexInputClass} mt-1 ${!valid ? "border-destructive/60 text-destructive focus:border-destructive focus:ring-destructive/40" : ""}`}
      />
    </div>
  </div>
}

function AppearanceSelect({ value, onChange, label, options, disabled, ui }: { value: string; onChange: (value: string) => void; label: string; options: { value: string; label: string }[]; disabled?: boolean; ui: string }) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger data-ui={ui} aria-label={label} className="h-10 w-full rounded-xl border-border bg-muted/40 text-xs text-foreground"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export function ThemeAppearanceControls({ theme, onChange, active }: { theme: Theme; onChange: Dispatch<SetStateAction<Theme>>; active: boolean }) {
  const { t } = useTranslation()
  const appearance = theme.appearance ?? {}
  const patch = (value: Partial<ThemeAppearance>) => onChange((current) => ({ ...current, appearance: { ...current.appearance, ...value } }))
  return <section data-ui="theme-appearance-controls" data-component="theme-appearance-controls" hidden={!active} className="rounded-2xl border border-border bg-muted/15 p-4">
    <h4 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><IconAdjustmentsHorizontal className="h-4 w-4 text-primary" stroke={1.75} />{t("themeAdvanced.title")}</h4>
    <div className="space-y-5">
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>{t("themeAdvanced.mode")}</span>
        <AppearanceSelect ui="theme-color-mode" label={t("themeAdvanced.mode")} value={appearance.colorMode ?? "palette"} options={["palette", "light", "dark", "system"].map(mode => ({ value: mode, label: t(`themeAdvanced.mode.${mode}`) }))} onChange={(selected) => {
          const value = selected as "palette" | "light" | "dark" | "system"
          onChange((current) => {
            const before = themeMode(current)
            const next = { ...current.appearance, [before === "light" ? "lightPalette" : "darkPalette"]: themePreviewColors(current), colorMode: value === "palette" ? undefined : value }
            const mode = value === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : value
            const palette = mode === "light" || mode === "dark" ? themePaletteForMode({ ...current, appearance: next }, mode) : current.palette
            return { ...current, appearance: next, palette }
          })
        }} />
        <p>{t("themeAdvanced.modeHint")}</p>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["titlebar", "error", "warning", "info", "success"] as const).map((key) => {
          const palette = themePreviewColors(theme)
          const fallback = key === "titlebar" ? palette.sidebar : key === "warning" || key === "success" ? palette.accent : palette.primary
          return <AppearanceColorField
            key={key}
            colorKey={key}
            label={t(`themeAdvanced.${key}`)}
            value={appearance[key]}
            fallback={fallback}
            onChange={(value) => patch({ [key]: value })}
          />
        })}
      </div>
    </div>
  </section>
}

export function ThemeAppearanceEffects({ theme, onChange, active }: { theme: Theme; onChange: Dispatch<SetStateAction<Theme>>; active: boolean }) {
  const { t } = useTranslation()
  const appearance = theme.appearance ?? {}
  const patch = (value: Partial<ThemeAppearance>) => onChange((current) => ({ ...current, appearance: { ...current.appearance, ...value } }))
  const [inheritedRadius, setInheritedRadius] = useState(12)
  useEffect(() => {
    if (!active || appearance.radius !== undefined) return
    const frame = requestAnimationFrame(() => {
      const rootStyle = getComputedStyle(document.documentElement)
      const raw = rootStyle.getPropertyValue("--radius").trim()
      const value = parseFloat(raw) * (raw.endsWith("rem") ? parseFloat(rootStyle.fontSize) : 1)
      if (Number.isFinite(value)) setInheritedRadius(Math.round(value))
    })
    return () => cancelAnimationFrame(frame)
  }, [active, appearance.radius, theme.font?.size, theme.css])
  const effectValue = (key: "blurTitlebar" | "blurSidebar" | "blurCard" | "radius") => appearance[key] ?? (key === "radius" ? inheritedRadius : 0)
  const motion = themeEnterMotion(theme)
  const animation = themeEnterAnimation(theme)
  const customName = appearance.enterKeyframes ?? THEME_ENTER_ANIMATIONS.custom
  return <section data-ui="theme-appearance-effects" hidden={!active} className="rounded-2xl border border-border bg-muted/15 p-4">
    <h4 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><IconAdjustmentsHorizontal className="h-4 w-4 text-primary" stroke={1.75} />{t("themeAdvanced.effectsTitle")}</h4>
    <div className="grid gap-3 sm:grid-cols-2">
      {(["blurTitlebar", "blurSidebar", "blurCard", "radius"] as const).map((key) => <label key={key} className="space-y-2 text-xs text-muted-foreground">
        <span className="flex justify-between"><span>{t(`themeAdvanced.${key}`)}</span><span>{effectValue(key)}px</span></span>
        <input data-ui="theme-effect" data-effect={key} type="range" min={0} max={40} value={effectValue(key)} onChange={(event) => patch({ [key]: Number(event.target.value) })} className={range} />
      </label>)}
    </div>
    <div data-ui="theme-enter-motion" className="mt-5 space-y-3 border-t border-border pt-4">
      <h5 className="text-sm font-medium">{t("themeMotion.title")}</h5>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>{t("themeMotion.animation")}</span>
        <AppearanceSelect ui="theme-enter-animation" label={t("themeMotion.animation")} value={animation}
          options={Object.keys(THEME_ENTER_ANIMATIONS).map(value => ({ value, label: t(`themeMotion.option.${value}`) }))}
          onChange={value => patch({ enterAnimation: value as ThemeAppearance["enterAnimation"] })} />
      </label>
      <label className="block space-y-2 text-xs text-muted-foreground">
        <span className="flex justify-between"><span>{t("themeMotion.duration")}</span><span>{t("themeMotion.milliseconds", { count: motion.duration })}</span></span>
        <input data-ui="theme-enter-duration" aria-label={t("themeMotion.duration")} type="range" min={100} max={2000} step={50} value={motion.duration} disabled={animation === "none"}
          onChange={event => patch({ enterDuration: Number(event.target.value) })} className={`${range} disabled:cursor-default disabled:opacity-40`} />
      </label>
      {animation === "custom" && <div className="space-y-2">
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>{t("themeMotion.keyframes")}</span>
          <input data-ui="theme-enter-keyframes" value={customName} maxLength={64} spellCheck={false} aria-invalid={!normalizeEnterKeyframes(customName)}
            onChange={event => patch({ enterKeyframes: event.target.value })} className={`${hexInputClass} w-full`} />
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("themeMotion.cssHint")}</p>
      </div>}
    </div>
  </section>
}

export function ThemeCssToggle({ enabled, onEnabled }: { enabled: boolean; onEnabled: (value: boolean) => void }) {
  const { t } = useTranslation()
  return <label data-ui="theme-css-enabled" className="flex items-center gap-2 text-xs">
    <Checkbox checked={enabled} onCheckedChange={(value) => onEnabled(value === true)} />
    {t("themeAdvanced.cssEnabled")}
  </label>
}
