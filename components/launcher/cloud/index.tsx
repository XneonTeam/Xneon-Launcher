import { CONTENT_ENTER, CONTENT_ENTER_DELAYED } from "../content-motion"
import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { IconCloud, IconLogout, IconLoader2, IconArrowLeft } from "@tabler/icons-react"
import { ProviderIcon } from "./provider-icon"
import { CloudProviderCard } from "./cloud-provider-card"
import { CloudFileBrowser } from "./cloud-file-browser"
import { WebDavSetupModal } from "./cloud-webdav-setup"
import { S3SetupModal } from "./cloud-s3-setup"
import { ErrorBoundary } from "./error-boundary"
import { useAlertDialog } from "@/lib/use-alert-dialog"

const api = typeof window !== "undefined" ? window.electronAPI : undefined

type ProviderInfo = { id: string; name: string }
type ConnectedProvider = { id: string; name: string }

export function CloudPage({ rootResetToken, pendingThemeId, onPendingThemeHandled }: { rootResetToken?: number; pendingThemeId?: string | null; onPendingThemeHandled?: () => void }) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [connected, setConnected] = useState<ConnectedProvider | null>(null)
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(true)
  const [showWebdav, setShowWebdav] = useState(false)
  const [showS3, setShowS3] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  const { showAlert, alertDialog } = useAlertDialog()

  /**
   * Повторный клик по активному пункту «Облако» в боковом меню закрывает файловый
   * браузер и возвращает к списку хранилищ. Счётчик приходит из launcher.tsx и
   * меняется только при таком клике — первый рендер ничего не сбрасывает.
   */
  const rootResetRef = useRef(rootResetToken ?? 0)
  useEffect(() => {
    if (rootResetToken === undefined || rootResetToken === rootResetRef.current) return
    rootResetRef.current = rootResetToken
    setConnected(null)
  }, [rootResetToken])

  useEffect(() => {
    if (!api) { setChecking(false); return }
    let cancelled = false
    api.cloudListProviders()
      .then((provs) => {
        if (cancelled) return
        setProviders(provs)
        setChecking(false)
        // Проверяем статусы подключения параллельно и не блокируем рендер карточек.
        void checkAnyConnected(provs)
      })
      .catch(() => { if (!cancelled) { setProviders([]); setChecking(false) } })
    return () => { cancelled = true }
  }, [])

  const checkAnyConnected = useCallback(async (provs: ProviderInfo[]) => {
    if (!api || provs.length === 0) return
    const results = await Promise.all(
      provs.map(async (p) => {
        try { return { id: p.id, ok: await api.cloudIsConnected(p.id) } }
        catch { return { id: p.id, ok: false } }
      })
    )
    const ids = new Set(results.filter(r => r.ok).map(r => r.id))
    setConnectedIds(ids)
  }, [])

  const handleConnect = useCallback(async (providerId: string) => {
    if (!api) return
    if (providerId === "webdav") { setShowWebdav(true); return }
    if (providerId === "s3") { setShowS3(true); return }

    const alreadyConnected = await api.cloudIsConnected(providerId).catch(() => false)
    if (alreadyConnected) {
      const provs = await api.cloudListProviders().catch(() => [])
      const prov = provs.find(p => p.id === providerId)
      setConnected({ id: providerId, name: prov?.name ?? providerId })
      return
    }

    setConnecting(providerId)
    try {
      const result = await api.cloudConnect(providerId)
      if (result.success) {
        setConnectedIds(prev => new Set(prev).add(providerId))
        setConnected({ id: providerId, name: providers.find(p => p.id === providerId)?.name || providerId })
      }
    } catch (e) {
      showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) }))
    } finally { setConnecting(null) }
  }, [providers, showAlert])

  const handleWebdavConnect = useCallback(async (url: string, username: string, password: string) => {
    if (!api) return
    setConnecting("webdav")
    try {
      const result = await api.cloudConnect("webdav", { url, username, password })
      if (result.success) {
        setConnected({ id: "webdav", name: "WebDAV" })
        setShowWebdav(false)
      } else {
        showAlert(result.error || t("cloud.connectionError"))
      }
    } catch (e) {
      showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) }))
    } finally { setConnecting(null) }
  }, [showAlert])

  const handleS3Connect = useCallback(async (data: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string; forcePathStyle: string }) => {
    if (!api) return
    setConnecting("s3")
    try {
      const result = await api.cloudConnect("s3", data)
      if (result.success) {
        setConnected({ id: "s3", name: "S3" })
        setShowS3(false)
      } else {
        showAlert(result.error || t("cloud.connectionError"))
      }
    } catch (e) {
      showAlert(t("cloud.error", { message: e instanceof Error ? e.message : String(e) }))
    } finally { setConnecting(null) }
  }, [showAlert])

  const handleDisconnect = useCallback(async () => {
    if (!api || !connected) return
    await api.cloudDisconnect(connected.id)
    setConnectedIds(prev => { const next = new Set(prev); next.delete(connected.id); return next })
    setConnected(null)
  }, [connected])

  if (connected) {
    return (
      /* Нормальное окно раздела: без карточки, рамки и размытых пятен */
      <div data-ui="cloud-index-div-1" data-component="cloud-page" id="cloud-page" className="flex h-full min-h-0 flex-col">
        <div data-ui="cloud-index-div-2" className="flex min-h-0 flex-1 flex-col">
          <div data-ui="cloud-index-div-3" className={`launcher-page-header flex items-center justify-between mb-4 ${CONTENT_ENTER_DELAYED}`}>
            <div data-ui="cloud-index-div-4" className="flex items-center gap-3">
              <button data-ui="cloud-index-button-1" onClick={() => setConnected(null)}
                className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center">
                <IconArrowLeft className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <div data-ui="cloud-index-div-5" className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <ProviderIcon id={connected.id} className="w-5 h-5" />
              </div>
              <div data-ui="cloud-index-div-6">
                <h2 data-ui="cloud-index-h2-1" className="text-xl font-bold text-foreground">{connected.name}</h2>
                <p data-ui="cloud-index-p-1" className="mt-0.5 text-sm text-muted-foreground">{t("cloud.connected")}</p>
              </div>
            </div>
            <button data-ui="cloud-index-button-2" onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive border border-border transition-all">
              <IconLogout className="w-4 h-4" strokeWidth={1.75} />
              {t("cloud.disconnect")}
            </button>
          </div>
          <ErrorBoundary>
            <CloudFileBrowser providerId={connected.id} pendingThemeId={pendingThemeId} onPendingThemeHandled={onPendingThemeHandled} />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  return (
    /* Нормальное окно раздела: без карточки, рамки и размытых пятен */
    <div data-ui="cloud-index-div-7" data-component="cloud-page" id="cloud-page" className="flex h-full min-h-0 flex-col">
      {showWebdav && (
        <WebDavSetupModal
          onClose={() => setShowWebdav(false)}
          onConnect={handleWebdavConnect}
          connecting={connecting === "webdav"}
        />
      )}

      {showS3 && (
        <S3SetupModal
          onClose={() => setShowS3(false)}
          onConnect={handleS3Connect}
          connecting={connecting === "s3"}
        />
      )}

      <div data-ui="cloud-index-div-8" className="flex min-h-0 flex-1 flex-col">
        <div data-ui="cloud-index-div-9" className={`launcher-page-header mb-6 flex items-center gap-3 ${CONTENT_ENTER_DELAYED}`}>
          {/* Значок у заголовка — как у остальных разделов лаунчера */}
          <div data-ui="cloud-index-div-10" className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconCloud className="w-5 h-5 text-primary" />
          </div>
          <div data-ui="cloud-index-div-11">
            <h2 data-ui="cloud-index-h2-2" className="text-xl font-bold text-foreground">{t("cloud.title")}</h2>
            <p data-ui="cloud-index-p-2" className="mt-0.5 text-sm text-muted-foreground">{t("cloud.selectProvider")}</p>
          </div>
        </div>

        {checking ? (
          <div data-ui="cloud-index-div-12" className="flex-1 flex items-center justify-center">
            <IconLoader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div data-ui="cloud-index-div-13" className={`min-h-0 flex-1 overflow-y-auto px-1 pt-1 ${CONTENT_ENTER}`}>
            <div data-ui="cloud-index-div-14" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {providers.map(p => (
                <CloudProviderCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  onConnect={handleConnect}
                  connecting={connecting === p.id}
                  isConnected={connectedIds.has(p.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {alertDialog}
    </div>
  )
}
