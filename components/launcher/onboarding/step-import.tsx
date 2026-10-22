import { cn } from "@/lib/utils"
import { IconCheck, IconDownload, IconLoader2 } from "@tabler/icons-react"
import { LauncherSourceIcon } from "./icons"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import type { LauncherSource, OnboardingCopy } from "./translations"

type StepImportProps = {
  copy: OnboardingCopy
  importableInstances: ImportableLauncherInstance[]
  selectedImportIds: string[]
  activeFilter: string | null
  importingInstances: boolean
  importedCount: number
  onToggle: (instanceId: string) => void
  onFilterSource: (source: string) => void
  onImport: () => void
}

const sourceBadge = "bg-primary/10 text-primary border-primary/25"

function formatMessage(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""))
}

export function StepImport({ copy, importableInstances, selectedImportIds, activeFilter, importingInstances, importedCount, onToggle, onFilterSource, onImport }: StepImportProps) {
  const grouped = importableInstances.reduce<Record<string, ImportableLauncherInstance[]>>((acc, inst) => {
    const key = inst.source
    if (!acc[key]) acc[key] = []
    acc[key].push(inst)
    return acc
  }, {})

  const visibleInstances = activeFilter
    ? importableInstances.filter((i) => i.source === activeFilter)
    : importableInstances

  return (
    <div data-ui="onboarding-step-import-div-1" data-component="step-import" className="space-y-5">
      {importableInstances.length > 0 ? (
        <>
          <div data-ui="onboarding-step-import-div-2" className="flex items-center justify-between gap-3">
            <div data-ui="onboarding-step-import-div-3" className="flex flex-wrap gap-2">
              {Object.entries(grouped).map(([source, instances]) => {
                const isActive = activeFilter === source
                const sourceIds = instances.map((i) => i.id)
                const selectedCount = sourceIds.filter((id) => selectedImportIds.includes(id)).length
                return (
                  <button data-ui="onboarding-step-import-button-1"
                    key={source}
                    type="button"
                    onClick={() => onFilterSource(source)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all",
                      !isActive && activeFilter ? "opacity-40" : "",
                      sourceBadge
                    )}
                  >
                    <LauncherSourceIcon source={source as LauncherSource} className="h-4 w-4 shrink-0" />
                    <span data-ui="onboarding-step-import-span-1">{copy.sourceNames[source] ?? source}</span>
                    <span data-ui="onboarding-step-import-span-2" className="text-current/70">•</span>
                    <span data-ui="onboarding-step-import-span-3">{selectedCount}/{instances.length}</span>
                  </button>
                )
              })}
            </div>
            <button data-ui="onboarding-step-import-button-2"
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

          <div data-ui="onboarding-step-import-div-4" className="grid max-h-[340px] gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
            {visibleInstances.map((instance) => {
              const counts = [
                instance.modCount ? `${instance.modCount} ${copy.modsLabel}` : null,
                instance.resourcepackCount ? `${instance.resourcepackCount} ${copy.resourcepacksLabel}` : null,
                instance.shaderCount ? `${instance.shaderCount} ${copy.shadersLabel}` : null,
              ].filter(Boolean).join(" • ")

              return (
                <button data-ui="onboarding-step-import-button-3"
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
                  <div data-ui="onboarding-step-import-div-5" className="flex items-start gap-4">
                    <div data-ui="onboarding-step-import-div-6" className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
                      {instance.icon ? (
                        <img data-ui="onboarding-step-import-img-1" src={instance.icon} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span data-ui="onboarding-step-import-span-4" className="text-lg font-semibold text-muted-foreground">{instance.name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div data-ui="onboarding-step-import-div-7" className="min-w-0 flex-1">
                      <div data-ui="onboarding-step-import-div-8" className="flex flex-wrap items-center gap-2">
                        <div data-ui="onboarding-step-import-div-9" className="truncate text-base font-semibold text-foreground">{instance.name}</div>
                        <span data-ui="onboarding-step-import-span-5" className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", sourceBadge)}>
                          <LauncherSourceIcon source={instance.source} className="h-3.5 w-3.5 shrink-0" />
                          {copy.sourceNames[instance.source] ?? instance.source}
                        </span>
                      </div>
                      <div data-ui="onboarding-step-import-div-10" className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span data-ui="onboarding-step-import-span-6">{instance.version}</span>
                        <span data-ui="onboarding-step-import-span-7">•</span>
                        <LoaderIcon loaderId={instance.modLoader} className="w-4 h-4 flex-shrink-0" />
                        <span data-ui="onboarding-step-import-span-8" className="capitalize">{instance.modLoader}</span>
                      </div>
                      {counts && <div data-ui="onboarding-step-import-div-11" className="mt-3 text-sm text-muted-foreground">{counts}</div>}
                    </div>
                    <div data-ui="onboarding-step-import-div-12"
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
            <div data-ui="onboarding-step-import-div-13" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
              {formatMessage(copy.importCompleted, { count: importedCount })}
            </div>
          )}
        </>
      ) : (
        <div data-ui="onboarding-step-import-div-14" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm leading-6 text-muted-foreground">
          {copy.importEmpty}
        </div>
      )}
    </div>
  )
}
