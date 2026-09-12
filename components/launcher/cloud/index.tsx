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
    api.cloudListProviders().then(setProviders).catch(() => setProviders([]))
    checkAnyConnected()
  }, [])

  const checkAnyConnected = useCallback(async () => {
    if (!api) { setChecking(false); return }
    try {
      const provs = await api.cloudListProviders()
      const ids = new Set<string>()
      for (const p of provs) {
        const ok = await api.cloudIsConnected(p.id)
        if (ok) ids.add(p.id)
      }
      setConnectedIds(ids)
    } catch { /* noop */ }
    setChecking(false)
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
      showAlert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
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
        showAlert(result.error || "Ошибка подключения")
      }
    } catch (e) {
      showAlert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
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
        showAlert(result.error || "Ошибка подключения")
      }
    } catch (e) {
      showAlert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
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
      <div className="relative overflow-hidden rounded-2xl bg-card border border-border h-[calc(100vh-5rem)] flex flex-col">
        <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="relative z-10 p-4 flex flex-col h-full">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setConnected(null)}
                className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center">
                <IconArrowLeft className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <div>
                <h2 className="text-xl font-semibold text-foreground">{connected.name}</h2>
                <p className="text-sm text-muted-foreground">{t("cloud.connected")}</p>
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
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border h-[calc(100vh-5rem)] flex flex-col">
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

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

      <div className="relative z-10 p-4 flex flex-col h-full">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-foreground">{t("cloud.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("cloud.selectProvider")}</p>
        </div>

        {checking ? (
          <div className="flex-1 flex items-center justify-center">
            <IconLoader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          </div>
        ) : (
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
        )}
      </div>

      {alertDialog}
    </div>
  )
}
