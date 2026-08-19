import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { IconCheck, IconLoader2, IconUserMinus, IconArrowLeft } from "@tabler/icons-react"
import { MicrosoftIcon, ElyByIcon, XnSkinsIcon } from "./icons"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import type { OnboardingCopy } from "./translations"

type StepAccountProps = {
  copy: OnboardingCopy
  accounts: Account[]
  anyLoginLoading: boolean
  getAvatarUrl: (account: Account, username: string) => string
  setActiveAccount: (id: string) => void
  onProviderLogin: (provider: "elyby" | "xnskins" | "microsoft") => void
  onOpenOffline: () => void
}

type Account = {
  id: string
  type: string
  username: string
  isActive: boolean
}

type ProviderId = "microsoft" | "elyby" | "xnskins"

const PROVIDERS: { id: ProviderId; title: string; description: string; color: string; methodOAuthDesc: string; methodDeviceDesc: string }[] = [
  {
    id: "microsoft", title: "Microsoft",
    description: "Official Mojang / Microsoft sign-in.",
    color: "#2563EB",
    methodOAuthDesc: "Вход через браузерное окно авторизации",
    methodDeviceDesc: "Введите код на сайте Microsoft на любом устройстве",
  },
  {
    id: "elyby", title: "Ely.By",
    description: "Sign in with an Ely.By account.",
    color: "#217e5c",
    methodOAuthDesc: "Вход через браузерное окно авторизации",
    methodDeviceDesc: "Введите код на сайте Ely.by на любом устройстве",
  },
  {
    id: "xnskins", title: "XN Skins",
    description: "Sign in with XN Skins support.",
    color: "#f97316",
    methodOAuthDesc: "Вход через браузерное окно авторизации",
    methodDeviceDesc: "Введите код на сайте XN Skins на любом устройстве",
  },
]

export function StepAccount({ copy, accounts, anyLoginLoading, getAvatarUrl, setActiveAccount, onProviderLogin, onOpenOffline }: StepAccountProps) {
  const [chosenProvider, setChosenProvider] = useState<ProviderId | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState("")
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{
    deviceCode: string
    userCode: string
    verificationUriComplete: string
    interval: number
  } | null>(null)
  const [devicePolling, setDevicePolling] = useState(false)
  const [deviceStatus, setDeviceStatus] = useState<"waiting" | "expired" | "done">("waiting")
  const [copied, setCopied] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onAuthProgress?.(() => {})
    cleanupRef.current = () => unsubscribe?.()
    return () => { cleanupRef.current?.() }
  }, [])

  const resetDeviceState = useCallback(() => {
    setDeviceCodeInfo(null)
    setDevicePolling(false)
    setDeviceStatus("waiting")
    setAuthError("")
    setAuthLoading(false)
  }, [])

  const handleStartDeviceCode = useCallback(async (provider: ProviderId) => {
    setAuthLoading(true)
    setAuthError("")
    setDeviceStatus("waiting")
    setDeviceCodeInfo(null)
    try {
      const startFn = provider === "elyby" ? "startElyByDeviceCode"
        : provider === "xnskins" ? "startXnSkinsDeviceCode"
        : "startMicrosoftDeviceCode"
      const info = await (window.electronAPI as any)?.[startFn]()
      if (info) {
        setDeviceCodeInfo({
          deviceCode: info.deviceCode,
          userCode: info.userCode,
          verificationUriComplete: info.verificationUriComplete,
          interval: info.interval,
        })
        setDevicePolling(true)
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Ошибка")
    } finally {
      setAuthLoading(false)
    }
  }, [])

  const finishDeviceLogin = useCallback((provider: ProviderId, result: { id: string; username: string; uuid?: string; accessToken: string; refreshToken?: string }) => {
    const { addAccount } = {} as any
    window.dispatchEvent(new CustomEvent("onboarding:add-account", {
      detail: { id: result.id, type: provider, username: result.username, uuid: result.uuid, accessToken: result.accessToken, refreshToken: result.refreshToken },
    }))
    setDeviceStatus("done")
    setDevicePolling(false)
    setDeviceCodeInfo(null)
    setChosenProvider(null)
  }, [])

  useEffect(() => {
    if (!deviceCodeInfo || !devicePolling || deviceStatus !== "waiting" || !chosenProvider) return
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled) return
      try {
        const pollFn = chosenProvider === "elyby" ? "pollElyByDeviceCode"
          : chosenProvider === "xnskins" ? "pollXnSkinsDeviceCode"
          : "pollMicrosoftDeviceCode"
        const result = await (window.electronAPI as any)?.[pollFn](deviceCodeInfo.deviceCode)
        if (cancelled || !result) return
        if (result.status === "complete" && result.account) {
          finishDeviceLogin(chosenProvider, result.account)
          return
        }
        if (result.status === "expired") {
          setDevicePolling(false)
          setDeviceStatus("expired")
          setAuthError("Срок действия кода истёк. Запросите новый код.")
          return
        }
        if (result.status === "error" && !result.retryable) {
          setDevicePolling(false)
          setDeviceStatus("expired")
          setAuthError(result.message)
          return
        }
        if (result.status === "error" && result.retryable) {
          setAuthError(result.message)
        }
        const delayMs = (result.status === "pending" && result.slowDown ? deviceCodeInfo.interval + 5 : deviceCodeInfo.interval) * 1000
        pollTimer = setTimeout(poll, Math.max(delayMs, 5000))
      } catch (err: unknown) {
        if (cancelled) return
        setAuthError(err instanceof Error ? err.message : "Ошибка")
        pollTimer = setTimeout(poll, deviceCodeInfo.interval * 1000)
      }
    }
    pollTimer = setTimeout(poll, deviceCodeInfo.interval * 1000)
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer) }
  }, [deviceCodeInfo, devicePolling, deviceStatus, chosenProvider, finishDeviceLogin])

  const provider = chosenProvider ? PROVIDERS.find(p => p.id === chosenProvider) : null

  return (
    <div className="space-y-5">
      {!chosenProvider && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={anyLoginLoading}
              onClick={() => { resetDeviceState(); setChosenProvider(p.id) }}
              className={cn(
                "relative overflow-hidden rounded-xl border border-border bg-muted/30 p-4 text-left transition-all duration-200 hover:border-primary/50 hover:bg-muted/50",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              <div
                className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${p.color}20`, color: p.color }}
              >
                {p.id === "microsoft" ? <MicrosoftIcon className="h-6 w-6" />
                  : p.id === "elyby" ? <ElyByIcon className="h-6 w-6" />
                  : <XnSkinsIcon className="h-6 w-6" />}
              </div>
              <div className="font-medium text-foreground">{p.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{p.description}</div>
            </button>
          ))}

          <button
            type="button"
            onClick={onOpenOffline}
            className={cn(
              "relative overflow-hidden rounded-xl border border-border bg-muted/30 p-4 text-left transition-all duration-200 hover:border-primary/50 hover:bg-muted/50"
            )}
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ backgroundColor: "#75757520", color: "#757575" }}>
              <IconUserMinus className="h-6 w-6" />
            </div>
            <div className="font-medium text-foreground">{copy.accountOfflineTitle}</div>
            <div className="mt-1 text-sm text-muted-foreground">{copy.accountOfflinePlaceholder}</div>
          </button>
        </div>
      )}

      {chosenProvider && provider && !deviceCodeInfo && (
        <div className="rounded-2xl border border-border bg-card/50 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { resetDeviceState(); setChosenProvider(null) }}
              disabled={authLoading}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <IconArrowLeft className="h-4 w-4" />
            </button>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${provider.color}20`, color: provider.color }}
            >
              {provider.id === "microsoft" ? <MicrosoftIcon className="h-5 w-5" />
                : provider.id === "elyby" ? <ElyByIcon className="h-5 w-5" />
                : <XnSkinsIcon className="h-5 w-5" />}
            </div>
            <div>
              <div className="font-medium text-foreground">{provider.title}</div>
              <div className="text-xs text-muted-foreground">Выберите способ входа</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => { resetDeviceState(); onProviderLogin(chosenProvider) }}
              disabled={authLoading}
              className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${provider.color}20`, color: provider.color }}
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="12" cy="15" r="1.4" fill="currentColor" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-foreground">OAuth2</div>
                <div className="text-sm text-muted-foreground mt-1">{provider.methodOAuthDesc}</div>
              </div>
            </button>

            <button
              onClick={() => void handleStartDeviceCode(chosenProvider)}
              disabled={authLoading}
              className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${provider.color}20`, color: provider.color }}
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M14 14h4v4h-4z" fill="currentColor" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-foreground">Device Code</div>
                <div className="text-sm text-muted-foreground mt-1">{provider.methodDeviceDesc}</div>
              </div>
              {authLoading && <IconLoader2 className="ml-auto h-5 w-5 animate-spin text-primary" />}
            </button>
          </div>

          {authError && (
            <p className="text-sm text-destructive text-center">{authError}</p>
          )}
        </div>
      )}

      {chosenProvider && deviceCodeInfo && provider && (
        <div className="rounded-2xl border border-border bg-card/50 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { resetDeviceState(); setChosenProvider(null) }}
              disabled={devicePolling}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <IconArrowLeft className="h-4 w-4" />
            </button>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${provider.color}20`, color: provider.color }}
            >
              {provider.id === "microsoft" ? <MicrosoftIcon className="h-5 w-5" />
                : provider.id === "elyby" ? <ElyByIcon className="h-5 w-5" />
                : <XnSkinsIcon className="h-5 w-5" />}
            </div>
            <div>
              <div className="font-medium text-foreground">{provider.title}</div>
              <div className="text-xs text-muted-foreground">Device Code</div>
            </div>
          </div>

          {deviceStatus === "waiting" && (
            <div className="text-center space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-3">Перейдите по ссылке и введите код:</p>
                <a
                  href={deviceCodeInfo.verificationUriComplete}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  Открыть страницу входа →
                </a>
              </div>

              <button
                type="button"
                onClick={() => handleCopyCode(deviceCodeInfo.userCode)}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 px-6 py-3 transition-all hover:border-primary hover:bg-primary/10"
              >
                <span className="text-2xl font-mono font-bold tracking-[0.3em] text-foreground">
                  {deviceCodeInfo.userCode}
                </span>
                <span className="text-xs text-muted-foreground">{copied ? "Скопировано!" : "Нажмите чтобы скопировать"}</span>
              </button>

              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                Ожидание подтверждения...
              </div>
            </div>
          )}

          {deviceStatus === "expired" && (
            <div className="text-center space-y-3">
              <p className="text-sm text-destructive">{authError || "Срок действия кода истёк. Запросите новый код."}</p>
              <button
                onClick={() => void handleStartDeviceCode(chosenProvider)}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors"
              >
                Запросить новый код
              </button>
            </div>
          )}

          {deviceStatus === "done" && (
            <div className="flex items-center justify-center gap-2 text-sm text-primary">
              <IconCheck className="h-4 w-4" />
              Вход выполнен!
            </div>
          )}
        </div>
      )}

      {accounts.length > 0 && (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className={cn(
                "flex items-center gap-4 rounded-xl border p-4 transition-all duration-200",
                account.isActive
                  ? "border-primary bg-primary/10 shadow-[0_0_15px_var(--glow-primary)]"
                  : "border-border bg-muted/30 hover:border-primary/50"
              )}
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                <CachedAvatar src={getAvatarUrl(account, account.username)} alt="" className="h-full w-full object-cover" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{account.username}</span>
                  {account.isActive && (
                    <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                      {copy.accountSelected}
                    </span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">{account.type}</span>
              </div>

              {!account.isActive && (
                <button
                  type="button"
                  onClick={() => setActiveAccount(account.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
                >
                  <IconCheck className="h-4 w-4" strokeWidth={1.75} />
                  {copy.accountSelect}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
