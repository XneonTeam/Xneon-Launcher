import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconFolder, IconFile, IconDownload, IconTrash, IconLoader2,
  IconRefresh, IconUpload, IconArrowUp, IconLayoutGrid, IconColorSwatch,
  IconUser, IconHome, IconCloud, IconServer, IconBox, IconPalette,
  IconWallpaper, IconWorldUpload, IconSettings, IconBug, IconPlug, IconCheck,
} from "@tabler/icons-react"
import { formatBytes, timeAgo } from "./utils"
import { useAccounts, type Account } from "@/src/AccountsContext"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import { getAvatarUrl, getAccountTypeInfo, type AccountType } from "../accounts-page"
import type { CloudUploadCategory } from "@xnlc/types"

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

function FileIcon({ file, currentPath, localBuilds, localServers }: {
  file: CloudFile
  currentPath: string
  localBuilds: Array<{ id: string; name: string; icon?: string; modLoader?: string }>
  localServers: Array<{ id: string; name: string; modloader?: string }>
}) {
  if (file.isDir) return <IconFolder className="w-5 h-5 text-primary/70" />

  if (currentPath === "accounts" && file.name.endsWith(".json")) {
    const username = file.name.replace(/\.json$/i, "")
    return <CloudFileIcon icon={`${AVATAR_API}/${encodeURIComponent(username)}?skin_type=microsoft`} name={username} />
  }

  if (currentPath === "builds" && file.name.endsWith(".zip")) {
    const buildName = file.name.replace(/\.zip$/i, "")
    const localBuild = localBuilds.find(b => b.name.trim().toLowerCase() === buildName.trim().toLowerCase() || b.name.toLowerCase().includes(buildName.toLowerCase()) || buildName.toLowerCase().includes(b.name.toLowerCase()))
    if (localBuild?.icon) return <CloudFileIcon icon={localBuild.icon} name={buildName} />
    // Нет иконки сборки — показываем лоадер, чтобы строка не была «голой»
    return (
      <div className="w-full h-full flex items-center justify-center text-primary">
        <LoaderIcon loaderId={localBuild?.modLoader ?? "instance"} className="w-5 h-5" />
      </div>
    )
  }

  if (currentPath === "servers" && file.name.endsWith(".zip")) {
    const serverName = file.name.replace(/\.zip$/i, "").replace(/^server-/i, "")
    const localServer = localServers.find(s => s.name.trim().toLowerCase() === serverName.trim().toLowerCase() || s.name.toLowerCase().includes(serverName.toLowerCase()) || serverName.toLowerCase().includes(s.name.toLowerCase()))
    return (
      <div className="w-full h-full flex items-center justify-center text-primary">
        <LoaderIcon loaderId={localServer?.modloader ?? "instance"} className="w-5 h-5" />
      </div>
    )
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
  const [localBuilds, setLocalBuilds] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modLoader?: string }>>([])
  const [localServers, setLocalServers] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modloader?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState<string>("")
  const [filter, setFilter] = useState<"all" | "builds" | "servers" | "accounts">("all")
  const [quota, setQuota] = useState<{ used: number; total: number } | null>(null)
  const [showUploadChoice, setShowUploadChoice] = useState(false)
  const [importModalFile, setImportModalFile] = useState<CloudFile | null>(null)
  // Выбор содержимого перед загрузкой в облако (сборка/сервер)
  const [uploadModalTarget, setUploadModalTarget] = useState<{ kind: "build" | "server"; id: string; name: string } | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Record<string, { percent: number; stage: "zip" | "upload" }>>({})

  useEffect(() => {
    return window.electronAPI?.onCloudUploadProgress?.((data) => {
      setUploadProgress(prev => ({ ...prev, [data.id]: { percent: data.percent, stage: data.stage } }))
    })
  }, [])

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
      setLocalBuilds(builds.map(b => ({ id: b.id, name: b.name, icon: b.icon, version: b.version, modLoader: b.modLoader })))
    }).catch(() => {})
    window.electronAPI?.mcServerList().then(servers => {
      setLocalServers(servers.map(s => ({ id: s.id, name: s.name, icon: s.icon, version: s.gameVersion, modloader: s.modloader })))
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
    const isServer = file.path.endsWith(".zip") && (file.path.includes("/servers/") || currentPath.includes("servers"))

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
    } else if (isBuild || isServer) {
      setImportModalFile(file)
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

  const handleUploadBuild = useCallback(async (buildId: string, buildName: string, categories?: string[]) => {
    if (!api) return
    setUploadingId(buildId)
    setUploadProgress({})
    try {
      const result = await api.cloudUploadBuild(providerId, buildName, buildId, categories as CloudUploadCategory[] | undefined)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки")
      fetchFiles()
      fetchQuota()
      setShowUploadChoice(false)
      setUploadModalTarget(null)
    } catch (e) { alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setUploadingId(null) }
  }, [providerId, fetchFiles, fetchQuota])

  const handleUploadServer = useCallback(async (serverId: string, serverName: string, categories?: string[]) => {
    if (!api) return
    setUploadingId(serverId)
    setUploadProgress({})
    try {
      const result = await api.cloudUploadServer(providerId, serverId, serverName, serverId, categories as CloudUploadCategory[] | undefined)
      if (!result.success) throw new Error(result.error || "Ошибка загрузки")
      fetchFiles()
      fetchQuota()
      setShowUploadChoice(false)
      setUploadModalTarget(null)
    } catch (e) { alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setUploadingId(null) }
  }, [providerId, fetchFiles, fetchQuota])

  const handleUploadAccount = useCallback(async (account: { id: string; type: string; username: string; uuid?: string }) => {
    if (!api) return
    setUploadingId(account.id)
    setUploadProgress({})
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
    if (name === "servers") return t("cloud.servers")
    if (name === "accounts") return t("cloud.accounts")
    return name
  }, [t])

  const getDisplayName = useCallback((file: CloudFile) => {
    if (file.isDir) return translateFolderName(file.name)
    const isAccounts = currentPath === "accounts"
    const isBuilds = currentPath === "builds"
    const isServers = currentPath === "servers"
    if (isAccounts && file.name.endsWith(".json")) return file.name.replace(/\.json$/i, "")
    if (isBuilds && file.name.endsWith(".zip")) return file.name.replace(/\.zip$/i, "")
    if (isServers && file.name.endsWith(".zip")) return file.name.replace(/\.zip$/i, "").replace(/^server-/i, "")
    return file.name
  }, [currentPath, translateFolderName])

  const getFileTypeBadge = useCallback((file: CloudFile) => {
    if (file.isDir) return null
    const isAccounts = currentPath === "accounts"
    const isBuilds = currentPath === "builds"
    const isServers = currentPath === "servers"
    if (isAccounts) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Аккаунт</span>
    }
    if (isBuilds && file.name.endsWith(".zip")) {
      const buildName = file.name.replace(/\.zip$/i, "")
      const localBuild = localBuilds.find(b =>
        b.name.trim().toLowerCase() === buildName.trim().toLowerCase() ||
        b.name.toLowerCase().includes(buildName.toLowerCase()) ||
        buildName.toLowerCase().includes(b.name.toLowerCase()))
      return (
        <div className="flex items-center gap-1">
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">Сборка</span>
          {localBuild?.version && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-medium">{localBuild.version}</span>
          )}
          {localBuild?.modLoader && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
              <LoaderIcon loaderId={localBuild.modLoader} className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      )
    }
    if (isServers && file.name.endsWith(".zip")) {
      const serverName = file.name.replace(/\.zip$/i, "").replace(/^server-/i, "")
      const localServer = localServers.find(s =>
        s.name.trim().toLowerCase() === serverName.trim().toLowerCase() ||
        s.name.toLowerCase().includes(serverName.toLowerCase()) ||
        serverName.toLowerCase().includes(s.name.toLowerCase()))
      return (
        <div className="flex items-center gap-1">
          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Сервер</span>
          {localServer?.version && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-medium">{localServer.version}</span>
          )}
          {localServer?.modloader && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
              <LoaderIcon loaderId={localServer.modloader} className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      )
    }
    return null
  }, [currentPath, localBuilds, localServers])

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
          onPickBuild={(id, name) => setUploadModalTarget({ kind: "build", id, name })}
          onPickServer={(id, name) => setUploadModalTarget({ kind: "server", id, name })}
          onUploadAccount={handleUploadAccount}
          uploading={uploadingId}
          progress={uploadProgress}
        />
      )}

      {uploadModalTarget && (
        <SelectiveUploadModal
          kind={uploadModalTarget.kind}
          name={uploadModalTarget.name}
          uploading={uploadingId === uploadModalTarget.id}
          progress={uploadProgress[uploadModalTarget.id]}
          onClose={() => setUploadModalTarget(null)}
          onConfirm={(categories) => {
            if (uploadModalTarget.kind === "build") {
              void handleUploadBuild(uploadModalTarget.id, uploadModalTarget.name, categories)
            } else {
              void handleUploadServer(uploadModalTarget.id, uploadModalTarget.name, categories)
            }
          }}
        />
      )}

      {importModalFile && (
        <SelectiveImportModal
          file={importModalFile}
          providerId={providerId}
          currentPath={currentPath}
          onClose={() => setImportModalFile(null)}
          onSuccess={(type) => {
            setImportModalFile(null)
            window.dispatchEvent(new CustomEvent("cloud:imported", { detail: { type } }))
            alert(type === "server" ? "Сервер успешно импортирован!" : "Сборка успешно импортирована!")
          }}
        />
      )}

      <div className="flex items-center gap-2 mb-3 p-1 rounded-lg bg-muted/40">
        {(["all", "builds", "servers", "accounts"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border",
              filter === f ? "border-transparent bg-primary text-primary-foreground shadow-sm" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted")}>
            {f === "all" ? <IconLayoutGrid className="w-3.5 h-3.5" /> : f === "builds" ? <IconColorSwatch className="w-3.5 h-3.5" /> : f === "servers" ? <IconServer className="w-3.5 h-3.5" /> : <IconUser className="w-3.5 h-3.5" />}
            {f === "all" ? t("cloud.all") : f === "builds" ? t("cloud.builds") : f === "servers" ? t("cloud.servers") : t("cloud.accounts")}
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
                  <FileIcon file={file} currentPath={currentPath} localBuilds={localBuilds} localServers={localServers} />
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
                {!file.isDir && (currentPath === "builds" || currentPath === "servers" || currentPath === "accounts") && (
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
            <span>{formatBytes(quota.used)}{quota.total != null ? ` / ${formatBytes(quota.total)}` : ""}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${usedPercent}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

function UploadChoiceModal({ providerId, onClose, onPickBuild, onPickServer, onUploadAccount, uploading, progress }: {
  providerId: string
  onClose: () => void
  onPickBuild: (id: string, name: string) => void
  onPickServer: (id: string, name: string) => void
  onUploadAccount: (account: { id: string; type: string; username: string; uuid?: string }) => void
  uploading: string | null
  progress: Record<string, { percent: number; stage: "zip" | "upload" }>
}) {
  const { t } = useTranslation()
  const accountTypeInfo = getAccountTypeInfo(t)
  const [localBuilds, setLocalBuilds] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modLoader?: string }>>([])
  const [localServers, setLocalServers] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modloader?: string }>>([])
  const [localAccounts, setLocalAccounts] = useState<Array<{ id: string; type: string; username: string; uuid?: string }>>([])
  const [tab, setTab] = useState<"builds" | "servers" | "accounts">("builds")

  useEffect(() => {
    window.electronAPI?.loadBuilds().then(builds => {
      setLocalBuilds(builds.map(b => ({ id: b.id, name: b.name, icon: b.icon, version: b.version, modLoader: b.modLoader })))
    })
    window.electronAPI?.mcServerList().then(servers => {
      setLocalServers(servers.map(s => ({ id: s.id, name: s.name, icon: s.icon, version: s.gameVersion, modloader: s.modloader })))
    })
    window.electronAPI?.loadAccounts().then(accs => {
      setLocalAccounts(accs.map(a => ({ id: a.id, type: a.type, username: a.username, uuid: a.uuid })))
    })
  }, [])

  useEffect(() => {
    if (uploading !== null) return
    window.electronAPI?.loadBuilds().then(builds => {
      setLocalBuilds(builds.map(b => ({ id: b.id, name: b.name, icon: b.icon, version: b.version, modLoader: b.modLoader })))
    })
    window.electronAPI?.mcServerList().then(servers => {
      setLocalServers(servers.map(s => ({ id: s.id, name: s.name, icon: s.icon, version: s.gameVersion, modloader: s.modloader })))
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
          <button onClick={() => setTab("servers")}
            className={cn("flex-1 px-4 py-3 text-sm font-medium transition-colors",
              tab === "servers" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
            {t("cloud.servers")}
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
                {localBuilds.map(b => {
                  const isUploading = uploading === b.id
                  const prog = progress[b.id]
                  const pct = prog?.percent ?? 0
                  return (
                    <div key={b.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden bg-primary/10">
                        <BuildThumbIcon icon={b.icon} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-foreground truncate block">{b.name}</span>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          {b.version && <span>{b.version}</span>}
                          {b.modLoader && (
                            <>
                              <span>·</span>
                              <LoaderIcon loaderId={b.modLoader} className="w-4 h-4 flex-shrink-0" />
                              <span className="capitalize">{b.modLoader}</span>
                            </>
                          )}
                        </div>
                        {isUploading && prog && (
                          <div className="mt-2">
                            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {prog.stage === "zip" ? "Упаковка..." : "Загрузка..."} · {pct}%
                            </p>
                          </div>
                        )}
                      </div>
                      <button onClick={() => onPickBuild(b.id, b.name)} disabled={isUploading}
                        className="px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm flex-shrink-0 disabled:opacity-50">
                        {isUploading ? <IconLoader2 className="w-4 h-4 animate-spin" /> : t("upload.choose")}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          ) : tab === "servers" ? (
            localServers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Нет серверов</p>
            ) : (
              <div className="space-y-2">
                {localServers.map(s => {
                  const isUploading = uploading === s.id
                  const prog = progress[s.id]
                  const pct = prog?.percent ?? 0
                  return (
                    <div key={s.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden bg-primary/10">
                        {s.icon ? (
                          <img src={s.icon} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <IconServer className="w-6 h-6 text-primary" strokeWidth={1.75} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-foreground truncate block">{s.name}</span>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <span>{s.version}</span>
                          {s.modloader && (
                            <>
                              <span>·</span>
                              <LoaderIcon loaderId={s.modloader} className="w-4 h-4 flex-shrink-0" />
                              <span className="capitalize">{s.modloader}</span>
                            </>
                          )}
                        </div>
                        {isUploading && prog && (
                          <div className="mt-2">
                            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {prog.stage === "zip" ? "Архивация сервера..." : "Загрузка в облако..."} · {pct}%
                            </p>
                          </div>
                        )}
                      </div>
                      <button onClick={() => onPickServer(s.id, s.name)} disabled={isUploading}
                        className="px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm flex-shrink-0 disabled:opacity-50">
                        {isUploading ? <IconLoader2 className="w-4 h-4 animate-spin" /> : t("upload.choose")}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            localAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("cloud.noAccounts") || "Нет аккаунтов"}</p>
            ) : (
              <div className="space-y-2">
                {localAccounts.map(a => {
                  const info = accountTypeInfo[a.type as AccountType] || accountTypeInfo.offline
                  const isUploading = uploading === a.id
                  const prog = progress[a.id]
                  const pct = prog?.percent ?? 0
                  return (
                    <div key={a.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: `${info.color}20` }}>
                        <CachedAvatar src={getAvatarUrl(a, a.username)} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-foreground truncate block">{a.username}</span>
                        <span className="text-sm text-muted-foreground">{info.name}</span>
                        {isUploading && prog && (
                          <div className="mt-2">
                            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">Загрузка... · {pct}%</p>
                          </div>
                        )}
                      </div>
                      <button onClick={() => onUploadAccount(a)} disabled={isUploading}
                        className="px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm flex-shrink-0 disabled:opacity-50">
                        {isUploading ? <IconLoader2 className="w-4 h-4 animate-spin" /> : "Загрузить"}
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

function SelectiveImportModal({
  file,
  providerId,
  currentPath,
  onClose,
  onSuccess,
}: {
  file: CloudFile
  providerId: string
  currentPath: string
  onClose: () => void
  onSuccess: (type: "build" | "server") => void
}) {
  const isServer = file.path.includes("/servers/") || currentPath.includes("servers")
  const defaultCategories = isServer
    ? ["world", "mods", "plugins", "configs", "logs"]
    : ["mods", "resourcepacks", "shaderpacks", "saves", "data", "logs"]

  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultCategories))
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categories = isServer
    ? [
        { id: "world", label: "Мир / Сохранения", desc: "Папки world, nether, end", icon: <IconWorldUpload className="w-4 h-4" /> },
        { id: "mods", label: "Моды", desc: "Папка mods", icon: <IconBox className="w-4 h-4" /> },
        { id: "plugins", label: "Плагины", desc: "Папка plugins", icon: <IconPlug className="w-4 h-4" /> },
        { id: "configs", label: "Конфигурация", desc: "server.properties, whitelist, eula и др.", icon: <IconSettings className="w-4 h-4" /> },
        { id: "logs", label: "Логи", desc: "Папка logs и crash-reports", icon: <IconBug className="w-4 h-4" /> },
      ]
    : [
        { id: "mods", label: "Моды", desc: "Папка mods", icon: <IconBox className="w-4 h-4" /> },
        { id: "resourcepacks", label: "Ресурспаки", desc: "Папка resourcepacks", icon: <IconPalette className="w-4 h-4" /> },
        { id: "shaderpacks", label: "Шейдеры", desc: "Папка shaderpacks", icon: <IconWallpaper className="w-4 h-4" /> },
        { id: "saves", label: "Миры / Сохранения", desc: "Папка saves", icon: <IconWorldUpload className="w-4 h-4" /> },
        { id: "data", label: "Конфиги и настройки", desc: "config, options.txt, servers.dat", icon: <IconSettings className="w-4 h-4" /> },
        { id: "logs", label: "Логи и кэш", desc: "logs, crash-reports", icon: <IconBug className="w-4 h-4" /> },
      ]

  const toggleCategory = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleImport = async () => {
    if (selected.size === 0) {
      alert("Выберите хотя бы одну категорию для импорта")
      return
    }
    setImporting(true)
    setError(null)
    try {
      const fileType = isServer ? "server" : "instance"
      const res = await api?.cloudDownloadAndImport(providerId, file.path, fileType, Array.from(selected))
      if (res?.success) {
        onSuccess(isServer ? "server" : "build")
      } else {
        setError(res?.error || "Ошибка импорта")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const name = isServer
    ? file.name.replace(/\.zip$/i, "").replace(/^server-/i, "")
    : file.name.replace(/\.zip$/i, "")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0" onClick={onClose}>
      <div className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-foreground text-base">Импорт: {name}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Выберите компоненты архива, которые хотите импортировать ({isServer ? "сервер" : "сборка"}):
          </p>
        </div>

        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {categories.map(c => {
            const isChecked = selected.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCategory(c.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                  isChecked
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded flex items-center justify-center border transition-colors",
                  isChecked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 bg-background"
                )}>
                  {isChecked && <IconCheck className="w-3.5 h-3.5" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {c.icon}
                    <span>{c.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{c.desc}</p>
                </div>
              </button>
            )
          })}
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>

        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={handleImport}
            disabled={importing || selected.size === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {importing && <IconLoader2 className="w-4 h-4 animate-spin" />}
            {importing ? "Импорт..." : "Импортировать"}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Выбор содержимого перед загрузкой в облако: пользователь отмечает категории,
 * которые попадут в архив (например, только `mods` у сборки или `world`+`mods` у сервера).
 */
function SelectiveUploadModal({
  kind,
  name,
  uploading,
  progress,
  onClose,
  onConfirm,
}: {
  kind: "build" | "server"
  name: string
  uploading: boolean
  progress?: { percent: number; stage: "zip" | "upload" }
  onClose: () => void
  onConfirm: (categories: string[]) => void
}) {
  const { t } = useTranslation()
  const isServer = kind === "server"

  const categories = isServer
    ? [
        { id: "world", labelKey: "upload.cat.world", descKey: "upload.cat.worldDesc", icon: <IconWorldUpload className="w-4 h-4" /> },
        { id: "mods", labelKey: "upload.cat.mods", descKey: "upload.cat.modsDesc", icon: <IconBox className="w-4 h-4" /> },
        { id: "plugins", labelKey: "upload.cat.plugins", descKey: "upload.cat.pluginsDesc", icon: <IconPlug className="w-4 h-4" /> },
        { id: "configs", labelKey: "upload.cat.configs", descKey: "upload.cat.configsDesc", icon: <IconSettings className="w-4 h-4" /> },
        { id: "logs", labelKey: "upload.cat.logs", descKey: "upload.cat.logsDesc", icon: <IconBug className="w-4 h-4" /> },
      ]
    : [
        { id: "mods", labelKey: "upload.cat.mods", descKey: "upload.cat.modsDesc", icon: <IconBox className="w-4 h-4" /> },
        { id: "resourcepacks", labelKey: "upload.cat.resourcepacks", descKey: "upload.cat.resourcepacksDesc", icon: <IconPalette className="w-4 h-4" /> },
        { id: "shaderpacks", labelKey: "upload.cat.shaderpacks", descKey: "upload.cat.shaderpacksDesc", icon: <IconWallpaper className="w-4 h-4" /> },
        { id: "saves", labelKey: "upload.cat.saves", descKey: "upload.cat.savesDesc", icon: <IconWorldUpload className="w-4 h-4" /> },
        { id: "data", labelKey: "upload.cat.data", descKey: "upload.cat.dataDesc", icon: <IconSettings className="w-4 h-4" /> },
        { id: "logs", labelKey: "upload.cat.logs", descKey: "upload.cat.logsDesc", icon: <IconBug className="w-4 h-4" /> },
      ]

  const allIds = categories.map((c) => c.id)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allIds))
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = selected.size === allIds.length

  const handleConfirm = () => {
    if (selected.size === 0) {
      setError(t("upload.errorNoCategories"))
      return
    }
    setError(null)
    // Если выбраны все категории — отправляем пустой фильтр (это «весь интент»,
    // включая файлы вне известных категорий).
    onConfirm(allSelected ? [] : Array.from(selected))
  }

  const pct = progress?.percent ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0" onClick={uploading ? undefined : onClose}>
      <div className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-foreground text-base">{t("upload.title", { name })}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t(isServer ? "upload.subtitleServer" : "upload.subtitleBuild")}
          </p>
        </div>

        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          <button
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))}
            disabled={uploading}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all text-xs font-medium border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            <div className={cn(
              "w-5 h-5 rounded flex items-center justify-center border transition-colors",
              allSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 bg-background"
            )}>
              {allSelected && <IconCheck className="w-3.5 h-3.5" strokeWidth={3} />}
            </div>
            {t("upload.selectAll")}
          </button>

          {categories.map(c => {
            const isChecked = selected.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                disabled={uploading}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all disabled:opacity-50",
                  isChecked
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded flex items-center justify-center border transition-colors",
                  isChecked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 bg-background"
                )}>
                  {isChecked && <IconCheck className="w-3.5 h-3.5" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {c.icon}
                    <span>{t(c.labelKey)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{t(c.descKey)}</p>
                </div>
              </button>
            )
          })}

          {progress && uploading && (
            <div className="pt-1">
              <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {progress.stage === "zip" ? t("upload.packing") : t("upload.uploading")} · {pct}%
              </p>
            </div>
          )}

          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>

        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={uploading || selected.size === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {uploading && <IconLoader2 className="w-4 h-4 animate-spin" />}
            {uploading ? t("upload.uploading") : t("upload.confirm")}
          </button>
        </div>
      </div>
    </div>
  )
}
