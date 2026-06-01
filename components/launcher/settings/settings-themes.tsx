import { cn } from "@/lib/utils"
import { IconCheck, IconPalette } from "@tabler/icons-react"
import { Checkbox } from "@/components/ui/checkbox"
import { presetThemes, applyTheme, applyCustomTheme } from "./data"
import type { Theme } from "./types"

function ThemePreview({ primary, accent, background }: { primary: string; accent: string; background: string }) {
  return (
    <svg width="72" height="32" viewBox="0 0 72 32" className="rounded-lg overflow-hidden shadow-inner">
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="72" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={background} />
          <stop offset="100%" stopColor={background} />
        </linearGradient>
        <linearGradient id="priGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={primary} />
          <stop offset="100%" stopColor={accent} />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="72" height="32" fill="url(#bgGrad)" />
      <circle cx="18" cy="16" r="8" fill={primary} opacity="0.85" filter="url(#glow)" />
      <circle cx="36" cy="16" r="6" fill={accent} opacity="0.7" />
      <path d="M54 8 L66 16 L54 24 Z" fill={primary} opacity="0.5" />
      <rect x="58" y="12" width="8" height="8" rx="2" fill={accent} opacity="0.6" />
    </svg>
  )
}

function CustomThemePreview({ primary, accent, background }: { primary: string; accent: string; background: string }) {
  return (
    <svg width="200" height="80" viewBox="0 0 200 80" className="rounded-xl overflow-hidden border border-white/10">
      <defs>
        <linearGradient id="cBg" x1="0" y1="0" x2="200" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={background} />
          <stop offset="100%" stopColor={background} />
        </linearGradient>
        <linearGradient id="cPri" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={primary} />
          <stop offset="100%" stopColor={accent} />
        </linearGradient>
      </defs>
      <rect width="200" height="80" fill="url(#cBg)" />
      <rect x="20" y="20" width="60" height="40" rx="8" fill={primary} opacity="0.9" />
      <rect x="90" y="30" width="40" height="20" rx="6" fill={accent} opacity="0.8" />
      <circle cx="170" cy="40" r="15" fill="url(#cPri)" opacity="0.7" />
      <text x="100" y="75" textAnchor="middle" fill="#ffffff" opacity="0.3" fontSize="8" fontFamily="monospace">
        Preview
      </text>
    </svg>
  )
}

interface SettingsThemesProps {
  selectedTheme: string
  setSelectedTheme: (id: string) => void
  useCustomTheme: boolean
  setUseCustomTheme: (v: boolean) => void
  customTheme: Theme
  setCustomTheme: (t: Theme) => void
}

export function SettingsThemes({
  selectedTheme,
  setSelectedTheme,
  useCustomTheme,
  setUseCustomTheme,
  customTheme,
  setCustomTheme,
}: SettingsThemesProps) {
  return (
    <div className="space-y-8 animate-in fade-in-0 slide-in-from-left-4 duration-300">
      <section className="space-y-4">
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          <IconPalette className="w-5 h-5 text-primary" strokeWidth={1.5} />
          Готовые темы
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {presetThemes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => {
                setSelectedTheme(theme.id)
                setUseCustomTheme(false)
                applyTheme(theme)
                localStorage.setItem("theme", theme.id)
              }}
              className={cn(
                "relative p-4 rounded-xl border transition-all duration-200 text-left overflow-hidden",
                selectedTheme === theme.id && !useCustomTheme
                  ? "border-primary shadow-[0_0_15px_var(--glow-primary)]"
                  : "border-border hover:border-primary/50"
              )}
              style={{ backgroundColor: theme.background }}
            >
              <div className="flex gap-2 mb-3">
                <ThemePreview primary={theme.primary} accent={theme.accent} background={theme.background} />
              </div>
              <span className="font-medium text-white">{theme.name}</span>
              {selectedTheme === theme.id && !useCustomTheme && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                  <IconCheck className="w-4 h-4 text-primary-foreground" strokeWidth={2} />
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
            <IconPalette className="w-5 h-5 text-accent" strokeWidth={1.5} />
            Создать свою тему
          </h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={useCustomTheme}
              onCheckedChange={(v) => {
                setUseCustomTheme(!!v)
                if (v) {
                  applyCustomTheme(customTheme.primary, customTheme.accent)
                } else {
                  const preset = presetThemes.find(t => t.id === selectedTheme) || presetThemes[0]
                  applyTheme(preset)
                }
              }}
            />
            <span className="text-sm text-muted-foreground">Использовать</span>
          </label>
        </div>

        <div className={cn(
          "p-6 rounded-xl border transition-all duration-300",
          useCustomTheme ? "border-accent bg-accent/5 shadow-[0_0_15px_var(--glow-accent)]" : "border-border bg-muted/30"
        )}>
          <div className="w-full mb-6 flex items-center justify-center">
            <CustomThemePreview primary={customTheme.primary} accent={customTheme.accent} background={customTheme.background} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            {(["primary", "accent", "background"] as const).map((key) => (
              <div key={key} className="space-y-2">
                <label className="text-sm text-muted-foreground capitalize">{key === "primary" ? "Основной" : key === "accent" ? "Акцент" : "Фон"}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={customTheme[key]}
                    onChange={(e) => {
                      const updated = { ...customTheme, [key]: e.target.value }
                      setCustomTheme(updated)
                      if (useCustomTheme) applyCustomTheme(updated.primary, updated.accent)
                    }}
                    className="w-12 h-12 rounded-lg cursor-pointer border-0 bg-transparent"
                  />
                  <input
                    type="text"
                    value={customTheme[key]}
                    onChange={(e) => setCustomTheme({ ...customTheme, [key]: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg bg-input border border-border text-foreground font-mono text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
