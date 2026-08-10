import { cn } from "@/lib/utils"
import { IconCheck, IconPalette } from "@tabler/icons-react"
import { presetThemes, applyTheme } from "./data"

interface SettingsThemesProps {
  selectedTheme: string
  setSelectedTheme: (id: string) => void
}

export function SettingsThemes({ selectedTheme, setSelectedTheme }: SettingsThemesProps) {
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
                applyTheme(theme)
                localStorage.setItem("theme", theme.id)
              }}
              className={cn(
                "relative p-4 rounded-xl border transition-all duration-200 text-left overflow-hidden",
                selectedTheme === theme.id
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
              {selectedTheme === theme.id && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                  <IconCheck className="w-4 h-4 text-primary-foreground" strokeWidth={2} />
                </div>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
