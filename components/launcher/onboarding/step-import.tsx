import { cn } from "@/lib/utils"
import { IconCheck, IconDownload, IconLoader2 } from "@tabler/icons-react"
import { LauncherSourceIcon } from "./icons"
import type { LauncherSource, OnboardingCopy } from "./translations"

type StepImportProps = {
  copy: OnboardingCopy
  importableInstances: ImportableLauncherInstance[]
  selectedImportIds: string[]
  importingInstances: boolean
  importedCount: number
  onToggle: (instanceId: string) => void
  onToggleSource: (source: string) => void
  onImport: () => void
}

function sourceBadge(source: string) {
  if (source === "xlauncher") return "bg-emerald-500/15 text-emerald-300 border-emerald-400/25"
  if (source === "gdlauncher") return "bg-sky-500/15 text-sky-300 border-sky-400/25"
  if (source === "prism") return "bg-violet-500/15 text-violet-300 border-violet-400/25"
  if (source === "astralrinth") return "bg-cyan-500/15 text-cyan-300 border-cyan-400/25"
  if (source === "modrinthapp") return "bg-orange-500/15 text-orange-300 border-orange-400/25"
  return "bg-muted text-muted-foreground border-border"
}

function formatMessage(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""))
}

export function StepImport({ copy, importableInstances, selectedImportIds, importingInstances, importedCount, onToggle, onToggleSource, onImport }: StepImportProps) {
  const grouped = importableInstances.reduce<Record<string, ImportableLauncherInstance[]>>((acc, inst) => {
    const key = inst.source
    if (!acc[key]) acc[key] = []
    acc[key].push(inst)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {importableInstances.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(grouped).map(([source, instances]) => {
                const sourceIds = instances.map((i) => i.id)
                const selectedCount = sourceIds.filter((id) => selectedImportIds.includes(id)).length
                const allSelected = selectedCount === sourceIds.length
                const noneSelected = selectedCount === 0
                return (
                  <button
                    key={source}
                    type="button"
                    onClick={() => onToggleSource(source)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all",
                      noneSelected ? "opacity-50" : "",
                      sourceBadge(source)
                    )}
                  >
                    <LauncherSourceIcon source={source as LauncherSource} className="h-4 w-4 shrink-0" />
                    <span>{copy.sourceNames[source] ?? source}</span>
                    <span className="text-current/70">•</span>
                    <span>{selectedCount}/{instances.length}</span>
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={onImport}
              disabled={!selectedImportIds.length || importingInstances}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importingInstances ? <IconLoader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <IconDownload className="h-4 w-4" strokeWidth={1.9} />}
              {importingInstances
                ? copy.importingButton
                : `${copy.importButton}${selectedImportIds.length ? ` (${selectedImportIds.length})` : ""}`}
            </button>
          </div>

          <div className="grid max-h-[340px] gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
            {importableInstances.map((instance) => {
              const counts = [
                instance.modCount ? `${instance.modCount} ${copy.modsLabel}` : null,
                instance.resourcepackCount ? `${instance.resourcepackCount} ${copy.resourcepacksLabel}` : null,
                instance.shaderCount ? `${instance.shaderCount} ${copy.shadersLabel}` : null,
              ].filter(Boolean).join(" • ")

              return (
                <button
                  key={instance.id}
                  type="button"
                  onClick={() => onToggle(instance.id)}
                  className={cn(
                    "relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200",
                    selectedImportIds.includes(instance.id)
                      ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
                      {instance.icon ? (
                        <img src={instance.icon} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-lg font-semibold text-muted-foreground">{instance.name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-base font-semibold text-foreground">{instance.name}</div>
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", sourceBadge(instance.source))}>
                          <LauncherSourceIcon source={instance.source} className="h-3.5 w-3.5 shrink-0" />
                          {copy.sourceNames[instance.source] ?? instance.source}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">{instance.version} • {instance.modLoader}</div>
                      {counts && <div className="mt-3 text-sm text-muted-foreground">{counts}</div>}
                    </div>
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                        selectedImportIds.includes(instance.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-transparent"
                      )}
                    >
                      <IconCheck className="h-4 w-4" strokeWidth={2.4} />
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {importedCount > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
              {formatMessage(copy.importCompleted, { count: importedCount })}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm leading-6 text-muted-foreground">
          {copy.importEmpty}
        </div>
      )}
    </div>
  )
}
