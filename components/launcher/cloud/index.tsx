import { useState, useEffect, useCallback, useMemo, useDeferredValue } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconUpload, IconLock, IconLayoutGrid, IconColorSwatch, IconUser, IconLogout, IconCloud, IconLoader2, IconArrowLeft } from "@tabler/icons-react"
import {
  getCloudToken, removeCloudToken,
  cloudApiGetUser, cloudApiGetFiles, cloudApiGetStorageInfo,
  cloudApiGetCategories, cloudApiDeleteFile, hasElectronAPI, getCloudApiUrlSetting,
} from "./api"
import { formatBytes, timeAgo } from "./utils"
import { CloudAuthModal } from "./cloud-auth-modal"
import { CloudBuildUploadModal } from "./cloud-build-upload-modal"
import { CloudFileList } from "./cloud-file-list"
import type { CloudItem, StorageInfo, CategoryStats, LocalBuild } from "./types"
import { useAccounts, type Account } from "@/src/AccountsContext"

export function CloudPage() {
  const { addAccount } = useAccounts()
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
  const [showUploadChoice, setShowUploadChoice] = useState(false)
  const [localBuilds, setLocalBuilds] = useState<LocalBuild[]>([])
  const [cloudApiUrl, setCloudApiUrl] = useState("http://87.121.82.248:3001/api")
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [cloudAccounts, setCloudAccounts] = useState<{ id: string; type: string; username: string; uuid?: string }[]>([])
  const [uploadingAccount, setUploadingAccount] = useState(false)

  const getLocalBuildIcon = useCallback((name: string): string | undefined => {
    const n = name.trim().toLowerCase()
    const found = localBuilds.find(b => b.name.trim().toLowerCase() === n || b.name.toLowerCase().includes(n) || n.includes(b.name.toLowerCase()))
    return found?.icon && found.icon.length > 0 ? found.icon : undefined
  }, [localBuilds])

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
      const result = await cloudApiGetFiles(token)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки файлов")
      setItems((result.files || []).map((f: Record<string, unknown>) => {
        const rawIcon = f.icon ?? (f.build as Record<string, unknown> | undefined)?.icon
        const type = (f.type === "account" || f.type === "accounts" ? "account" : f.type === "skin" || f.type === "skins" ? "skin" : "instance") as CloudItem["type"]
        const version = f.version as string | undefined
        const icon = type === "account"
          ? version === "offline"
            ? "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft"
            : `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent((f.uuid as string) || (f.name as string))}?skin_type=${version === "elyby" ? "ely" : version === "xnskins" ? "xneon" : version === "microsoft" ? "microsoft" : ""}`
          : typeof rawIcon === "string" ? rawIcon : undefined
        return ({
          id: (f.id as string) || (f._id as string) || "",
          name: (f.name as string) || (f.originalName as string) || "Без названия",
          size: formatBytes(Number(f.size) || 0),
          lastSynced: f.uploadedAt ? timeAgo(f.uploadedAt as string) : "неизвестно",
          type,
          category: f.type as string,
          downloadUrl: f.downloadUrl as string | undefined,
          icon,
          version,
        })
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setItems([])
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

  useEffect(() => { getCloudApiUrlSetting().then(setCloudApiUrl) }, [])

  useEffect(() => {
    if (!user) return
    fetchFiles(); fetchStorageInfo(); fetchCategories(); loadLocalBuilds()
  }, [user, fetchFiles, fetchStorageInfo, fetchCategories, loadLocalBuilds])

  const handleUploadBuild = useCallback(async (build: LocalBuild) => {
    const token = await getCloudToken()
    if (!token) return
    setUploadingBuild(build.name); setBuildUploadProgress(0)
    try {
      setBuildUploadProgress(30)
      const result = hasElectronAPI ? await window.electronAPI!.uploadBuildToCloud(build.name, token, "instance") : { success: false, error: "Недоступно в браузере" }
      setBuildUploadProgress(80)
      if (!result.success) throw new Error(result.error || "Не удалось загрузить сборку")
      setBuildUploadProgress(100)
      await fetchFiles(); await fetchStorageInfo(); await fetchCategories()
      setShowBuildUploadModal(false)
    } catch (err) {
      alert(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploadingBuild(null); setBuildUploadProgress(0)
    }
  }, [fetchCategories, fetchFiles, fetchStorageInfo])

  const handleOpenAccountPicker = useCallback(async () => {
    setShowUploadChoice(false)
    try {
      const accounts = await window.electronAPI!.loadAccounts()
      setCloudAccounts(accounts.map((a: { id: string; type: string; username: string; uuid?: string }) => ({ id: a.id, type: a.type, username: a.username, uuid: a.uuid })))
      setShowAccountPicker(true)
    } catch { alert("Не удалось загрузить аккаунты") }
  }, [])

  const handleUploadAccount = useCallback(async (account: { id: string; type: string; username: string; uuid?: string }) => {
    const token = await getCloudToken()
    if (!token) return
    setUploadingAccount(true)
    try {
      const result = await window.electronAPI!.uploadAccountToCloud(token, account)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки")
      await fetchFiles(); await fetchStorageInfo(); await fetchCategories()
    } catch (err) {
      alert(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploadingAccount(false); setShowAccountPicker(false)
    }
  }, [fetchCategories, fetchFiles, fetchStorageInfo])

  const handleDownload = useCallback(async (item: CloudItem) => {
    const token = await getCloudToken()
    if (!token) return
    try {
      if (item.type === "account" || item.type === "instance") {
        const result = await window.electronAPI?.cloudDownloadAndImport(token, item.id, item.name, item.type)
        if (!result?.success) throw new Error(result?.error || "Ошибка импорта")
        if (result.account) addAccount({ ...result.account, type: result.account.type as Account["type"], isActive: false })
        if (item.type === "instance") loadLocalBuilds()
        await fetchFiles()
      } else {
        const result = await window.electronAPI?.cloudDownloadFile(token, item.id, item.name)
        if (!result?.success) throw new Error(result?.error || "Ошибка скачивания")
        if (result.filePath) alert(`Файл сохранён: ${result.filePath}`)
      }
    } catch (err) { alert(`Ошибка: ${err instanceof Error ? err.message : String(err)}`) }
  }, [fetchFiles, addAccount, loadLocalBuilds])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Удалить файл?")) return
    const token = await getCloudToken()
    if (!token) return
    try {
      const result = await cloudApiDeleteFile(token, id)
      if (!result.success) throw new Error(result.error || "Ошибка удаления")
      await fetchFiles(); await fetchStorageInfo(); await fetchCategories()
    } catch (err) { alert(`Ошибка: ${err instanceof Error ? err.message : String(err)}`) }
  }, [fetchCategories, fetchFiles, fetchStorageInfo])

  const handleCloseAuthModal = useCallback(() => setShowAuthModal(false), [])
  const handleOpenAuthModal = useCallback(() => setShowAuthModal(true), [])
  const handleAuthSuccess = useCallback(() => { void checkAuth() }, [checkAuth])
  const handleCloseBuildUploadModal = useCallback(() => setShowBuildUploadModal(false), [])
  const handleOpenBuildUploadModal = useCallback(() => {
    setShowUploadChoice(false)
    setShowBuildUploadModal(true)
    loadLocalBuilds()
  }, [loadLocalBuilds])
  const handleLogout = useCallback(async () => {
    await removeCloudToken()
    setUser(null)
    setItems([])
  }, [])

  const { t } = useTranslation()
  const deferredFilter = useDeferredValue(filter)
  const filtered = useMemo(
    () => items.filter(item => deferredFilter === "all" || item.type === deferredFilter),
    [deferredFilter, items],
  )
  const filterOptions = useMemo(() => ([
    { id: "all" as const, label: `${t("cloud.all")} (${items.length})`, icon: IconLayoutGrid },
    { id: "instance" as const, label: `${t("cloud.builds")} (${categoryStats.instances?.count || 0})`, icon: IconColorSwatch },
    { id: "account" as const, label: `${t("cloud.accounts")} (${categoryStats.accounts?.count || 0})`, icon: IconUser },
  ]), [categoryStats.accounts?.count, categoryStats.instances?.count, categoryStats.skins?.count, items.length, t])

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border h-[calc(100vh-5rem)] flex flex-col">
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

      <CloudAuthModal isOpen={showAuthModal} onClose={handleCloseAuthModal} onSuccess={handleAuthSuccess} />

      {showBuildUploadModal && (
        <CloudBuildUploadModal
          localBuilds={localBuilds}
          uploadingBuild={uploadingBuild}
          buildUploadProgress={buildUploadProgress}
          onClose={handleCloseBuildUploadModal}
          onUpload={handleUploadBuild}
        />
      )}

      {showUploadChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowUploadChoice(false)}>
          <div className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border">
              <h3 className="text-lg font-semibold text-foreground">{t("cloud.upload")}</h3>
            </div>
            <div className="p-4 space-y-3">
              <button onClick={handleOpenBuildUploadModal}
                className="flex items-center gap-4 w-full px-5 py-5 rounded-xl bg-muted/30 hover:bg-muted/60 border border-border transition-all text-left">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <IconColorSwatch className="w-6 h-6 text-primary" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-base font-medium text-foreground">Сборка</p>
                  <p className="text-sm text-muted-foreground">Загрузить сборку Minecraft</p>
                </div>
              </button>
              <button onClick={handleOpenAccountPicker}
                className="flex items-center gap-4 w-full px-5 py-5 rounded-xl bg-muted/30 hover:bg-muted/60 border border-border transition-all text-left">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <IconUser className="w-6 h-6 text-primary" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-base font-medium text-foreground">Аккаунт</p>
                  <p className="text-sm text-muted-foreground">Загрузить аккаунт в облако</p>
                </div>
              </button>
            </div>
            <div className="p-3 border-t border-border flex justify-end">
              <button onClick={() => setShowUploadChoice(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showAccountPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAccountPicker(false)}>
          <div className="w-full max-w-lg mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 p-4 border-b border-border">
              <button onClick={() => setShowUploadChoice(true)}
                className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center">
                <IconArrowLeft className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <h3 className="text-lg font-semibold text-foreground">Выберите аккаунт</h3>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 space-y-1">
              {cloudAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Нет сохранённых аккаунтов</p>
              ) : cloudAccounts.map(acc => {
                const typeColors: Record<string, string> = { elyby: "#217e5c", xnskins: "#f97316", microsoft: "#2563EB", offline: "#757575" }
                const typeLabels: Record<string, string> = { elyby: "Ely.By", xnskins: "XN Skins", microsoft: "Microsoft", offline: "Offline" }
                const color = typeColors[acc.type] || "#757575"
                const avatarUrl = acc.type === "offline"
                  ? "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft"
                  : `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(acc.uuid || acc.username)}?skin_type=${acc.type === "elyby" ? "ely" : acc.type === "xnskins" ? "xneon" : acc.type === "microsoft" ? "microsoft" : ""}`
                return (
                  <div key={acc.id}
                    className="flex items-center gap-4 p-3 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden" style={{ backgroundColor: `${color}20` }}>
                      <img src={avatarUrl} alt="" className="w-full h-full object-cover"
                        onError={(e) => {
                          const t = e.currentTarget
                          if (!t.dataset.retried) { t.dataset.retried = "1"; t.src = "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft" }
                          else { t.style.display = "none" }
                        }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{acc.username}</p>
                      <p className="text-sm text-muted-foreground">{typeLabels[acc.type] || acc.type}</p>
                    </div>
                    <button onClick={() => handleUploadAccount(acc)} disabled={uploadingAccount}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-all disabled:opacity-50 shrink-0">
                      {uploadingAccount ? <IconLoader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : <IconUpload className="w-4 h-4" strokeWidth={2} />}
                      Загрузить
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 p-4 flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t("cloud.title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {user ? t("cloud.usage", { size: storageInfo.usedFormatted }) : t("cloud.loginRequired")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1">
              <IconCloud className="w-3 h-3" strokeWidth={1.5} />
              {cloudApiUrl}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <button onClick={() => setShowUploadChoice(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all"
                >
                  <IconUpload className="w-5 h-5" strokeWidth={2} />
                  {t("cloud.upload")}
                </button>

                <button onClick={() => { void handleLogout() }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive border border-border transition-all">
                  <IconLogout className="w-4 h-4" strokeWidth={1.75} />
                  {t("cloud.logout")}
                </button>
              </>
            ) : (
              <button onClick={handleOpenAuthModal}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all">
                <IconLock className="w-5 h-5" strokeWidth={2} />
                {t("cloud.login")}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3 p-1 rounded-lg bg-muted/40">
          {filterOptions.map(({ id, label, icon: Icon }) => (
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
            onShowAuth={handleOpenAuthModal}
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
