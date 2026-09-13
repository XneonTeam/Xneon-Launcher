import { useCallback, useEffect, useState } from "react"
import { IconTrash, IconRefresh, IconLoader2 } from "@tabler/icons-react"
import { ActionConfirmDialog } from "./action-confirm-dialog"

interface TrashItem {
  trashName: string
  originalName: string
  trashedAt: number
  icon?: string
}

interface InstanceTrashViewProps {
  goToMyBuilds: () => void
  /** Восстанавливает сборку из корзины: папку, запись в БД и состояние списка. */
  onRestore: (item: { trashName: string; originalName: string }) => Promise<boolean>
}

export function InstanceTrashView({ goToMyBuilds, onRestore }: InstanceTrashViewProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringName, setRestoringName] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TrashItem | null>(null)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTrash = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.listTrashBuilds()
      setItems(result ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTrash() }, [loadTrash])

  const handleRestore = useCallback(async (item: TrashItem) => {
    if (!window.electronAPI) return
    setRestoringName(item.trashName)
    try {
      const ok = await onRestore(item)
      if (!ok) {
        setError("Не удалось восстановить сборку")
        return
      }
      await loadTrash()
      goToMyBuilds()
    } finally {
      setRestoringName(null)
    }
  }, [onRestore, loadTrash, goToMyBuilds])

  const handleDeleteForever = useCallback(async (item: TrashItem) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.deleteTrashItem(item.trashName)
      if (result && !result.success) {
        setError(result.error ?? "Не удалось удалить сборку из корзины")
        return
      }
      await loadTrash()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить сборку из корзины")
    }
  }, [loadTrash])

  const handlePurgeAll = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.purgeBuildTrash()
      if (result && !result.success) {
        setError(result.error ?? "Не удалось очистить корзину")
        return
      }
      setItems([])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось очистить корзину")
    }
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Загрузка...
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Корзина пуста
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{items.length} элемент(ов)</p>
        <button type="button" onClick={() => setPurgeOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
          <IconTrash className="w-3.5 h-3.5" />
          Очистить корзину
        </button>
      </div>

      {items.map((item) => (
        <div key={item.trashName}
          className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden">
            {item.icon
              ? <img src={item.icon} alt="" className="w-9 h-9 object-cover" />
              : <IconTrash className="w-4 h-4 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{item.originalName}</p>
            <p className="text-xs text-muted-foreground">
              Удалено {new Date(item.trashedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <button type="button" onClick={() => handleRestore(item)} disabled={restoringName !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {restoringName === item.trashName
              ? <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
              : <IconRefresh className="w-3.5 h-3.5" />}
            Восстановить
          </button>
          <button type="button" onClick={() => setPendingDelete(item)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <ActionConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) void handleDeleteForever(pendingDelete) }}
        title="Удалить сборку навсегда?"
        description={`Сборка «${pendingDelete?.originalName ?? ""}» и все её файлы будут удалены без возможности восстановления.`}
        confirmText="Удалить навсегда"
        cancelText="Отмена"
        variant="danger"
        icon="warning"
      />

      <ActionConfirmDialog
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        onConfirm={() => void handlePurgeAll()}
        title="Очистить корзину?"
        description={`Все ${items.length} сборок в корзине будут удалены без возможности восстановления.`}
        confirmText="Очистить"
        cancelText="Отмена"
        variant="danger"
        icon="warning"
      />

      <ActionConfirmDialog
        open={error !== null}
        onClose={() => setError(null)}
        title="Ошибка"
        description={error ?? ""}
        type="alert"
        variant="danger"
        icon="warning"
        confirmText="Понятно"
      />
    </div>
  )
}
