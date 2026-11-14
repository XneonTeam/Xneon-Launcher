import type { ReactNode } from "react"
import { IconDownload, IconX } from "@tabler/icons-react"
import { ModalLayer } from "@/components/ui/modal-layer"
import { Checkbox } from "@/components/ui/checkbox"

export type ExportCategoryOption<T extends string> = {
  id: T
  label: string
  description: string
  icon?: ReactNode
}

type ExportCategoriesDialogProps<T extends string> = {
  windowId: string
  title: string
  description: string
  categories: ExportCategoryOption<T>[]
  selected: ReadonlySet<T>
  onSelectedChange: (selected: Set<T>) => void
  onClose: () => void
  onExport: () => void
  selectAllLabel: string
  cancelLabel: string
  exportLabel: string
}

/** Единый выбор содержимого ZIP для сборок и серверов: тот же слой, панель и поведение. */
export function ExportCategoriesDialog<T extends string>({
  windowId, title, description, categories, selected, onSelectedChange,
  onClose, onExport, selectAllLabel, cancelLabel, exportLabel,
}: ExportCategoriesDialogProps<T>) {
  return (
    <ModalLayer windowId={windowId} className="p-4" onClose={onClose}>
      <div data-component="export-categories-dialog" className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
          <button data-modal-close type="button" onClick={onClose} aria-label={cancelLabel} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {categories.map(category => (
            <label key={category.id} data-category={category.id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 cursor-pointer transition-colors hover:border-primary/40">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">{category.icon}</span>
              <Checkbox
                checked={selected.has(category.id)}
                onCheckedChange={checked => {
                  const next = new Set(selected)
                  if (checked === true) next.add(category.id)
                  else next.delete(category.id)
                  onSelectedChange(next)
                }}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{category.label}</span>
                <span className="block text-xs text-muted-foreground">{category.description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button data-action="select-all" type="button" onClick={() => onSelectedChange(new Set(categories.map(category => category.id)))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">
            {selectAllLabel}
          </button>
          <div className="flex gap-2">
            <button data-action="cancel" type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted text-muted-foreground">
              <span className="inline-flex items-center justify-center gap-2"><IconX className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{cancelLabel}</span>
            </button>
            <button data-action="export" type="button" disabled={selected.size === 0} onClick={onExport}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
              <IconDownload className="w-4 h-4" />
              {exportLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalLayer>
  )
}
