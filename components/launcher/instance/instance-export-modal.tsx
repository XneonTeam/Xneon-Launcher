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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/78 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{t("instanceList.exportZip")}</p>
          <h3 className="mt-1 truncate text-lg font-semibold text-foreground">{buildName}</h3>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <IconLoader2 className="h-5 w-5 animate-spin" />
            </div>
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {t("instanceList.exportingHint")}
            </p>
            {percent !== null && <span className="shrink-0 text-sm font-semibold text-foreground">{percent}%</span>}
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            {percent === null ? (
              <div className="progress-indeterminate h-full w-full rounded-full bg-primary" />
            ) : (
              <div
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
