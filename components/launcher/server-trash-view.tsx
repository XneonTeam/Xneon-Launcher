import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconTrash, IconRefresh, IconServer } from "@tabler/icons-react"
import type { McServerInfo } from "@xnlc/types"

interface ServerTrashViewProps {
  onBack: () => void
}

export function ServerTrashView({ onBack }: ServerTrashViewProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<McServerInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadTrash = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.mcServerListTrash()
      setItems(result ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTrash() }, [loadTrash])

  const handleRestore = useCallback(async (item: McServerInfo) => {
    if (!window.electronAPI) return
    await window.electronAPI.mcServerRestore(item.id)
    await loadTrash()
    onBack()
  }, [loadTrash, onBack])

  const handleDeleteForever = useCallback(async (item: McServerInfo) => {
    if (!window.electronAPI) return
    await window.electronAPI.mcServerPermanentDelete(item.id)
    await loadTrash()
  }, [loadTrash])

  const handlePurgeAll = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.mcServerPurgeTrash()
    setItems([])
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        {t("servers.trash.loading")}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        {t("servers.trash.empty")}
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{t("servers.trash.itemCount", { count: items.length })}</p>
        <button type="button" onClick={handlePurgeAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
          <IconTrash className="w-3.5 h-3.5" />
          {t("servers.trash.purgeAll")}
        </button>
      </div>

      {items.map((item) => (
        <div key={item.id}
          className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
            <IconServer className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
            <p className="text-xs text-muted-foreground">
              {item.gameVersion} &middot; {item.modloader === "vanilla" ? "Vanilla" : item.modloader}
            </p>
            {item.trashedAt && (
              <p className="text-[11px] text-muted-foreground">
                {t("servers.trash.deletedAt", { date: new Date(item.trashedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) })}
              </p>
            )}
          </div>
          <button type="button" onClick={() => handleRestore(item)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <IconRefresh className="w-3.5 h-3.5" />
            {t("servers.trash.restore")}
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
