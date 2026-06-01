import { IconLoader2 } from "@tabler/icons-react"
import type { ImportProgressState } from "./use-import"

interface InstanceImportOverlayProps {
  importProgress: ImportProgressState | null
  importError: string | null
  isCancelling: boolean
  onCancel: () => void
}

function formatItemName(itemName?: string): string | null {
  if (!itemName) return null
  const trimmed = itemName.trim()
  if (!trimmed) return null
  return trimmed
}

function formatProgressLabel(message: string, source: ImportProgressState["source"]): string {
  const trimmed = message.trim()
  if (!trimmed) {
    return source === "curseforge" ? "Загрузка модов" : "Загрузка файлов"
  }

  if (/^\d+\s*\/\s*\d+/.test(trimmed)) {
    return source === "curseforge" ? "Загрузка модов" : "Загрузка файлов"
  }

  return trimmed
}

export function InstanceImportOverlay({
  importProgress,
  importError,
  isCancelling,
  onCancel,
}: InstanceImportOverlayProps) {
  if (!importProgress) return null

  const total = Math.max(importProgress.total, 1)
  const current = Math.min(importProgress.current, total)
  const progressPercent = Math.max(0, Math.min(100, Math.round((current / total) * 100)))
  const currentItem = formatItemName(importProgress.itemName)
  const progressLabel = formatProgressLabel(importProgress.message, importProgress.source)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/78 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Импорт модпака</p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">Загрузка сборки</h3>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <IconLoader2 className="h-5 w-5 animate-spin" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{progressLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {current} из {total}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-foreground">{progressPercent}%</span>
          </div>

          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-end text-[11px] text-muted-foreground">
              <span>{current}/{total}</span>
            </div>
          </div>

          {currentItem && (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Сейчас скачивается</p>
              <p className="mt-2 truncate text-sm text-foreground" title={currentItem}>{currentItem}</p>
            </div>
          )}

          {importError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {importError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCancelling ? "Отмена..." : "Отменить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
