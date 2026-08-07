import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconFolder, IconFile, IconDownload, IconTrash, IconLoader2,
  IconRefresh, IconUpload, IconArrowUp, IconLayoutGrid, IconColorSwatch,
  IconUser, IconHome, IconCloud,
} from "@tabler/icons-react"
import { formatBytes, timeAgo } from "./utils"
import { useAccounts, type Account } from "@/src/AccountsContext"
import { getAvatarUrl, getAccountTypeInfo, type AccountType } from "../accounts-page"

const AVATAR_API = "https://mcskinapi-three.vercel.app/avatar"
const FALLBACK_AVATAR = `${AVATAR_API}/Steve?skin_type=microsoft`

function CloudFileIcon({ icon, name }: { icon?: string; name: string }) {
  const retryCount = useRef(0)
  const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    retryCount.current++
    if (retryCount.current === 1 && icon && icon !== FALLBACK_AVATAR) {
      e.currentTarget.src = FALLBACK_AVATAR
    } else {
      e.currentTarget.style.display = "none"
    }
  }, [icon])
  if (!icon) return null
  return <img src={icon} alt="" className="w-full h-full object-cover rounded" onError={handleError} />
}

function BuildThumbIcon({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState(false)
  if (!icon || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <IconColorSwatch className="w-5 h-5 text-primary" />
      </div>
    )
  }
  return <img src={icon} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
}

function FileIcon({ file, currentPath, localBuilds }: { file: CloudFile; currentPath: string; localBuilds: Array<{ id: string; name: string; icon?: string }> }) {
  if (file.isDir) return <IconFolder className="w-5 h-5 text-primary/70" />

  if (currentPath === "accounts" && file.name.endsWith(".json")) {
    const username = file.name.replace(/\.json$/i, "")
    return <CloudFileIcon icon={`${AVATAR_API}/${encodeURIComponent(username)}?skin_type=microsoft`} name={username} />
  }

  if (currentPath === "builds" && file.name.endsWith(".zip")) {
    const buildName = file.name.replace(/\.zip$/i, "")
    const localBuild = localBuilds.find(b => b.name.trim().toLowerCase() === buildName.trim().toLowerCase() || b.name.toLowerCase().includes(buildName.toLowerCase()) || buildName.toLowerCase().includes(b.name.toLowerCase()))
    return <CloudFileIcon icon={localBuild?.icon} name={buildName} />
  }

  return <IconFile className="w-5 h-5 text-muted-foreground/60" />
}

const api = typeof window !== "undefined" ? window.electronAPI : undefined

type CloudFile = {
  id: string
  name: string
  size: number
  modifiedAt?: string
  path: string
  isDir: boolean
  category?: string
}

type Props = {
  providerId: string
}

export function CloudFileBrowser({ providerId }: Props) {
  const { t } = useTranslation()
  const { addAccount } = useAccounts()
  const [files, setFiles] = useState<CloudFile[]>([])
  const [localBuilds, setLocalBuilds] = useState<Array<{ id: string; name: string; icon?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState<string>("")
  const [filter, setFilter] = useState<"all" | "builds" | "accounts">("all")
  const [quota, setQuota] = useState<{ used: number; total: number } | null>(null)
  const [showUploadChoice, setShowUploadChoice] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const fetchFiles = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.cloudListFiles(providerId, currentPath || undefined)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки")
      setFiles(result.files || [])
    } catch (e) {
      console.error("[Cloud] Fetch files error:", e)
      setError(e instanceof Error ? e.message : String(e))
      setFiles([])
    } finally { setLoading(false) }
  }, [providerId, currentPath])

  const fetchQuota = useCallback(async () => {
    if (!api) return
    try {
      const q = await api.cloudGetQuota(providerId)
      setQuota(q)
    } catch { setQuota(null) }
  }, [providerId])

  useEffect(() => { fetchFiles(); fetchQuota() }, [fetchFiles, fetchQuota])

  useEffect(() => {
    window.electronAPI?.loadBuilds().then(builds => {
      setLocalBuilds(builds.map(b => ({ id: b.id, name: b.name, icon: b.icon })))
    }).catch(() => {})
  }, [])

  const handleFolderClick = useCallback((folderPath: string) => {
    setCurrentPath(folderPath)
  }, [])

  const handleGoUp = useCallback(() => {
    const parts = currentPath.split("/").filter(Boolean)
    parts.pop()
    setCurrentPath(parts.join("/"))
  }, [currentPath])

  const handleDownload = useCallback(async (file: CloudFile) => {
    if (!api) return
    if (file.isDir) return
    const isAccount = file.path.includes("/accounts/") || currentPath.includes("accounts")
    const isBuild = file.path.endsWith(".zip") && (file.path.includes("/builds/") || currentPath.includes("builds"))

    if (isAccount) {
      try {
        const result = await api.cloudDownloadAndImport(providerId, file.path, "account")
        if (result.success && result.account) {
          addAccount({ ...result.account, type: result.account.type as Account["type"], isActive: false })
          window.dispatchEvent(new CustomEvent("cloud:imported", { detail: { type: "account" } }))
          alert("Аккаунт импортирован!")
        } else if (!result.success) {
          alert(result.error || "Ошибка импорта")
        }
      } catch (e) { alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`) }
    } else if (isBuild) {
      try {
        const result = await api.cloudDownloadAndImport(providerId, file.path, "instance")
        if (result.success) {
          window.dispatchEvent(new CustomEvent("cloud:imported", { detail: { type: "build" } }))
          alert("Сборка импортирована!")
        } else {
          alert(result.error || "Ошибка импорта")
        }
      } catch (e) { alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`) }
    } else {
      const { dialog } = window as any
      if (dialog?.showSaveDialog) {
        const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: file.name })
        if (!canceled && filePath) {
          const result = await api.cloudDownloadFile(providerId, file.path, filePath)
          if (!result.success) alert(result.error || "Ошибка скачивания")
        }
      } else {
        alert("Скачивание доступно только в Electron")
      }
    }
  }, [providerId, currentPath, addAccount])

  const handleDelete = useCallback(async (file: CloudFile) => {
    if (!api || !confirm(`Удалить "${file.name}"?`)) return
    try {
      const result = await api.cloudDeleteFile(providerId, file.path)
      if (!result.success) throw new Error(result.error || "Ошибка удаления")
      fetchFiles()
      fetchQuota()
    } catch (e) { alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`) }
  }, [providerId, fetchFiles, fetchQuota])

  const handleUploadBuild = useCallback(async (buildId: string, buildName: string) => {
    if (!api) return
    setUploadingId(buildId)
    try {
      const result = await api.cloudUploadBuild(providerId, buildName)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки")
      fetchFiles()
      fetchQuota()
      setShowUploadChoice(false)
    } catch (e) { alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setUploadingId(null) }
  }, [providerId, fetchFiles, fetchQuota])

  const handleUploadAccount = useCallback(async (account: { id: string; type: string; username: string; uuid?: string }) => {
    if (!api) return
    setUploadingId(account.id)
    try {
      const result = await api.cloudUploadAccount(providerId, account)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки")
      fetchFiles()
      fetchQuota()
    } catch (e) { alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setUploadingId(null); setShowUploadChoice(false) }
  }, [providerId, fetchFiles, fetchQuota])

  const translateFolderName = useCallback((name: string) => {
    if (name === "builds") return t("cloud.builds")
    if (name === "accounts") return t("cloud.accounts")
    return name
  }, [t])

  const getDisplayName = useCallback((file: CloudFile) => {
    if (file.isDir) return translateFolderName(file.name)
    const isAccounts = currentPath === "accounts"
    const isBuilds = currentPath === "builds"
    if (isAccounts && file.name.endsWith(".json")) return file.name.replace(/\.json$/i, "")
    if (isBuilds && file.name.endsWith(".zip")) return file.name.replace(/\.zip$/i, "")
    return file.name
  }, [currentPath, translateFolderName])

  const getFileTypeBadge = useCallback((file: CloudFile) => {
    if (file.isDir) return null
    const isAccounts = currentPath === "accounts"
    const isBuilds = currentPath === "builds"
    if (isAccounts) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Аккаунт</span>
    }
    if (isBuilds && file.name.endsWith(".zip")) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">Сборка</span>
    }
    return null
  }, [currentPath])

  const filtered = files.filter(f => {
    if (filter === "all") return true
    if (f.isDir) return f.name.toLowerCase() === filter || f.path.toLowerCase().includes(filter)
    return f.path.toLowerCase().includes(filter) || (f.category || "").toLowerCase().includes(filter)
  })

  const usedPercent = quota && quota.total > 0 ? Math.round((quota.used / quota.total) * 100) : 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {showUploadChoice && (
        <UploadChoiceModal
          providerId={providerId}
          onClose={() => setShowUploadChoice(false)}
          onUploadBuild={handleUploadBuild}
          onUploadAccount={handleUploadAccount}
          uploading={uploadingId}
        />
      )}

      <div className="flex items-center gap-2 mb-3 p-1 rounded-lg bg-muted/40">
        {(["all", "builds", "accounts"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border",
              filter === f ? "border-transparent bg-primary text-primary-foreground shadow-sm" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
            {f === "all" ? <IconLayoutGrid className="w-3.5 h-3.5" /> : f === "builds" ? <IconColorSwatch className="w-3.5 h-3.5" /> : <IconUser className="w-3.5 h-3.5" />}
            {f === "all" ? t("cloud.all") : f === "builds" ? t("cloud.builds") : t("cloud.accounts")}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3">
        {currentPath && (
          <button onClick={handleGoUp}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <IconArrowUp className="w-3.5 h-3.5" /> ..
          </button>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <IconHome className="w-3.5 h-3.5" />
          {currentPath.split("/").filter(Boolean).map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-muted-foreground/40">/</span>
              <button onClick={() => setCurrentPath(arr.slice(0, i + 1).join("/"))}
                className="hover:text-foreground transition-colors cursor-pointer">{translateFolderName(part)}</button>
            </span>
          ))}
          {!currentPath && <span>Корень</span>}
        </div>
        <button onClick={fetchFiles}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <IconRefresh className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
        <button onClick={() => setShowUploadChoice(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-all">
          <IconUpload className="w-3.5 h-3.5" /> {t("cloud.upload")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <IconLoader2 className="w-6 h-6 text-muted-foreground animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-destructive">{error}</p>
            <button onClick={fetchFiles} className="mt-2 text-xs text-primary hover:underline">Повторить</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <IconCloud className="w-10 h-10 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground/50">Папка пуста</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map(file => (
              <div key={file.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group",
                  file.isDir ? "hover:bg-muted/40 cursor-pointer" : "hover:bg-muted/30"
                )}
                onClick={() => file.isDir ? handleFolderClick(file.path) : undefined}>
                <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden">
                  <FileIcon file={file} currentPath={currentPath} localBuilds={localBuilds} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{getDisplayName(file)}</p>
                    {getFileTypeBadge(file)}
                  </div>
                  <p className="text-xs text-muted-foreground/60">
                    {file.isDir ? "Папка" : formatBytes(file.size)}
                    {file.modifiedAt && ` · ${timeAgo(file.modifiedAt)}`}
                  </p>
                </div>
                {!file.isDir && (currentPath === "builds" || currentPath === "accounts") && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); handleDownload(file) }}
                      className="p-1.5 rounded-lg hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors"
                      title="Скачать">
                      <IconDownload className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(file) }}
                      className="p-1.5 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                      title="Удалить">
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {quota && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("cloud.storageStatus")}</span>
            <span>{formatBytes(quota.used)} / {formatBytes(quota.total)}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${usedPercent}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

function UploadChoiceModal({ providerId, onClose, onUploadBuild, onUploadAccount, uploading }: {
  providerId: string
  onClose: () => void
  onUploadBuild: (id: string, name: string) => void
  onUploadAccount: (account: { id: string; type: string; username: string; uuid?: string }) => void
  uploading: string | null
}) {
  const { t } = useTranslation()
  const accountTypeInfo = getAccountTypeInfo(t)
  const [localBuilds, setLocalBuilds] = useState<Array<{ id: string; name: string; icon?: string; version?: string }>>([])
  const [localAccounts, setLocalAccounts] = useState<Array<{ id: string; type: string; username: string; uuid?: string }>>([])
  const [tab, setTab] = useState<"builds" | "accounts">("builds")

  useEffect(() => {
    window.electronAPI?.loadBuilds().then(builds => {
      setLocalBuilds(builds.map(b => ({ id: b.id, name: b.name, icon: b.icon, version: b.version })))
    })
    window.electronAPI?.loadAccounts().then(accs => {
      setLocalAccounts(accs.map(a => ({ id: a.id, type: a.type, username: a.username, uuid: a.uuid })))
    })
  }, [])

  useEffect(() => {
    if (uploading !== null) return
    window.electronAPI?.loadBuilds().then(builds => {
      setLocalBuilds(builds.map(b => ({ id: b.id, name: b.name, icon: b.icon, version: b.version })))
    })
    window.electronAPI?.loadAccounts().then(accs => {
      setLocalAccounts(accs.map(a => ({ id: a.id, type: a.type, username: a.username, uuid: a.uuid })))
    })
  }, [uploading])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0" onClick={onClose}>
      <div className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex border-b border-border">
          <button onClick={() => setTab("builds")}
            className={cn("flex-1 px-4 py-3 text-sm font-medium transition-colors",
              tab === "builds" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
            {t("cloud.builds")}
          </button>
          <button onClick={() => setTab("accounts")}
            className={cn("flex-1 px-4 py-3 text-sm font-medium transition-colors",
              tab === "accounts" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
            {t("cloud.accounts")}
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto p-3">
          {tab === "builds" ? (
            localBuilds.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("cloud.noBuilds") || "Нет сборок"}</p>
            ) : (
              <div className="space-y-2">
                {localBuilds.map(b => (
                  <div key={b.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden bg-primary/10">
                      <BuildThumbIcon icon={b.icon} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-foreground truncate block">{b.name}</span>
                      {b.version && <span className="text-sm text-muted-foreground">{b.version}</span>}
                    </div>
                    <button onClick={() => onUploadBuild(b.id, b.name)} disabled={uploading === b.id}
                      className="px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm flex-shrink-0 disabled:opacity-50">
                      {uploading === b.id ? <IconLoader2 className="w-4 h-4 animate-spin" /> : "Загрузить"}
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            localAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("cloud.noAccounts") || "Нет аккаунтов"}</p>
            ) : (
              <div className="space-y-2">
                {localAccounts.map(a => {
                  const info = accountTypeInfo[a.type as AccountType] || accountTypeInfo.offline
                  return (
                    <div key={a.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: `${info.color}20` }}>
                        <img src={getAvatarUrl(a, a.username)} alt="" className="w-full h-full object-cover"
                          onError={(e) => {
                            const img = e.currentTarget
                            if (!img.dataset.retried) { img.dataset.retried = "1"; img.src = "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft" }
                            else { img.style.display = "none" }
                          }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-foreground truncate block">{a.username}</span>
                        <span className="text-sm text-muted-foreground">{info.name}</span>
                      </div>
                      <button onClick={() => onUploadAccount(a)} disabled={uploading === a.id}
                        className="px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm flex-shrink-0 disabled:opacity-50">
                        {uploading === a.id ? <IconLoader2 className="w-4 h-4 animate-spin" /> : "Загрузить"}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
        <div className="p-3 border-t border-border flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors">
            {t("cloud.close") || "Закрыть"}
          </button>
        </div>
      </div>
    </div>
  )
}
