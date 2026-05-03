import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconCloud, IconDownload, IconLoader2, IconLock, IconTrash, IconRefresh } from "@tabler/icons-react"
import type { CloudItem } from "./types"

interface CloudFileListProps {
  isAuthLoading: boolean
  user: any
  loading: boolean
  isSyncing: boolean
  error: string | null
  filtered: CloudItem[]
  getLocalBuildIcon: (name: string) => string | undefined
  onShowAuth: () => void
  onRetry: () => void
  onDownload: (item: CloudItem) => void
  onDelete: (id: string) => void
}

export function CloudFileList({
  isAuthLoading, user, loading, isSyncing, error, filtered,
  getLocalBuildIcon, onShowAuth, onRetry, onDownload, onDelete,
}: CloudFileListProps) {
  const { t } = useTranslation()
  const typeConfig = {
    instance: { label: t("cloud.builds") },
    account: { label: t("cloud.accounts") },
    skin: { label: t("cloud.skins") },
  }
  if (isAuthLoading) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <IconLoader2 className="w-8 h-8 animate-spin text-primary mb-4" />
      <p className="text-sm text-muted-foreground">{t("cloud.checkingAuth")}</p>
    </div>
  )

  if (!user) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <IconLock className="w-7 h-7 text-primary" strokeWidth={1.5} />
      </div>
      <p className="text-sm text-muted-foreground mb-1">{t("cloud.loginRequired")}</p>
      <p className="text-xs text-muted-foreground/60 mb-4">{t("cloud.loginRequiredDesc")}</p>
      <button onClick={onShowAuth} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all">
        <IconLock className="w-4 h-4" strokeWidth={1.75} />
        {t("cloud.login")}
      </button>
    </div>
  )

  if (loading && !isSyncing) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <IconLoader2 className="w-8 h-8 animate-spin text-primary mb-4" />
      <p className="text-sm text-muted-foreground">{t("cloud.loadingFiles")}</p>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
        <IconCloud className="w-7 h-7 text-destructive/60" strokeWidth={1.5} />
      </div>
      <p className="text-sm text-destructive mb-2">{error}</p>
      <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
        <IconRefresh className="w-3.5 h-3.5" strokeWidth={1.75} />
        {t("cloud.retry")}
      </button>
    </div>
  )

  if (filtered.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
        <IconCloud className="w-7 h-7 text-muted-foreground/40" strokeWidth={1.5} />
      </div>
      <p className="text-sm text-muted-foreground">{t("cloud.noData")}</p>
      <p className="text-xs text-muted-foreground/60 mt-1">{t("cloud.noDataDesc")}</p>
    </div>
  )

  return (
    <div className="space-y-2">
      {filtered.map(item => {
        const cfg = typeConfig[item.type]
        const icon = item.icon || getLocalBuildIcon(item.name)
        return (
          <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group">
            <div className="w-10 h-10 rounded-lg bg-muted/70 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {icon && <img src={icon} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">{item.name}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-muted-foreground">{cfg.label}</span>
                <span className="text-xs text-muted-foreground">{item.size}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onDownload(item)} className="p-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors" title={t("cloud.download")}>
                <IconDownload className="w-4 h-4" strokeWidth={1.5} />
              </button>
              <button onClick={() => onDelete(item.id)} className="p-2 rounded-lg bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors" title={t("cloud.delete")}>
                <IconTrash className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
