import { cn } from "@/lib/utils"
import { IconCheck, IconPalette } from "@tabler/icons-react"
import { Checkbox } from "@/components/ui/checkbox"
import { presetThemes, applyTheme, applyCustomTheme } from "./data"
import type { Theme } from "./types"

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
                <div className="w-8 h-8 rounded-lg shadow-inner" style={{ backgroundColor: theme.primary }} />
                <div className="w-8 h-8 rounded-lg shadow-inner" style={{ backgroundColor: theme.accent }} />
                <div className="w-8 h-8 rounded-lg border border-white/20 shadow-inner" style={{ backgroundColor: theme.background }} />
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
          <div
            className="w-full h-24 rounded-xl mb-6 flex items-center justify-center gap-4 border border-white/10"
            style={{ backgroundColor: customTheme.background }}
          >
            <div className="px-4 py-2 rounded-lg font-medium text-white shadow-lg" style={{ backgroundColor: customTheme.primary }}>Кнопка</div>
            <div className="px-4 py-2 rounded-lg font-medium text-white shadow-lg" style={{ backgroundColor: customTheme.accent }}>Акцент</div>
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
