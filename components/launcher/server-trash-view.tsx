import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconTrash, IconRefresh, IconServer } from "@tabler/icons-react"
import type { McServerInfo } from "@xnlc/types"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { ModalLayer } from "@/components/ui/modal-layer"
import { Checkbox } from "@/components/ui/checkbox"
import { LoaderIcon, loaderLabel } from "./instance/loader-icon"
import { XnConnectLogo } from "./server/xn-connect-logo"

interface ServerTrashViewProps {
  onBack: () => void
}

export function ServerTrashView({ onBack }: ServerTrashViewProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<McServerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmTarget, setConfirmTarget] = useState<"item" | "all" | null>(null)
  const [confirmItem, setConfirmItem] = useState<McServerInfo | null>(null)
  const [deleteTunnel, setDeleteTunnel] = useState(true)

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
    await window.electronAPI.mcServerPermanentDelete(item.id, deleteTunnel)
    setConfirmTarget(null)
    setConfirmItem(null)
    await loadTrash()
  }, [loadTrash, deleteTunnel])

  const handlePurgeAll = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.mcServerPurgeTrash(deleteTunnel)
    setConfirmTarget(null)
    setItems([])
  }, [deleteTunnel])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        {t("servers.trash.loading")}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState variant="trash" title={t("servers.trash.empty")} className="flex-1" />
    )
  }

  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{t("servers.trash.itemCount", { count: items.length })}</p>
        <button type="button" onClick={() => { setConfirmTarget("all"); setDeleteTunnel(true) }}
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
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{item.gameVersion}</span>
              <span>&middot;</span>
              <LoaderIcon loaderId={item.modloader} className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{loaderLabel(item.modloader)}</span>
            </div>
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
          <button type="button" onClick={() => { setConfirmTarget("item"); setConfirmItem(item); setDeleteTunnel(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Delete-forever confirmation with optional XN Connect tunnel cleanup */}
      {confirmTarget && (
        <ModalLayer
          onClose={() => { setConfirmTarget(null); setConfirmItem(null) }}
          className="bg-background/80 backdrop-blur-sm animate-in fade-in-0"
        >
          <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <IconTrash className="w-5 h-5 text-destructive" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {confirmTarget === "all" ? t("servers.trash.purgeAll") : t("servers.trash.deleteForeverTitle")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {confirmTarget === "all"
                ? t("servers.trash.purgeAllDesc", { count: items.length })
                : t("servers.trash.deleteForeverDesc", { name: confirmItem?.name ?? "" })}
            </p>
            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-border bg-muted/30 cursor-pointer mb-5">
              <Checkbox checked={deleteTunnel} onCheckedChange={(v) => setDeleteTunnel(!!v)} />
              <XnConnectLogo className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-foreground">{t("servers.trash.deleteTunnel")}</span>
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmTarget(null); setConfirmItem(null) }}
                className="flex-1 h-10 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                {t("servers.cancel")}
              </button>
              <button
                type="button"
                onClick={() => (confirmTarget === "all" ? handlePurgeAll() : confirmItem && handleDeleteForever(confirmItem))}
                className="flex-1 h-10 rounded-xl bg-destructive text-white text-sm font-medium hover:bg-destructive/90 transition-colors"
              >
                {t("servers.trash.deleteForeverTitle")}
              </button>
            </div>
          </div>
        </ModalLayer>
      )}
    </div>
  )
}
