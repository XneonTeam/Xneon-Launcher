import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconLoader2, IconRefresh, IconUpload, IconLock, IconLayoutGrid, IconColorSwatch, IconUser, IconShirt, IconLogout } from "@tabler/icons-react"
import {
  getCloudToken, removeCloudToken,
  cloudApiGetUser, cloudApiGetFiles, cloudApiGetStorageInfo,
  cloudApiGetCategories, cloudApiDeleteFile, hasElectronAPI,
} from "./api"
import { formatBytes, timeAgo } from "./utils"
import { CloudAuthModal } from "./cloud-auth-modal"
import { CloudBuildUploadModal } from "./cloud-build-upload-modal"
import { CloudFileList } from "./cloud-file-list"
import type { CloudItem, StorageInfo, CategoryStats, LocalBuild } from "./types"

export function CloudPage() {
  const [items, setItems] = useState<CloudItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "instance" | "account" | "skin">("all")
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({ used: 0, total: 1073741824, usedFormatted: "0 B", totalFormatted: "1 GB", percentage: 0 })
  const [categoryStats, setCategoryStats] = useState<CategoryStats>({})
  const [uploadingBuild, setUploadingBuild] = useState<string | null>(null)
  const [buildUploadProgress, setBuildUploadProgress] = useState(0)
  const [user, setUser] = useState<any | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [showBuildUploadModal, setShowBuildUploadModal] = useState(false)
  const [localBuilds, setLocalBuilds] = useState<LocalBuild[]>([])

  const getLocalBuildIcon = (name: string): string | undefined => {
    const n = name.trim().toLowerCase()
    const found = localBuilds.find(b => b.name.trim().toLowerCase() === n || b.name.toLowerCase().includes(n) || n.includes(b.name.toLowerCase()))
    return found?.icon && found.icon.length > 0 ? found.icon : undefined
  }

  const checkAuth = useCallback(async () => {
    setIsAuthLoading(true)
    const token = await getCloudToken()
    if (!token) { setUser(null); setIsAuthLoading(false); return false }
    try {
      const result = await cloudApiGetUser(token)
      if (result.success && result.user) { setUser(result.user); setIsAuthLoading(false); return true }
      await removeCloudToken()
      setUser(null); setIsAuthLoading(false); return false
    } catch {
      setUser(null); setIsAuthLoading(false); return false
    }
  }, [])

  const fetchFiles = useCallback(async () => {
    const token = await getCloudToken()
    if (!token) return
    setLoading(true); setError(null)
    try {
      const categoryMap: Record<string, string> = { build: "instance", account: "accounts", skin: "skins" }
      const result = await cloudApiGetFiles(token, filter !== "all" ? categoryMap[filter] : undefined)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки файлов")
      setItems((result.files || []).map((f: any) => ({
        id: f.id || f._id,
        name: f.name || f.originalName,
        size: formatBytes(f.size || 0),
        lastSynced: f.uploadedAt ? timeAgo(f.uploadedAt) : "неизвестно",
        type: (f.category === "accounts" ? "account" : f.category === "skins" ? "skin" : "instance") as CloudItem["type"],
        category: f.category,
        downloadUrl: f.downloadUrl,
        icon: f.icon || f.build?.icon,
      })))
    } catch (err: any) {
      setError(err.message); setItems([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  const fetchStorageInfo = useCallback(async () => {
    const token = await getCloudToken()
    if (!token) return
    try {
      const data = await cloudApiGetStorageInfo(token)
      if (!data) throw new Error()
      const used = data.used_bytes || 0
      const total = data.limit_bytes || 1073741824
      setStorageInfo({ used, total, usedFormatted: data.formatted_used || formatBytes(used), totalFormatted: data.formatted_limit || formatBytes(total), percentage: total > 0 ? Math.round((used / total) * 100) : 0 })
    } catch {
      setStorageInfo({ used: 0, total: 1073741824, usedFormatted: "0 B", totalFormatted: "1 GB", percentage: 0 })
    }
  }, [])

  const fetchCategories = useCallback(async () => {
    const token = await getCloudToken()
    if (!token) return
    try {
      const result = await cloudApiGetCategories(token)
      setCategoryStats(result.success ? result.categories || {} : {})
    } catch { setCategoryStats({}) }
  }, [])

  const loadLocalBuilds = useCallback(() => {
    window.electronAPI?.loadBuilds().then(dbBuilds => {
      setLocalBuilds((dbBuilds ?? []).map(b => ({ id: b.id, name: b.name, description: b.description, version: b.version, modLoader: b.modLoader, createdAt: b.createdAt, icon: b.icon })))
    })
  }, [])

  useEffect(() => { checkAuth() }, [checkAuth])

  useEffect(() => {
    if (!user) return
    fetchFiles(); fetchStorageInfo(); fetchCategories(); loadLocalBuilds()
  }, [user, fetchFiles, fetchStorageInfo, fetchCategories, loadLocalBuilds])

  useEffect(() => { if (user) fetchFiles() }, [filter])

  const handleSync = () => {
    setIsSyncing(true); setSyncProgress(0)
    fetchFiles(); fetchStorageInfo(); fetchCategories()
    const interval = setInterval(() => {
      setSyncProgress(prev => {
        if (prev >= 100) { clearInterval(interval); setIsSyncing(false); return 100 }
        return prev + 10
      })
    }, 100)
  }

  const handleUploadBuild = async (build: LocalBuild) => {
    const token = await getCloudToken()
    if (!token) return
    setUploadingBuild(build.name); setBuildUploadProgress(0)
    try {
      setBuildUploadProgress(30)
      const result = hasElectronAPI ? await (window as any).electronAPI.uploadBuildToCloud(build.name, token, "instance") : { success: false, error: "Недоступно в браузере" }
      setBuildUploadProgress(80)
      if (!result.success) throw new Error(result.error || "Не удалось загрузить сборку")
      setBuildUploadProgress(100)
      await fetchFiles(); await fetchStorageInfo(); await fetchCategories()
      setShowBuildUploadModal(false)
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`)
    } finally {
      setUploadingBuild(null); setBuildUploadProgress(0)
    }
  }

  const handleDownload = async (item: CloudItem) => {
    const token = await getCloudToken()
    if (!token) return
    try {
      const result = await window.electronAPI?.cloudDownloadFile(token, item.id, item.name)
      if (!result?.success) throw new Error(result?.error || "Ошибка скачивания")
      if (result.filePath) alert(`Файл сохранён: ${result.filePath}`)
    } catch (err: any) { alert(`Ошибка скачивания: ${err.message}`) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить файл?")) return
    const token = await getCloudToken()
    if (!token) return
    try {
      const result = await cloudApiDeleteFile(token, id)
      if (!result.success) throw new Error(result.error || "Ошибка удаления")
      await fetchFiles(); await fetchStorageInfo(); await fetchCategories()
    } catch (err: any) { alert(`Ошибка: ${err.message}`) }
  }

  const { t } = useTranslation()
  const filtered = items.filter(item => filter === "all" || item.type === filter)

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border h-[calc(100vh-5rem)] flex flex-col">
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

      <CloudAuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={() => checkAuth()} />

      {showBuildUploadModal && (
        <CloudBuildUploadModal
          localBuilds={localBuilds}
          uploadingBuild={uploadingBuild}
          buildUploadProgress={buildUploadProgress}
          onClose={() => setShowBuildUploadModal(false)}
          onUpload={handleUploadBuild}
        />
      )}

      <div className="relative z-10 p-4 flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t("cloud.title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {user ? t("cloud.usage", { size: storageInfo.usedFormatted }) : t("cloud.loginRequired")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <button
                  onClick={() => { setShowBuildUploadModal(true); loadLocalBuilds() }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all"
                >
                  <IconUpload className="w-5 h-5" strokeWidth={2} />
                  {t("cloud.uploadBuild")}
                </button>
                <button
                  onClick={handleSync}
                  disabled={isSyncing}
                  className={cn("flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-200",
                    isSyncing ? "bg-primary/70 text-primary-foreground cursor-wait" : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)]")}
                >
                  {isSyncing ? <><IconLoader2 className="w-5 h-5 animate-spin" />{t("cloud.syncing", { progress: syncProgress })}</> : <><IconRefresh className="w-5 h-5" strokeWidth={2} />{t("cloud.sync")}</>}
                </button>
                <button onClick={async () => { await removeCloudToken(); setUser(null); setItems([]) }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive border border-border transition-all">
                  <IconLogout className="w-4 h-4" strokeWidth={1.75} />
                  {t("cloud.logout")}
                </button>
              </>
            ) : (
              <button onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all">
                <IconLock className="w-5 h-5" strokeWidth={2} />
                {t("cloud.login")}
              </button>
            )}
          </div>
        </div>

        {isSyncing && (
          <div className="mb-3">
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${syncProgress}%` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3 p-1 rounded-lg bg-muted/40">
          {[
            { id: "all" as const, label: `${t("cloud.all")} (${items.length})`, icon: IconLayoutGrid },
            { id: "instance" as const, label: `${t("cloud.builds")} (${categoryStats.instances?.count || 0})`, icon: IconColorSwatch },
            { id: "account" as const, label: `${t("cloud.accounts")} (${categoryStats.accounts?.count || 0})`, icon: IconUser },
            { id: "skin" as const, label: `${t("cloud.skins")} (${categoryStats.skins?.count || 0})`, icon: IconShirt },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setFilter(id)}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                filter === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <CloudFileList
            isAuthLoading={isAuthLoading}
            user={user}
            loading={loading}
            isSyncing={isSyncing}
            error={error}
            filtered={filtered}
            getLocalBuildIcon={getLocalBuildIcon}
            onShowAuth={() => setShowAuthModal(true)}
            onRetry={fetchFiles}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />
        </div>

        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("cloud.storageStatus")}</span>
            <span>{storageInfo.usedFormatted} / {storageInfo.totalFormatted} {t("cloud.used")}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${storageInfo.percentage}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
