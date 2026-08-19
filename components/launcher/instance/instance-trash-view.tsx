import { useCallback, useEffect, useState } from "react"
import { IconTrash, IconRefresh, IconFolder } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

interface TrashItem {
  trashName: string
  originalName: string
  trashedAt: number
}

interface InstanceTrashViewProps {
  goToMyBuilds: () => void
}

export function InstanceTrashView({ goToMyBuilds }: InstanceTrashViewProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)

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
    await window.electronAPI.restoreBuildIntentFromTrash(item.originalName, item.trashName)
    await loadTrash()
    goToMyBuilds()
  }, [loadTrash, goToMyBuilds])

  const handleDeleteForever = useCallback(async (item: TrashItem) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteTrashItem(item.trashName)
    await loadTrash()
  }, [loadTrash])

  const handlePurgeAll = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.purgeBuildTrash()
    setItems([])
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
        <button type="button" onClick={handlePurgeAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
          <IconTrash className="w-3.5 h-3.5" />
          Очистить корзину
        </button>
      </div>

      {items.map((item) => (
        <div key={item.trashName}
          className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
            <IconTrash className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{item.originalName}</p>
            <p className="text-xs text-muted-foreground">
              Удалено {new Date(item.trashedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <button type="button" onClick={() => handleRestore(item)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <IconRefresh className="w-3.5 h-3.5" />
            Восстановить
          </button>
          <button type="button" onClick={() => handleDeleteForever(item)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
