// ============================================================
// XNLC — Trash view (общий)
// Одна страница корзины для сборок и серверов: список удалённых
// элементов, восстановление, удаление навсегда и очистка корзины.
// Отличается только содержимое — его задаёт вызывающая сторона через
// `row()` (аватарка, метаданные) и колбэки IPC.
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { IconTrash, IconRefresh, IconLoader2, IconCheck } from "@tabler/icons-react"
import { EmptyState } from "@/components/ui/empty-state"
import { EntityIcon } from "./instance/entity-icon"
import { ActionConfirmDialog } from "./instance/action-confirm-dialog"

/** Одна строка корзины: что показать про удалённый элемент. */
export type TrashRowData = {
  /** Стабильный ключ строки (id сборки/сервера, имя папки в корзине). */
  key: string
  name: string
  /** Своя аватарка: встроенный логотип, data URL или ссылка. */
  icon?: string | null
  /** Отступ картинки внутри аватарки (по умолчанию p-0.5). */
  iconPadding?: string
  /** Заглушка вместо аватарки: логотип загрузчика, иконка сервера и т.п. */
  fallbackIcon?: ReactNode
  /** Строка метаданных под названием (загрузчик, версия). */
  meta?: ReactNode
  /** Дополнительная строка (дата удаления) — форматирует вызывающая сторона. */
  extra?: ReactNode
}

/** Подписи: каждая страница берёт свои ключи i18n, тексты остаются на её совести. */
export interface TrashLabels {
  loading: string
  empty: string
  itemCount: (count: number) => string
  restore: string
  purgeAll: string
  deleteForeverTitle: string
  deleteForeverDescription: (name: string) => string
  deleteForeverConfirm: string
  purgeConfirmTitle: string
  purgeConfirmDescription: (count: number) => string
  purgeConfirmConfirm: string
  cancel: string
  errorTitle: string
  errorRestore: string
  errorDelete: string
  errorPurge: string
  gotIt: string
}

/** Дополнительная опция в окне подтверждения (например, «удалить туннель»). */
export interface TrashConfirmExtra {
  label: string
  icon?: ReactNode
  /** Значение по умолчанию; по умолчанию — включено. */
  defaultChecked?: boolean
}

/** Значение доп. опции, которое получают колбэки удаления. */
export type TrashConfirmOptions = { extra: boolean }

type TrashViewProps<T> = {
  load: () => Promise<T[]>
  row: (item: T) => TrashRowData
  /** Восстановление. `false` — показать ошибку восстановления. */
  onRestore: (item: T) => Promise<boolean | void>
  onDeleteForever: (item: T, options: TrashConfirmOptions) => Promise<void>
  onPurgeAll: (options: TrashConfirmOptions) => Promise<void>
  labels: TrashLabels
  confirmExtra?: TrashConfirmExtra
  /** Вызывается после успешного восстановления (переход в список, возврат назад). */
  afterRestore?: () => void
}

export function TrashView<T>({
  load,
  row,
  onRestore,
  onDeleteForever,
  onPurgeAll,
  labels,
  confirmExtra,
  afterRestore,
}: TrashViewProps<T>) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringKey, setRestoringKey] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<T | null>(null)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [extraChecked, setExtraChecked] = useState(confirmExtra?.defaultChecked ?? true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await load())
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => { void reload() }, [reload])

  const handleRestore = useCallback(async (item: T, key: string) => {
    setRestoringKey(key)
    try {
      const ok = await onRestore(item)
      if (ok === false) {
        setError(labels.errorRestore)
        return
      }
      await reload()
      afterRestore?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.errorRestore)
    } finally {
      setRestoringKey(null)
    }
  }, [onRestore, reload, afterRestore, labels])

  const handleDeleteForever = useCallback(async (item: T) => {
    try {
      await onDeleteForever(item, { extra: extraChecked })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.errorDelete)
    }
  }, [onDeleteForever, extraChecked, reload, labels])

  const handlePurgeAll = useCallback(async () => {
    try {
      await onPurgeAll({ extra: extraChecked })
      setItems([])
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.errorPurge)
    }
  }, [onPurgeAll, extraChecked, labels])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        {labels.loading}
      </div>
    )
  }

  if (items.length === 0) {
    return <EmptyState variant="trash" title={labels.empty} className="flex-1" />
  }

  /** Переключатель доп. опции: рендерится в обоих окнах подтверждения. */
  const confirmOption = confirmExtra ? (
    <button
      type="button"
      onClick={() => setExtraChecked((v) => !v)}
      className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50"
    >
      <span
        className={
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors " +
          (extraChecked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-muted/50")
        }
      >
        {extraChecked && <IconCheck className="h-3 w-3" strokeWidth={3} />}
      </span>
      {confirmExtra.icon}
      <span className="text-sm text-foreground">{confirmExtra.label}</span>
    </button>
  ) : null

  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{labels.itemCount(items.length)}</p>
        <button type="button" onClick={() => { setExtraChecked(confirmExtra?.defaultChecked ?? true); setPurgeOpen(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
          <IconTrash className="w-3.5 h-3.5" />
          {labels.purgeAll}
        </button>
      </div>

      {items.map((item) => {
        const data = row(item)
        return (
          <div key={data.key}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors">
            {/* Аватарка та же, что и в обычном списке раздела: своя иконка,
                а без неё — цветная плашка с заглушкой вызывающей стороны. */}
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              {data.icon ? (
                <EntityIcon
                  src={data.icon}
                  className={`w-full h-full ${data.iconPadding ?? "p-0.5"} text-primary`}
                  imgClassName="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 flex items-center justify-center">
                  {data.fallbackIcon}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{data.name}</p>
              {data.meta}
              {data.extra}
            </div>
            <button type="button" onClick={() => void handleRestore(item, data.key)} disabled={restoringKey !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {restoringKey === data.key
                ? <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                : <IconRefresh className="w-3.5 h-3.5" />}
              {labels.restore}
            </button>
            <button type="button" onClick={() => { setExtraChecked(confirmExtra?.defaultChecked ?? true); setPendingDelete(item) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
              <IconTrash className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}

      <ActionConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) void handleDeleteForever(pendingDelete) }}
        title={labels.deleteForeverTitle}
        description={labels.deleteForeverDescription(pendingDelete ? row(pendingDelete).name : "")}
        confirmText={labels.deleteForeverConfirm}
        cancelText={labels.cancel}
        variant="danger"
        icon="warning"
        extra={confirmOption}
      />

      <ActionConfirmDialog
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        onConfirm={() => void handlePurgeAll()}
        title={labels.purgeConfirmTitle}
        description={labels.purgeConfirmDescription(items.length)}
        confirmText={labels.purgeConfirmConfirm}
        cancelText={labels.cancel}
        variant="danger"
        icon="warning"
        extra={confirmOption}
      />

      <ActionConfirmDialog
        open={error !== null}
        onClose={() => setError(null)}
        title={labels.errorTitle}
        description={error ?? ""}
        type="alert"
        variant="danger"
        icon="warning"
        confirmText={labels.gotIt}
      />
    </div>
  )
}