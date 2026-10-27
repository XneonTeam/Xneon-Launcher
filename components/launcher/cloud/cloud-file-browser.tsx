import { useContentEnter, CONTENT_ENTER_DELAYED } from "../content-motion"
import { IconPalette } from "@tabler/icons-react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconFolder, IconFile, IconDownload, IconTrash, IconLoader2, IconRefresh, IconUpload, IconArrowUp, IconLayoutGrid, IconColorSwatch, IconUser, IconHome, IconCloud, IconServer, IconPuzzle, IconPhoto, IconSparkles, IconMap, IconSettings, IconBug, IconPlug, IconCheck } from "@tabler/icons-react"
import { formatBytes, timeAgo } from "./utils"
import { useAccounts, type Account } from "@/src/AccountsContext"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import { getAvatarUrl, getAccountTypeInfo, type AccountType } from "../accounts-page"
import type { CloudUploadCategory } from "@xnlc/types"
import { useAlertDialog } from "@/lib/use-alert-dialog"
import { ActionConfirmDialog } from "@/components/launcher/instance/action-confirm-dialog"
import { ModalLayer } from "@/components/ui/modal-layer"
import { ThemeCompactPreview } from "../settings/theme-preview"
import { parseThemes } from "../settings/theme-model"
import type { Theme } from "../settings/types"

const FALLBACK_AVATAR = "avatar://head/Steve"
const cloudSectionIcons = { accounts: IconUser, builds: IconColorSwatch, servers: IconServer, themes: IconPalette }

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
  return <img data-ui="cloud-cloud-file-browser-img-1" data-component="cloud-file-icon" src={icon} alt="" className="w-full h-full object-cover rounded" onError={handleError} />
}

function BuildThumbIcon({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState(false)
  if (!icon || failed) {
    return (
      <div data-ui="cloud-cloud-file-browser-div-1" data-component="build-thumb-icon" className="w-full h-full flex items-center justify-center">
        <IconColorSwatch className="w-5 h-5 text-primary" />
      </div>
    )
  }
  return <img data-ui="cloud-cloud-file-browser-img-2" data-component="build-thumb-icon" src={icon} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
}

function FileIcon({ file, currentPath, localBuilds, localServers }: {
  file: CloudFile
  currentPath: string
  localBuilds: Array<{ id: string; name: string; icon?: string; modLoader?: string }>
  localServers: Array<{ id: string; name: string; icon?: string; version?: string; modloader?: string }>
}) {
  if (file.isDir) {
    const Icon = !currentPath && Object.hasOwn(cloudSectionIcons, file.name)
      ? cloudSectionIcons[file.name as keyof typeof cloudSectionIcons]
      : IconFolder
    return <Icon className="w-5 h-5 text-primary/70" strokeWidth={1.75} />
  }
  if (file.name.endsWith(".xntheme")) return <IconColorSwatch className="h-5 w-5 text-primary" />

  if (currentPath === "accounts" && file.name.endsWith(".json")) {
    const username = file.name.replace(/\.json$/i, "")
    return <CloudFileIcon icon={`avatar://head/${encodeURIComponent(username)}`} name={username} />
  }

  if (currentPath === "builds" && file.name.endsWith(".zip")) {
    const buildName = file.name.replace(/\.zip$/i, "")
    const localBuild = localBuilds.find(b => b.name.trim().toLowerCase() === buildName.trim().toLowerCase() || b.name.toLowerCase().includes(buildName.toLowerCase()) || buildName.toLowerCase().includes(b.name.toLowerCase()))
    if (localBuild?.icon) return <CloudFileIcon icon={localBuild.icon} name={buildName} />
    // Нет иконки сборки — показываем лоадер, чтобы строка не была «голой»
    return (
      <div data-ui="cloud-cloud-file-browser-div-2" data-component="file-icon" className="w-full h-full flex items-center justify-center text-primary">
        <LoaderIcon loaderId={localBuild?.modLoader ?? "instance"} className="w-5 h-5" />
      </div>
    )
  }

  if (currentPath === "servers" && file.name.endsWith(".zip")) {
    const serverName = file.name.replace(/\.zip$/i, "").replace(/^server-/i, "")
    const localServer = localServers.find(s => s.name.trim().toLowerCase() === serverName.trim().toLowerCase() || s.name.toLowerCase().includes(serverName.toLowerCase()) || serverName.toLowerCase().includes(s.name.toLowerCase()))
    // У сервера есть своя иконка — показываем её, как у сборок. Лоадер остаётся
    // запасным вариантом, когда иконка не задана.
    if (localServer?.icon) return <CloudFileIcon icon={localServer.icon} name={serverName} />
    return (
      <div data-ui="cloud-cloud-file-browser-div-3" data-component="file-icon" className="w-full h-full flex items-center justify-center text-primary">
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
  themePreview?: Theme
}

type Props = {
  providerId: string
  pendingThemeId?: string | null
  onPendingThemeHandled?: () => void
}

export function CloudFileBrowser({ providerId, pendingThemeId, onPendingThemeHandled }: Props) {
  const { t } = useTranslation()
  const { addAccount } = useAccounts()
  const [files, setFiles] = useState<CloudFile[]>([])
  const [localBuilds, setLocalBuilds] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modLoader?: string }>>([])
  const [localServers, setLocalServers] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modloader?: string }>>([])
  const [loading, setLoading] = useState(true)
  const contentEnter = useContentEnter(!loading)
  const [error, setError] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState<string>("")
  const [filter, setFilter] = useState<"all" | "builds" | "servers" | "accounts" | "themes">("all")
  const [importingTheme, setImportingTheme] = useState<string | null>(null)
  const [quota, setQuota] = useState<{ used: number; total: number } | null>(null)
  const [showUploadChoice, setShowUploadChoice] = useState(false)
  const [uploadChoiceThemeId, setUploadChoiceThemeId] = useState<string | null>(null)
  const [uploadedThemeId, setUploadedThemeId] = useState<string | null>(null)
  const [importModalFile, setImportModalFile] = useState<CloudFile | null>(null)
  // Выбор содержимого перед загрузкой в облако (сборка/сервер)
  const [uploadModalTarget, setUploadModalTarget] = useState<{ kind: "build" | "server"; id: string; name: string } | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Record<string, { percent: number; stage: "zip" | "upload" }>>({})
  const { showAlert, alertDialog } = useAlertDialog()
  const [pendingDelete, setPendingDelete] = useState<CloudFile | null>(null)

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
      if (!result.success) throw new Error(result.error || t("cloud.errorUpload"))
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
    if (!pendingThemeId) return
    setUploadChoiceThemeId(pendingThemeId)
    setShowUploadChoice(true)
    onPendingThemeHandled?.()
  }, [pendingThemeId, onPendingThemeHandled])

  useEffect(() => {
    window.electronAPI?.loadBuildsLight().then(builds => {
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
    if (file.name.endsWith(".xntheme")) {
      if (importingTheme) return
      setImportingTheme(file.id)
      try {
        const result = await api.cloudImportTheme(providerId, file.path)
        if (!result.success) throw new Error(result.error || t("cloud.importError"))
        showAlert(t("themeCloud.imported", { name: result.name }), { variant: "info", title: t("cloud.done") })
      } catch (error) { showAlert(error instanceof Error ? error.message : String(error)) }
      finally { setImportingTheme(null) }
      return
    }
    const isAccount = file.path.includes("/accounts/") || currentPath.includes("accounts")
    const isBuild = file.path.endsWith(".zip") && (file.path.includes("/builds/") || currentPath.includes("builds"))
    const isServer = file.path.endsWith(".zip") && (file.path.includes("/servers/") || currentPath.includes("servers"))

    if (isAccount) {
      try {
        const result = await api.cloudDownloadAndImport(providerId, file.path, "account")
        if (result.success && result.account) {
          addAccount({ ...result.account, type: result.account.type as Account["type"], isActive: false })
          window.dispatchEvent(new CustomEvent("cloud:imported", { detail: { type: "account" } }))
          showAlert(t("cloud.accountImported"), { variant: "info", title: t("cloud.done") })
        } else if (!result.success) {
          showAlert(result.error || t("cloud.importError"))
        }
      } catch (e) { showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) })) }
    } else if (isBuild || isServer) {
      setImportModalFile(file)
    } else {
      const { dialog } = window as any
      if (dialog?.showSaveDialog) {
        const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: file.name })
        if (!canceled && filePath) {
          const result = await api.cloudDownloadFile(providerId, file.path, filePath)
          if (!result.success) showAlert(result.error || t("cloud.errorDownload"))
        }
      } else {
        showAlert(t("cloud.onlyElectron"))
      }
    }
  }, [providerId, currentPath, addAccount, showAlert, importingTheme, t])

  const handleDelete = useCallback((file: CloudFile) => {
    if (!api) return
    setPendingDelete(file)
  }, [])

  const confirmDelete = useCallback(async () => {
    const file = pendingDelete
    if (!api || !file) return
    setPendingDelete(null)
    try {
      const result = await api.cloudDeleteFile(providerId, file.path)
      if (!result.success) throw new Error(result.error || t("cloud.errorDelete"))
      fetchFiles()
      fetchQuota()
    } catch (e) { showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) })) }
  }, [providerId, fetchFiles, fetchQuota, pendingDelete, showAlert])

  const handleUploadBuild = useCallback(async (buildId: string, buildName: string, categories?: string[]) => {
    if (!api) return
    setUploadingId(buildId)
    setUploadProgress({})
    try {
      const result = await api.cloudUploadBuild(providerId, buildName, buildId, categories as CloudUploadCategory[] | undefined)
      if (!result.success) throw new Error(result.error || t("cloud.errorUpload"))
      fetchFiles()
      fetchQuota()
      setShowUploadChoice(false)
      setUploadModalTarget(null)
    } catch (e) { showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) })) }
    finally { setUploadingId(null) }
  }, [providerId, fetchFiles, fetchQuota, showAlert])

  const handleUploadServer = useCallback(async (serverId: string, serverName: string, categories?: string[]) => {
    if (!api) return
    setUploadingId(serverId)
    setUploadProgress({})
    try {
      const result = await api.cloudUploadServer(providerId, serverId, serverName, serverId, categories as CloudUploadCategory[] | undefined)
      if (!result.success) throw new Error(result.error || t("cloud.errorUpload"))
      fetchFiles()
      fetchQuota()
      setShowUploadChoice(false)
      setUploadModalTarget(null)
    } catch (e) { showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) })) }
    finally { setUploadingId(null) }
  }, [providerId, fetchFiles, fetchQuota, showAlert])

  const handleUploadAccount = useCallback(async (account: { id: string; type: string; username: string; uuid?: string }) => {
    if (!api) return
    setUploadingId(account.id)
    setUploadProgress({})
    try {
      const result = await api.cloudUploadAccount(providerId, account)
      if (!result.success) throw new Error(result.error || t("cloud.errorUpload"))
      fetchFiles()
      fetchQuota()
    } catch (e) { showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) })) }
    finally { setUploadingId(null); setShowUploadChoice(false) }
  }, [providerId, fetchFiles, fetchQuota, showAlert])

  const handleUploadTheme = useCallback(async (theme: Theme) => {
    if (!api || uploadingId) return
    const uploadId = crypto.randomUUID()
    setUploadingId(theme.id)
    setUploadedThemeId(null)
    setUploadProgress({})
    try {
      const result = await api.cloudUploadTheme(providerId, theme.id, uploadId)
      if (!result.success) throw new Error(result.error || t("themeCloud.failed"))
      setUploadedThemeId(theme.id)
      void fetchFiles()
      void fetchQuota()
    } catch (e) {
      showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setUploadingId(null)
    }
  }, [providerId, uploadingId, fetchFiles, fetchQuota, showAlert, t])

  const translateFolderName = useCallback((name: string) => {
    if (name === "builds") return t("cloud.builds")
    if (name === "servers") return t("cloud.servers")
    if (name === "accounts") return t("cloud.accounts")
    if (name === "themes") return t("themeCloud.folder")
    return name
  }, [t])

  const getDisplayName = useCallback((file: CloudFile) => {
    if (file.isDir) return translateFolderName(file.name)
    if (file.themePreview) return file.themePreview.name
    if (file.name.endsWith(".xntheme")) return file.name.replace(/\.xntheme$/i, "")
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
    if (file.name.endsWith(".xntheme")) return <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{t("themeCloud.type")}</span>
    const isAccounts = currentPath === "accounts"
    const isBuilds = currentPath === "builds"
    const isServers = currentPath === "servers"
    if (isAccounts) {
      return <span data-ui="cloud-cloud-file-browser-span-1" className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{t("cloud.type.account")}</span>
    }
    if (isBuilds && file.name.endsWith(".zip")) {
      const buildName = file.name.replace(/\.zip$/i, "")
      const localBuild = localBuilds.find(b =>
        b.name.trim().toLowerCase() === buildName.trim().toLowerCase() ||
        b.name.toLowerCase().includes(buildName.toLowerCase()) ||
        buildName.toLowerCase().includes(b.name.toLowerCase()))
      return (
        <div data-ui="cloud-cloud-file-browser-div-4" className="flex items-center gap-1">
          <span data-ui="cloud-cloud-file-browser-span-2" className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">{t("cloud.type.build")}</span>
          {localBuild?.version && (
            <span data-ui="cloud-cloud-file-browser-span-3" className="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-medium">{localBuild.version}</span>
          )}
          {localBuild?.modLoader && (
            <span data-ui="cloud-cloud-file-browser-span-4" className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
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
        <div data-ui="cloud-cloud-file-browser-div-5" className="flex items-center gap-1">
          <span data-ui="cloud-cloud-file-browser-span-5" className="text-xs px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">{t("cloud.type.server")}</span>
          {localServer?.version && (
            <span data-ui="cloud-cloud-file-browser-span-6" className="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-medium">{localServer.version}</span>
          )}
          {localServer?.modloader && (
            <span data-ui="cloud-cloud-file-browser-span-7" className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
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
    <div data-ui="cloud-cloud-file-browser-div-6" data-component="cloud-file-browser" data-filter={filter} className="flex-1 flex flex-col min-h-0">
      {showUploadChoice && (
        <UploadChoiceModal
          providerId={providerId}
          onClose={() => { setShowUploadChoice(false); setUploadChoiceThemeId(null) }}
          onPickBuild={(id, name) => setUploadModalTarget({ kind: "build", id, name })}
          onPickServer={(id, name) => setUploadModalTarget({ kind: "server", id, name })}
          onUploadAccount={handleUploadAccount}
          onPickTheme={handleUploadTheme}
          uploading={uploadingId}
          progress={uploadProgress}
          initialTab={uploadChoiceThemeId ? "themes" : "builds"}
          initialThemeId={uploadChoiceThemeId}
          uploadedThemeId={uploadedThemeId}
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
            showAlert(type === "server" ? t("cloud.serverImported") : t("cloud.buildImported"), { variant: "info", title: t("cloud.done") })
          }}
        />
      )}

      <div data-ui="cloud-cloud-file-browser-div-7" className={`flex gap-0.5 p-1 mb-6 rounded-xl bg-muted/30 border border-border/50 w-fit mx-auto ${CONTENT_ENTER_DELAYED}`}>
        {(["all", "builds", "servers", "accounts", "themes"] as const).map(f => (
          <button data-ui="cloud-cloud-file-browser-button-1" key={f} data-active={filter === f} aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={cn("flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200",
              filter === f ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80")}>
            {(() => {
              const Icon = f === "all" ? IconLayoutGrid : cloudSectionIcons[f]
              return <Icon className="w-4 h-4" strokeWidth={1.75} />
            })()}
            {f === "all" ? t("cloud.all") : f === "builds" ? t("cloud.builds") : f === "servers" ? t("cloud.servers") : f === "themes" ? t("themeCloud.folder") : t("cloud.accounts")}
          </button>
        ))}
      </div>

      <div data-ui="cloud-cloud-file-browser-div-8" className={`flex items-center gap-2 mb-3 ${CONTENT_ENTER_DELAYED}`}>
        {currentPath && (
          <button data-ui="cloud-cloud-file-browser-button-2" onClick={handleGoUp}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <IconArrowUp className="w-3.5 h-3.5" /> ..
          </button>
        )}
        <div data-ui="cloud-cloud-file-browser-div-9" className="flex items-center gap-1 text-xs text-muted-foreground">
          <IconHome className="w-3.5 h-3.5" />
          {currentPath.split("/").filter(Boolean).map((part, i, arr) => (
            <span data-ui="cloud-cloud-file-browser-span-8" key={i} className="flex items-center gap-1">
              <span data-ui="cloud-cloud-file-browser-span-9" className="text-muted-foreground/40">/</span>
              <button data-ui="cloud-cloud-file-browser-button-3" onClick={() => setCurrentPath(arr.slice(0, i + 1).join("/"))}
                className="hover:text-foreground transition-colors cursor-pointer">{translateFolderName(part)}</button>
            </span>
          ))}
          {!currentPath && <span data-ui="cloud-cloud-file-browser-span-10">{t("cloud.root")}</span>}
        </div>
        <button data-ui="cloud-cloud-file-browser-button-4" onClick={fetchFiles}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          {loading ? <IconLoader2 className="w-4 h-4 text-primary animate-spin" /> : <IconRefresh className="w-4 h-4" />}
        </button>
        <button data-ui="cloud-cloud-file-browser-button-5" onClick={() => { setUploadChoiceThemeId(null); setUploadedThemeId(null); setShowUploadChoice(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-all">
          <IconUpload className="w-3.5 h-3.5" /> {t("cloud.upload")}
        </button>
      </div>

      <div data-ui="cloud-cloud-file-browser-div-10" className={cn("flex-1 overflow-y-auto", contentEnter)}>
        {loading ? (
          <div data-ui="cloud-cloud-file-browser-div-11" className="flex items-center justify-center py-12">
            <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : error ? (
          <div data-ui="cloud-cloud-file-browser-div-12" className="text-center py-12">
            <p data-ui="cloud-cloud-file-browser-p-1" className="text-sm text-destructive">{error}</p>
            <button data-ui="cloud-cloud-file-browser-button-6" onClick={fetchFiles} className="mt-2 text-xs text-primary hover:underline">{t("cloud.retry")}</button>
          </div>
        ) : filtered.length === 0 ? (
          <div data-ui="cloud-cloud-file-browser-div-13" className="text-center py-12">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary mx-auto mb-4"><IconCloud className="h-10 w-10" strokeWidth={1.75} aria-hidden="true" /></div>
            <p data-ui="cloud-cloud-file-browser-p-2" className="text-sm text-muted-foreground/50">{t("cloud.folderEmpty")}</p>
          </div>
        ) : (
          <div data-ui="cloud-cloud-file-browser-div-14" className="space-y-1">
            {filtered.map(file => (
              <div data-ui="cloud-cloud-file-browser-div-15" data-component="cloud-file-row" data-directory={file.isDir} key={file.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group",
                  file.isDir ? "hover:bg-muted/40 cursor-pointer" : "hover:bg-muted/30"
                )}
                onClick={() => file.isDir ? handleFolderClick(file.path) : undefined}>
                <div data-ui="cloud-cloud-file-browser-div-16" className={cn("flex items-center justify-center shrink-0 overflow-hidden", file.themePreview ? "w-40" : "w-9 h-9 rounded-lg bg-muted/50")}>
                  {file.themePreview ? <ThemeCompactPreview theme={file.themePreview} /> : <FileIcon file={file} currentPath={currentPath} localBuilds={localBuilds} localServers={localServers} />}
                </div>
                <div data-ui="cloud-cloud-file-browser-div-17" className="flex-1 min-w-0">
                  <div data-ui="cloud-cloud-file-browser-div-18" className="flex items-center gap-2">
                    <p data-ui="cloud-cloud-file-browser-p-3" className="text-sm font-medium text-foreground truncate">{getDisplayName(file)}</p>
                    {getFileTypeBadge(file)}
                  </div>
                  <p data-ui="cloud-cloud-file-browser-p-4" className="text-xs text-muted-foreground/60">
                    {file.isDir ? t("cloud.folder") : formatBytes(file.size)}
                    {file.modifiedAt && ` · ${timeAgo(file.modifiedAt)}`}
                  </p>
                </div>
                {!file.isDir && (currentPath === "builds" || currentPath === "servers" || currentPath === "accounts" || file.name.endsWith(".xntheme")) && (
                  <div data-ui="cloud-cloud-file-browser-div-19" className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button data-ui="cloud-cloud-file-browser-button-7" onClick={(e) => { e.stopPropagation(); handleDownload(file) }}
                      disabled={!!importingTheme}
                      className="p-1.5 rounded-lg hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors"
title={t("cloud.download")}>
                      {importingTheme === file.id ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconDownload className="w-4 h-4" />}
                    </button>
                    <button data-ui="cloud-cloud-file-browser-button-8" onClick={(e) => { e.stopPropagation(); handleDelete(file) }}
                      className="p-1.5 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                      title={t("cloud.delete")}>
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
        <div data-ui="cloud-cloud-file-browser-div-20" className="mt-3 pt-3 border-t border-border">
          <div data-ui="cloud-cloud-file-browser-div-21" className="flex items-center justify-between text-xs text-muted-foreground">
            <span data-ui="cloud-cloud-file-browser-span-11">{t("cloud.storageStatus")}</span>
            <span data-ui="cloud-cloud-file-browser-span-12">{formatBytes(quota.used)}{quota.total != null ? ` / ${formatBytes(quota.total)}` : ""}</span>
          </div>
          <div data-ui="cloud-cloud-file-browser-div-22" className="w-full h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
            <div data-ui="cloud-cloud-file-browser-div-23" className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${usedPercent}%` }} />
          </div>
        </div>
      )}

      <ActionConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={t("cloud.deleteFileTitle")}
        description={t("cloud.deleteFileDesc", { name: pendingDelete?.name ?? "" })}
        confirmText={t("cloud.delete")}
        cancelText={t("common.cancel")}
        variant="danger"
        icon="warning"
      />

      {alertDialog}
    </div>
  )
}

function UploadChoiceModal({ providerId, onClose, onPickBuild, onPickServer, onUploadAccount, onPickTheme, uploading, progress, initialTab = "builds", initialThemeId, uploadedThemeId }: {
  providerId: string
  onClose: () => void
  onPickBuild: (id: string, name: string) => void
  onPickServer: (id: string, name: string) => void
  onUploadAccount: (account: { id: string; type: string; username: string; uuid?: string }) => void
  onPickTheme: (theme: Theme) => void
  uploading: string | null
  progress: Record<string, { percent: number; stage: "zip" | "upload" }>
  initialTab?: "builds" | "servers" | "accounts" | "themes"
  initialThemeId?: string | null
  uploadedThemeId?: string | null
}) {
  const { t } = useTranslation()
  const accountTypeInfo = getAccountTypeInfo(t)
  const [localBuilds, setLocalBuilds] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modLoader?: string }>>([])
  const [localServers, setLocalServers] = useState<Array<{ id: string; name: string; icon?: string; version?: string; modloader?: string }>>([])
  const [localAccounts, setLocalAccounts] = useState<Array<{ id: string; type: string; username: string; uuid?: string }>>([])
  const [tab, setTab] = useState<"builds" | "servers" | "accounts" | "themes">(initialTab)
  const [localThemes, setLocalThemes] = useState<Theme[]>([])

  // Список локальных сборок/серверов/аккаунтов: один эффект вместо двух —
  // первый дублировал этот же запрос при монтировании (uploading === null).
  useEffect(() => {
    if (uploading !== null) return
    void window.electronAPI?.getSetting("customThemes").then(raw => setLocalThemes(parseThemes(raw))).catch(() => setLocalThemes([]))
    window.electronAPI?.loadBuildsLight().then(builds => {
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
    <ModalLayer windowId="cloud-cloud-file-browser-window-1" onClose={onClose} className="animate-in fade-in-0">
      <div data-ui="cloud-cloud-file-browser-div-24" data-component="upload-choice-modal" className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 overflow-hidden">
        <div data-ui="cloud-cloud-file-browser-div-25" className="flex border-b border-border">
          <button type="button" onClick={() => setTab("themes")} className={cn("flex-1 px-3 py-3 text-sm font-medium transition-colors", tab === "themes" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>{t("themeCloud.folder")}</button>
          <button data-ui="cloud-cloud-file-browser-button-9" onClick={() => setTab("builds")}
            className={cn("flex-1 px-4 py-3 text-sm font-medium transition-colors",
              tab === "builds" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
            {t("cloud.builds")}
          </button>
          <button data-ui="cloud-cloud-file-browser-button-10" onClick={() => setTab("servers")}
            className={cn("flex-1 px-4 py-3 text-sm font-medium transition-colors",
              tab === "servers" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
            {t("cloud.servers")}
          </button>
          <button data-ui="cloud-cloud-file-browser-button-11" onClick={() => setTab("accounts")}
            className={cn("flex-1 px-4 py-3 text-sm font-medium transition-colors",
              tab === "accounts" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
            {t("cloud.accounts")}
          </button>
        </div>
        <div data-ui="cloud-cloud-file-browser-div-26" className="max-h-80 overflow-y-auto p-3">
          {tab === "builds" ? (
            localBuilds.length === 0 ? (
              <p data-ui="cloud-cloud-file-browser-p-5" className="text-sm text-muted-foreground text-center py-8">{t("cloud.noBuilds")}</p>
            ) : (
              <div data-ui="cloud-cloud-file-browser-div-27" className="space-y-2">
                {localBuilds.map(b => {
                  const isUploading = uploading === b.id
                  const prog = progress[b.id]
                  const pct = prog?.percent ?? 0
                  return (
                    <div data-ui="cloud-cloud-file-browser-div-28" key={b.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                      <div data-ui="cloud-cloud-file-browser-div-29" className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden bg-primary/10">
                        <BuildThumbIcon icon={b.icon} />
                      </div>
                      <div data-ui="cloud-cloud-file-browser-div-30" className="flex-1 min-w-0">
                        <span data-ui="cloud-cloud-file-browser-span-13" className="font-medium text-foreground truncate block">{b.name}</span>
                        <div data-ui="cloud-cloud-file-browser-div-31" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          {b.version && <span data-ui="cloud-cloud-file-browser-span-14">{b.version}</span>}
                          {b.modLoader && (
                            <>
                              <span data-ui="cloud-cloud-file-browser-span-15">·</span>
                              <LoaderIcon loaderId={b.modLoader} className="w-4 h-4 flex-shrink-0" />
                              <span data-ui="cloud-cloud-file-browser-span-16" className="capitalize">{b.modLoader}</span>
                            </>
                          )}
                        </div>
                        {isUploading && prog && (
                          <div data-ui="cloud-cloud-file-browser-div-32" className="mt-2">
                            <div data-ui="cloud-cloud-file-browser-div-33" className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div data-ui="cloud-cloud-file-browser-div-34" className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                            </div>
                            <p data-ui="cloud-cloud-file-browser-p-6" className="text-[11px] text-muted-foreground mt-1">
                              {prog.stage === "zip" ? t("cloud.packing") : t("cloud.uploading")} · {pct}%
                            </p>
                          </div>
                        )}
                      </div>
                      <button data-ui="cloud-cloud-file-browser-button-12" onClick={() => onPickBuild(b.id, b.name)} disabled={isUploading}
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
              <p data-ui="cloud-cloud-file-browser-p-7" className="text-sm text-muted-foreground text-center py-8">{t("cloud.noServers")}</p>
            ) : (
              <div data-ui="cloud-cloud-file-browser-div-35" className="space-y-2">
                {localServers.map(s => {
                  const isUploading = uploading === s.id
                  const prog = progress[s.id]
                  const pct = prog?.percent ?? 0
                  return (
                    <div data-ui="cloud-cloud-file-browser-div-36" key={s.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                      <div data-ui="cloud-cloud-file-browser-div-37" className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden bg-primary/10">
                        {s.icon ? (
                          <img data-ui="cloud-cloud-file-browser-img-3" src={s.icon} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <IconServer className="w-6 h-6 text-primary" strokeWidth={1.75} />
                        )}
                      </div>
                      <div data-ui="cloud-cloud-file-browser-div-38" className="flex-1 min-w-0">
                        <span data-ui="cloud-cloud-file-browser-span-17" className="font-medium text-foreground truncate block">{s.name}</span>
                        <div data-ui="cloud-cloud-file-browser-div-39" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <span data-ui="cloud-cloud-file-browser-span-18">{s.version}</span>
                          {s.modloader && (
                            <>
                              <span data-ui="cloud-cloud-file-browser-span-19">·</span>
                              <LoaderIcon loaderId={s.modloader} className="w-4 h-4 flex-shrink-0" />
                              <span data-ui="cloud-cloud-file-browser-span-20" className="capitalize">{s.modloader}</span>
                            </>
                          )}
                        </div>
                        {isUploading && prog && (
                          <div data-ui="cloud-cloud-file-browser-div-40" className="mt-2">
                            <div data-ui="cloud-cloud-file-browser-div-41" className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div data-ui="cloud-cloud-file-browser-div-42" className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                            </div>
                            <p data-ui="cloud-cloud-file-browser-p-8" className="text-[11px] text-muted-foreground mt-1">
                              {prog.stage === "zip" ? t("cloud.archivingServer") : t("cloud.uploadingCloud")} · {pct}%
                            </p>
                          </div>
                        )}
                      </div>
                      <button data-ui="cloud-cloud-file-browser-button-13" onClick={() => onPickServer(s.id, s.name)} disabled={isUploading}
                        className="px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm flex-shrink-0 disabled:opacity-50">
                        {isUploading ? <IconLoader2 className="w-4 h-4 animate-spin" /> : t("upload.choose")}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            tab === "themes" ? (
              <div className="space-y-2">{localThemes.length ? localThemes.map(theme => {
                const isUploading = uploading === theme.id
                const isUploaded = uploadedThemeId === theme.id
                const prog = progress[theme.id]
                const highlighted = initialThemeId === theme.id
                return <div key={theme.id} className={cn("rounded-xl border bg-muted/20 p-3 transition-colors", highlighted ? "border-primary/60" : "border-border")}>
                  <div className="flex items-center gap-3">
                    <div className="w-40 shrink-0"><ThemeCompactPreview theme={theme} /></div>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{theme.name}</span>
                    <button type="button" disabled={!!uploading || isUploaded} onClick={() => onPickTheme(theme)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-primary transition-colors hover:bg-primary/15 disabled:cursor-default disabled:opacity-60" aria-label={t(isUploaded ? "themeCloud.done" : "cloud.upload")}>
                      {isUploading ? <IconLoader2 size={18} className="animate-spin" /> : isUploaded ? <IconCheck size={18} /> : <IconUpload size={18} />}
                    </button>
                  </div>
                  {isUploading && prog && <div className="mt-2 space-y-1"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${prog.percent}%` }} /></div><p className="text-[11px] text-muted-foreground">{t(prog.stage === "zip" ? "themeCloud.packing" : "themeCloud.uploading")} · {Math.round(prog.percent)}%</p></div>}
                  {isUploaded && <p role="status" className="mt-2 text-[11px] text-success">{t("themeCloud.done")}</p>}
                </div>
              }) : <p className="py-8 text-center text-sm text-muted-foreground">{t("settings.themes.customEmpty")}</p>}</div>
            ) : localAccounts.length === 0 ? (
              <p data-ui="cloud-cloud-file-browser-p-9" className="text-sm text-muted-foreground text-center py-8">{t("cloud.noAccounts")}</p>
            ) : (
              <div data-ui="cloud-cloud-file-browser-div-43" className="space-y-2">
                {localAccounts.map(a => {
                  const info = accountTypeInfo[a.type as AccountType] || accountTypeInfo.offline
                  const isUploading = uploading === a.id
                  const prog = progress[a.id]
                  const pct = prog?.percent ?? 0
                  return (
                    <div data-ui="cloud-cloud-file-browser-div-44" key={a.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 transition-all">
                      <div data-ui="cloud-cloud-file-browser-div-45" className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: `color-mix(in srgb, ${info.color} 12.5%, transparent)` }}>
                        <CachedAvatar src={getAvatarUrl(a, a.username)} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div data-ui="cloud-cloud-file-browser-div-46" className="flex-1 min-w-0">
                        <span data-ui="cloud-cloud-file-browser-span-21" className="font-medium text-foreground truncate block">{a.username}</span>
                        <span data-ui="cloud-cloud-file-browser-span-22" className="text-sm text-muted-foreground">{info.name}</span>
                        {isUploading && prog && (
                          <div data-ui="cloud-cloud-file-browser-div-47" className="mt-2">
                            <div data-ui="cloud-cloud-file-browser-div-48" className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div data-ui="cloud-cloud-file-browser-div-49" className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                            </div>
                            <p data-ui="cloud-cloud-file-browser-p-10" className="text-[11px] text-muted-foreground mt-1">{t("cloud.uploading")} · {pct}%</p>
                          </div>
                        )}
                      </div>
                      <button data-ui="cloud-cloud-file-browser-button-14" onClick={() => onUploadAccount(a)} disabled={isUploading}
                        className="px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm flex-shrink-0 disabled:opacity-50">
                        {isUploading ? <IconLoader2 className="w-4 h-4 animate-spin" /> : t("cloud.upload")}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
        <div data-ui="cloud-cloud-file-browser-div-50" className="p-3 border-t border-border flex justify-end">
          <button data-ui="cloud-cloud-file-browser-button-15" onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors">
            {t("cloud.close")}
          </button>
        </div>
      </div>
    </ModalLayer>
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
  const { t } = useTranslation()
  const isServer = file.path.includes("/servers/") || currentPath.includes("servers")
  const defaultCategories = isServer
    ? ["world", "mods", "plugins", "configs", "logs"]
    : ["mods", "resourcepacks", "shaderpacks", "saves", "data", "logs"]

  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultCategories))
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showAlert, alertDialog } = useAlertDialog()

  const categories = isServer
    ? [
        { id: "world", label: t("cloud.cat.world"), desc: t("cloud.cat.worldDesc"), icon: <IconMap className="w-4 h-4" /> },
        { id: "mods", label: t("cloud.cat.mods"), desc: t("cloud.cat.modsDesc"), icon: <IconPuzzle className="w-4 h-4" /> },
        { id: "plugins", label: t("cloud.cat.plugins"), desc: t("cloud.cat.pluginsDesc"), icon: <IconPlug className="w-4 h-4" /> },
        { id: "configs", label: t("cloud.cat.configs"), desc: t("cloud.cat.configsDesc"), icon: <IconSettings className="w-4 h-4" /> },
        { id: "logs", label: t("cloud.cat.logs"), desc: t("cloud.cat.logsDesc"), icon: <IconBug className="w-4 h-4" /> },
      ]
    : [
        { id: "mods", label: t("cloud.cat.mods"), desc: t("cloud.cat.modsDesc"), icon: <IconPuzzle className="w-4 h-4" /> },
        { id: "resourcepacks", label: t("cloud.cat.resourcepacks"), desc: t("cloud.cat.resourcepacksDesc"), icon: <IconPhoto className="w-4 h-4" /> },
        { id: "shaderpacks", label: t("cloud.cat.shaderpacks"), desc: t("cloud.cat.shaderpacksDesc"), icon: <IconSparkles className="w-4 h-4" /> },
        { id: "saves", label: t("cloud.cat.saves"), desc: t("cloud.cat.savesDesc"), icon: <IconMap className="w-4 h-4" /> },
        { id: "data", label: t("cloud.cat.data"), desc: t("cloud.cat.dataDesc"), icon: <IconSettings className="w-4 h-4" /> },
        { id: "logs", label: t("cloud.cat.logsCache"), desc: t("cloud.cat.logsDesc"), icon: <IconBug className="w-4 h-4" /> },
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
      showAlert(t("cloud.selectCategoryFirst"))
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
        setError(res?.error || t("cloud.importError"))
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
    <ModalLayer windowId="cloud-cloud-file-browser-window-2" onClose={onClose} className="animate-in fade-in-0">
      <div data-ui="cloud-cloud-file-browser-div-51" data-component="selective-import-modal" className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 overflow-hidden">
        <div data-ui="cloud-cloud-file-browser-div-52" className="p-4 border-b border-border">
          <h3 data-ui="cloud-cloud-file-browser-h3-1" className="font-semibold text-foreground text-base">{t("cloud.importTitle", { name })}</h3>
          <p data-ui="cloud-cloud-file-browser-p-11" className="text-xs text-muted-foreground mt-1">
            {t("cloud.importChooseComponents", { what: isServer ? t("cloud.type.server") : t("cloud.type.build") })}
          </p>
        </div>

        <div data-ui="cloud-cloud-file-browser-div-53" className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {categories.map(c => {
            const isChecked = selected.has(c.id)
            return (
              <button data-ui="cloud-cloud-file-browser-button-16"
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
                <div data-ui="cloud-cloud-file-browser-div-54" className={cn(
                  "w-5 h-5 rounded flex items-center justify-center border transition-colors",
                  isChecked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 bg-background"
                )}>
                  {isChecked && <IconCheck className="w-3.5 h-3.5" strokeWidth={3} />}
                </div>
                <div data-ui="cloud-cloud-file-browser-div-55" className="flex-1 min-w-0">
                  <div data-ui="cloud-cloud-file-browser-div-56" className="flex items-center gap-1.5 text-sm font-medium">
                    {c.icon}
                    <span data-ui="cloud-cloud-file-browser-span-23">{c.label}</span>
                  </div>
                  <p data-ui="cloud-cloud-file-browser-p-12" className="text-[11px] text-muted-foreground truncate">{c.desc}</p>
                </div>
              </button>
            )
          })}
          {error && <p data-ui="cloud-cloud-file-browser-p-13" className="text-xs text-destructive mt-2">{error}</p>}
        </div>

        <div data-ui="cloud-cloud-file-browser-div-57" className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button data-ui="cloud-cloud-file-browser-button-17"
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button data-ui="cloud-cloud-file-browser-button-18"
            onClick={handleImport}
            disabled={importing || selected.size === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {importing && <IconLoader2 className="w-4 h-4 animate-spin" />}
            {importing ? t("cloud.importing") : t("cloud.import")}
          </button>
        </div>
      </div>

      {alertDialog}
    </ModalLayer>
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
        { id: "world", labelKey: "upload.cat.world", descKey: "upload.cat.worldDesc", icon: <IconMap className="w-4 h-4" /> },
        { id: "mods", labelKey: "upload.cat.mods", descKey: "upload.cat.modsDesc", icon: <IconPuzzle className="w-4 h-4" /> },
        { id: "plugins", labelKey: "upload.cat.plugins", descKey: "upload.cat.pluginsDesc", icon: <IconPlug className="w-4 h-4" /> },
        { id: "configs", labelKey: "upload.cat.configs", descKey: "upload.cat.configsDesc", icon: <IconSettings className="w-4 h-4" /> },
        { id: "logs", labelKey: "upload.cat.logs", descKey: "upload.cat.logsDesc", icon: <IconBug className="w-4 h-4" /> },
      ]
    : [
        { id: "mods", labelKey: "upload.cat.mods", descKey: "upload.cat.modsDesc", icon: <IconPuzzle className="w-4 h-4" /> },
        { id: "resourcepacks", labelKey: "upload.cat.resourcepacks", descKey: "upload.cat.resourcepacksDesc", icon: <IconPhoto className="w-4 h-4" /> },
        { id: "shaderpacks", labelKey: "upload.cat.shaderpacks", descKey: "upload.cat.shaderpacksDesc", icon: <IconSparkles className="w-4 h-4" /> },
        { id: "saves", labelKey: "upload.cat.saves", descKey: "upload.cat.savesDesc", icon: <IconMap className="w-4 h-4" /> },
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
    <ModalLayer windowId="cloud-cloud-file-browser-window-3" onClose={() => { if (!uploading) onClose() }} className="animate-in fade-in-0">
      <div data-ui="cloud-cloud-file-browser-div-58" data-component="selective-upload-modal" className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 overflow-hidden">
        <div data-ui="cloud-cloud-file-browser-div-59" className="p-4 border-b border-border">
          <h3 data-ui="cloud-cloud-file-browser-h3-2" className="font-semibold text-foreground text-base">{t("upload.title", { name })}</h3>
          <p data-ui="cloud-cloud-file-browser-p-14" className="text-xs text-muted-foreground mt-1">
            {t(isServer ? "upload.subtitleServer" : "upload.subtitleBuild")}
          </p>
        </div>

        <div data-ui="cloud-cloud-file-browser-div-60" className="p-4 space-y-2 max-h-80 overflow-y-auto">
          <button data-ui="cloud-cloud-file-browser-button-19"
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))}
            disabled={uploading}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all text-xs font-medium border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            <div data-ui="cloud-cloud-file-browser-div-61" className={cn(
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
              <button data-ui="cloud-cloud-file-browser-button-20"
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
                <div data-ui="cloud-cloud-file-browser-div-62" className={cn(
                  "w-5 h-5 rounded flex items-center justify-center border transition-colors",
                  isChecked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 bg-background"
                )}>
                  {isChecked && <IconCheck className="w-3.5 h-3.5" strokeWidth={3} />}
                </div>
                <div data-ui="cloud-cloud-file-browser-div-63" className="flex-1 min-w-0">
                  <div data-ui="cloud-cloud-file-browser-div-64" className="flex items-center gap-1.5 text-sm font-medium">
                    {c.icon}
                    <span data-ui="cloud-cloud-file-browser-span-24">{t(c.labelKey)}</span>
                  </div>
                  <p data-ui="cloud-cloud-file-browser-p-15" className="text-[11px] text-muted-foreground truncate">{t(c.descKey)}</p>
                </div>
              </button>
            )
          })}

          {progress && uploading && (
            <div data-ui="cloud-cloud-file-browser-div-65" className="pt-1">
              <div data-ui="cloud-cloud-file-browser-div-66" className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                <div data-ui="cloud-cloud-file-browser-div-67" className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <p data-ui="cloud-cloud-file-browser-p-16" className="text-[11px] text-muted-foreground mt-1">
                {progress.stage === "zip" ? t("upload.packing") : t("upload.uploading")} · {pct}%
              </p>
            </div>
          )}

          {error && <p data-ui="cloud-cloud-file-browser-p-17" className="text-xs text-destructive mt-2">{error}</p>}
        </div>

        <div data-ui="cloud-cloud-file-browser-div-68" className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button data-ui="cloud-cloud-file-browser-button-21"
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button data-ui="cloud-cloud-file-browser-button-22"
            onClick={handleConfirm}
            disabled={uploading || selected.size === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {uploading && <IconLoader2 className="w-4 h-4 animate-spin" />}
            {uploading ? t("upload.uploading") : t("upload.confirm")}
          </button>
        </div>
      </div>
    </ModalLayer>
  )
}
