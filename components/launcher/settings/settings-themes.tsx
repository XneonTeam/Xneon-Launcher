import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import { IconCheck, IconPalette } from "@tabler/icons-react"
import { presetThemes, applyTheme } from "./data"

interface SettingsThemesProps {
  selectedTheme: string
  setSelectedTheme: (id: string) => void
}

export function SettingsThemes({ selectedTheme, setSelectedTheme }: SettingsThemesProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-8 animate-in fade-in-0 slide-in-from-left-4 duration-300">
      <section className="space-y-4">
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          <IconPalette className="w-5 h-5 text-primary" strokeWidth={1.75} />
          {t("settings.themes.presets")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {presetThemes.map((theme) => {
            const selected = selectedTheme === theme.id
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setSelectedTheme(theme.id)
                  applyTheme(theme)
                  localStorage.setItem("theme", theme.id)
                  window.electronAPI?.setSetting("theme", theme.id)
                }}
                className={cn(
                  "rounded-2xl border p-3.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  selected
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/30"
                )}
              >
                {/*
                  Миниатюра окна лаунчера вместо абстрактных кружков: сразу видно,
                  что именно меняет тема — акцент и подсветку; фон у всех общий.
                */}
                <div className="mb-3 flex h-12 w-full overflow-hidden rounded-xl border border-border/60 bg-[#18181b]">
                  <div className="h-full w-3.5 shrink-0" style={{ backgroundColor: theme.primary }} />
                  <div className="flex flex-1 flex-col gap-1.5 p-2">
                    <div className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: theme.primary }} />
                    <div className="h-1.5 w-2/5 rounded-full bg-white/10" />
                    <div className="mt-auto h-2.5 w-1/3 rounded-md" style={{ backgroundColor: theme.accent }} />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{theme.name}</span>
                  {selected && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                      <IconCheck className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2.5} />
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}