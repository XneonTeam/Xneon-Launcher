import { IconLoader2 } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

interface InstanceExportModalProps {
  buildName: string
  current: number | null
  total: number | null
}

/** Прогресс экспорта сборки: тот же оверлей, что и при импорте. */
export function InstanceExportModal({ buildName, current, total }: InstanceExportModalProps) {
  const { t } = useTranslation()
  const percent = current !== null && total !== null && total > 0
    ? Math.min(100, Math.round((current / total) * 100))
    : null

  return (
    // Тот же фон, что у оверлея импорта и обычных диалогов: `bg-background/78`
    // на тёмной теме превращал экран в чёрный.
    <div data-ui="instance-instance-export-modal-div-1" data-component="instance-export-modal" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div data-ui="instance-instance-export-modal-div-2" className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl">
        <div data-ui="instance-instance-export-modal-div-3" className="border-b border-border px-5 py-4">
          <p data-ui="instance-instance-export-modal-p-1" className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{t("instanceList.exportZip")}</p>
          <h3 data-ui="instance-instance-export-modal-h3-1" className="mt-1 truncate text-lg font-semibold text-foreground">{buildName}</h3>
        </div>

        <div data-ui="instance-instance-export-modal-div-4" className="space-y-4 px-5 py-5">
          <div data-ui="instance-instance-export-modal-div-5" className="flex items-center gap-3">
            <div data-ui="instance-instance-export-modal-div-6" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <IconLoader2 className="h-5 w-5 animate-spin" />
            </div>
            <p data-ui="instance-instance-export-modal-p-2" className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {t("instanceList.exportingHint")}
            </p>
            {percent !== null && <span data-ui="instance-instance-export-modal-span-1" className="shrink-0 text-sm font-semibold text-foreground">{percent}%</span>}
          </div>

          <div data-ui="instance-instance-export-modal-div-7" className="h-1.5 overflow-hidden rounded-full bg-muted">
            {percent === null ? (
              <div data-ui="instance-instance-export-modal-div-8" className="progress-indeterminate h-full w-full rounded-full bg-primary" />
            ) : (
              <div data-ui="instance-instance-export-modal-div-9"
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
