import { useCallback, useEffect, useState } from "react"
import { IconX, IconLoader2, IconDownload } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

interface ModDependency {
  projectId: string
  versionId?: string | null
  fileName?: string | null
  dependencyType: "required" | "optional" | "incompatible" | "embedded"
  name?: string
  slug?: string
  iconUrl?: string
}

interface ModVersion {
  id: string
  name: string
  gameVersion: string
  downloadCount: number
  fileName: string
  fileSize: number
  downloadUrl?: string
  versionType?: "release" | "beta" | "alpha"
  loaders?: string[]
  changelog?: string
  datePublished?: string
  files?: { url: string; size: number; filename: string }[]
  dependencies?: ModDependency[]
}

interface DepInstallDialogProps {
  version: ModVersion
  modName: string
  modIcon: string
  source: "modrinth" | "curseforge"
  resolvedDeps?: ModDependency[]
  onConfirm: (selectedDeps: ModDependency[]) => void
  onCancel: () => void
}

export function DepInstallDialog({ version, modName, modIcon, source, resolvedDeps, onConfirm, onCancel }: DepInstallDialogProps) {
  const [deps, setDeps] = useState<ModDependency[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function resolve() {
      try {
        const resolved = resolvedDeps ?? await window.electronAPI?.modsResolveDependencies(version, source) ?? []
        if (cancelled) return
        setDeps(resolved)
        const initialSelected = new Set(resolved.filter(d => d.dependencyType === "required").map(d => d.projectId))
        setSelected(initialSelected)
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [version, source, resolvedDeps])

  const toggle = useCallback((projectId: string, depType: string) => {
    if (depType === "required") return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }, [])

  const hasDeps = deps.length > 0

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-lg max-h-[70vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold text-foreground">Установка зависимостей</h3>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <IconLoader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !hasDeps ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-4">Нет зависимостей для {modName}</p>
            <button
              onClick={() => onConfirm([])}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 mx-auto"
            >
              <IconDownload className="w-4 h-4" />
              Установить
            </button>
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">Выбери зависимости для установки вместе с <strong className="text-foreground">{modName}</strong></p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {deps.map(dep => {
                const isRequired = dep.dependencyType === "required"
                const isChecked = selected.has(dep.projectId)
                const isEmbedded = dep.dependencyType === "embedded"
                return (
                  <label
                    key={dep.projectId}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors",
                      isChecked ? "bg-primary/10 border border-primary/30" : "bg-muted/20 border border-transparent hover:bg-muted/30",
                      isRequired && "opacity-90",
                    )}
                  >
                    {dep.iconUrl ? (
                      <img src={dep.iconUrl} alt="" className="w-8 h-8 rounded-lg flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 text-xs font-bold text-muted-foreground">
                        {dep.name?.[0] ?? "?"}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{dep.name ?? dep.projectId}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {isRequired ? "Обязательная" : isEmbedded ? "Встроенная" : "Опциональная"}
                      </p>
                    </div>
                    {!isEmbedded && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isRequired}
                        onChange={() => toggle(dep.projectId, dep.dependencyType)}
                        className="w-4 h-4 rounded accent-primary"
                      />
                    )}
                  </label>
                )
              })}
            </div>
            <div className="p-3 border-t border-border flex justify-end gap-2 flex-shrink-0">
              <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Отмена
              </button>
              <button
                onClick={() => onConfirm(deps.filter(d => selected.has(d.projectId)))}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <IconDownload className="w-4 h-4" />
                Установить ({selected.size + 1} всего)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
