import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { IconCloud, IconLogout, IconLoader2, IconArrowLeft } from "@tabler/icons-react"
import { CloudProviderCard } from "./cloud-provider-card"
import { CloudFileBrowser } from "./cloud-file-browser"
import { WebDavSetupModal } from "./cloud-webdav-setup"
import { S3SetupModal } from "./cloud-s3-setup"
import { ErrorBoundary } from "./error-boundary"
import { useAlertDialog } from "@/lib/use-alert-dialog"

const api = typeof window !== "undefined" ? window.electronAPI : undefined

type ProviderInfo = { id: string; name: string }
type ConnectedProvider = { id: string; name: string }

export function CloudPage() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [connected, setConnected] = useState<ConnectedProvider | null>(null)
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(true)
  const [showWebdav, setShowWebdav] = useState(false)
  const [showS3, setShowS3] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  const { showAlert, alertDialog } = useAlertDialog()

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
      <div className="flex h-full min-h-0 flex-col animate-in fade-in-0 duration-300">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setConnected(null)}
                className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center">
                <IconArrowLeft className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <IconCloud className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{connected.name}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{t("cloud.connected")}</p>
              </div>
            </div>
            <button onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive border border-border transition-all">
              <IconLogout className="w-4 h-4" strokeWidth={1.75} />
              {t("cloud.disconnect")}
            </button>
          </div>
          <ErrorBoundary>
            <CloudFileBrowser providerId={connected.id} />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  return (
    /* Нормальное окно раздела: без карточки, рамки и размытых пятен */
    <div className="flex h-full min-h-0 flex-col animate-in fade-in-0 duration-300">
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

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-6 flex items-center gap-3">
          {/* Значок у заголовка — как у остальных разделов лаунчера */}
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconCloud className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{t("cloud.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("cloud.selectProvider")}</p>
          </div>
        </div>

        {checking ? (
          <div className="flex-1 flex items-center justify-center">
            <IconLoader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
