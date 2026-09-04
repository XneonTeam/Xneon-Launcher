import { useState, useEffect, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {   IconUser, IconPuzzle, IconUserMinus, IconLoader2, IconCirclePlus, IconTrash, IconX, IconCheck, IconLogin, IconArrowLeft, IconPlus, IconBrandWindows, IconChevronUp, IconChevronDown, IconExternalLink, IconRefresh, IconCopy } from "@tabler/icons-react"
import { Checkbox } from "@/components/ui/checkbox"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { useAccounts } from "@/src/AccountsContext"
import { cn } from "@/lib/utils"

type AccountWithAvatar = { uuid?: string; type?: string }

export const getAvatarUrl = (account: AccountWithAvatar, username: string) => {  const isElyBy = account.type === "elyby"
  const value = isElyBy ? username : (account.uuid || username)
  const params = new URLSearchParams()

  if (isElyBy) {
    params.set("skin_type", "ely")
  } else if (account.type === "xnskins") {
    params.set("skin_type", "xneon")
  } else if (account.type === "microsoft") {
    params.set("skin_type", "microsoft")
  } else if (account.type === "offline") {
    return `https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft`
  }

  if (params.has("skin_type")) {
    return `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}?${params.toString()}`
  }
  return `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}`
}

type AccountType = "elyby" | "xnskins" | "microsoft" | "offline"
type DisplayAccountType = AccountType

export type { AccountType }

export const getAccountTypeInfo = (t: (k: string) => string): Record<DisplayAccountType, { name: string; description: string; color: string }> => ({
  elyby: { name: t("accounts.elyBy"), description: t("accounts.elyByDesc"), color: "#217e5c" },
  xnskins: { name: t("accounts.xneonSkins"), description: t("accounts.xneonSkinsDesc"), color: "#f97316" },
  microsoft: { name: t("accounts.microsoft"), description: t("accounts.microsoftDesc"), color: "#2563EB" },
  offline: { name: t("accounts.offline"), description: t("accounts.offlineDesc"), color: "#757575" },
})

const getAccountIcon = (type: DisplayAccountType) => {
  switch (type) {
    case "elyby":
      return (
        <svg className="w-6 h-6" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg">
          <path fill="currentColor" d="M262 207.5V351h-37V64h37zM193.5 98v14.5H86V197h93v30H86v94l54.3.2 54.2.3v29l-72.7.3-72.8.2V83l72.3.2 72.2.3zm135.9 55.7c.3 1 7.3 31.7 15.6 68.3 8.4 36.6 15.5 67.3 15.8 68.3.4 1 7.8-26.8 18.2-68.3l17.5-70h20.2c12.5 0 20.3.4 20.3 1 0 .5-6.3 22.9-14 49.7-7.8 26.9-22.4 77.8-32.6 113.3s-19.5 67.2-20.6 70.5c-4.4 12.9-13.6 28.5-20.1 34.2-8.6 7.6-23 11.4-35.5 9.4-8.9-1.5-13.3-2.5-13.4-3.1-.1-.3.7-6.7 1.7-14.3l1.9-13.7 6.2.6c16.6 1.7 21-3.3 30.9-35.2l4.7-15.2-5.1-16.8c-2.7-9.3-10.4-35.6-17.1-58.4-19.1-65.1-35-119.4-35.5-120.8-.3-.9 4.1-1.2 20-1.2 18.5 0 20.4.2 20.9 1.7"/>
        </svg>
      )
    case "xnskins":
      return (
        <svg className="w-6 h-6" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
          <path d="M 121.270 53.270 L 93 81.539 93 86.387 C 93 90.685, 93.440 91.676, 96.882 95.118 C 100.594 98.829, 102.357 99.451, 108 99.039 C 109.813 98.907, 117.168 92.210, 134.750 74.686 L 159 50.515 159 88.493 L 159 126.471 146.236 113.736 L 133.472 101 126.244 101 L 119.016 101 111.008 108.754 L 103 116.508 103 126.876 C 103 138.904, 103.732 138.905, 92.871 126.857 L 85.778 118.988 89.363 115.019 C 93.760 110.153, 94.655 106.955, 92.869 102.487 C 92.037 100.404, 80.782 88.072, 64.162 71.030 L 36.823 43 19.709 43 L 2.595 43 16.024 56.750 C 35.123 76.307, 55.993 97.939, 59.465 101.779 L 62.430 105.058 33.215 134.285 C 17.147 150.360, 4 163.847, 4 164.256 C 4 164.665, 11.982 165, 21.739 165 L 39.477 165 55.296 149.250 L 71.114 133.500 86.307 149.285 L 101.500 165.071 109.827 165.035 C 117.581 165.002, 118.346 164.808, 120.939 162.215 C 123.315 159.838, 123.831 158.300, 124.445 151.746 C 124.841 147.520, 124.845 139.549, 124.454 134.031 C 124.062 128.514, 123.997 124, 124.308 124 C 124.619 124, 133.974 133.225, 145.097 144.500 L 165.320 165 171.144 165 C 176.166 165, 177.418 164.598, 180.234 162.083 L 183.500 159.165 183.774 103.301 L 184.048 47.437 172.678 36.218 L 161.307 25 155.423 25 L 149.539 25 121.270 53.270" stroke="none" fill="#f97316"/>
        </svg>
      )
case "microsoft":
      return (
        <svg className="w-6 h-6" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
          <path fill="#0078d4" d="M67.328 67.331h60.669V128H67.328zm-67.325 0h60.669V128H.003zM67.328 0h60.669v60.669H67.328zM.003 0h60.669v60.669H.003z"/>
        </svg>
      )
    case "offline":
      return (
        <IconUserMinus className="w-6 h-6" />
      )
    default:
      return null
  }
}


export function AccountsPage() {
  const { t } = useTranslation()
  const accountTypeInfo = getAccountTypeInfo(t)
  const { accounts, addAccount, removeAccount, setActiveAccount, moveAccount } = useAccounts()
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedAccountType, setSelectedAccountType] = useState<AccountType | null>(null)
  const [offlineUsername, setOfflineUsername] = useState("")
  const [allowInvalidUsername, setAllowInvalidUsername] = useState(false)
  const [elybyAuthLoading, setElybyAuthLoading] = useState(false)
  const [xnskinsAuthLoading, setXnSkinsAuthLoading] = useState(false)
  const [microsoftAuthLoading, setMicrosoftAuthLoading] = useState(false)
  const [authProgressMessage, setAuthProgressMessage] = useState("")
  const [authError, setAuthError] = useState("")
  const [microsoftMethod, setMicrosoftMethod] = useState<"choose" | "oauth" | "device">("choose")
  const [elybyMethod, setElybyMethod] = useState<"choose" | "oauth" | "device">("choose")
  const [xnskinsMethod, setXnskinsMethod] = useState<"choose" | "oauth" | "device">("choose")
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
    const unsubscribe = window.electronAPI?.onAuthProgress?.((msg) => {
      setAuthProgressMessage(msg)
    })
    cleanupRef.current = () => unsubscribe?.()
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const handleElyByLogin = useCallback(async () => {
    setElybyAuthLoading(true)
    setAuthError("")
    try {
      const result = await window.electronAPI?.loginElyBy()
      if (result) {
        addAccount({
          id: result.id,
          type: "elyby",
          username: result.username,
          uuid: result.uuid,
          accessToken: result.accessToken,
          isActive: accounts.length === 0,
        })
        setSelectedAccountType(null)
        setShowAddModal(false)
      }
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : t("accounts.unknownError")
      if (message === "Авторизация отменена" || message.includes("отменена")) {
        message = t("accounts.canceled")
      }
      setAuthError(message)
    } finally {
      setElybyAuthLoading(false)
    }
  }, [addAccount, accounts.length])

  const handleEnableElyDeviceCode = useCallback(async () => {
    setElybyAuthLoading(true)
    setAuthError("")
    setDeviceStatus("waiting")
    setDeviceCodeInfo(null)
    setElybyMethod("device")
    try {
      const info = await window.electronAPI?.startElyByDeviceCode()
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
      setAuthError(err instanceof Error ? err.message : t("accounts.unknownError"))
      setElybyMethod("device")
    } finally {
      setElybyAuthLoading(false)
    }
  }, [t])

  const finishElyDeviceLogin = useCallback((result: { id: string; username: string; uuid?: string; accessToken: string; refreshToken?: string }) => {
    addAccount({
      id: result.id,
      type: "elyby",
      username: result.username,
      uuid: result.uuid,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      isActive: accounts.length === 0,
    })
    setDeviceStatus("done")
    setDevicePolling(false)
    setDeviceCodeInfo(null)
    setElybyMethod("choose")
    setSelectedAccountType(null)
    setShowAddModal(false)
  }, [addAccount, accounts.length])

  const handleXnSkinsLogin = useCallback(async () => {
    setXnSkinsAuthLoading(true)
    setAuthError("")
    try {
      const result = await window.electronAPI?.loginXnSkins()
      if (result) {
        addAccount({
          id: result.id,
          type: "xnskins",
          username: result.username,
          uuid: result.uuid,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          isActive: accounts.length === 0,
        })
        setSelectedAccountType(null)
        setShowAddModal(false)
      }
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : t("accounts.unknownError")
      if (message === "Авторизация отменена" || message.includes("отменена")) {
        message = t("accounts.canceled")
      }
      setAuthError(message)
    } finally {
      setXnSkinsAuthLoading(false)
    }
  }, [addAccount, accounts.length])

  const handleEnableXnSkinsDeviceCode = useCallback(async () => {
    setXnSkinsAuthLoading(true)
    setAuthError("")
    setDeviceStatus("waiting")
    setDeviceCodeInfo(null)
    setXnskinsMethod("device")
    try {
      const info = await window.electronAPI?.startXnSkinsDeviceCode()
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
      setAuthError(err instanceof Error ? err.message : t("accounts.unknownError"))
      setXnskinsMethod("device")
    } finally {
      setXnSkinsAuthLoading(false)
    }
  }, [t])

  const finishXnSkinsDeviceLogin = useCallback((result: { id: string; username: string; uuid?: string; accessToken: string; refreshToken?: string }) => {
    addAccount({
      id: result.id,
      type: "xnskins",
      username: result.username,
      uuid: result.uuid,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      isActive: accounts.length === 0,
    })
    setDeviceStatus("done")
    setDevicePolling(false)
    setDeviceCodeInfo(null)
    setXnskinsMethod("choose")
    setSelectedAccountType(null)
    setShowAddModal(false)
  }, [addAccount, accounts.length])

  const handleMicrosoftLogin = useCallback(async () => {
    setMicrosoftAuthLoading(true)
    setAuthError("")
    try {
      const result = await window.electronAPI?.loginMicrosoft()
      if (result) {
        addAccount({
          id: result.id,
          type: "microsoft",
          username: result.username,
          uuid: result.uuid,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          isActive: accounts.length === 0,
        })
        setSelectedAccountType(null)
        setShowAddModal(false)
      }
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : t("accounts.unknownError")
      if (message === "Авторизация отменена" || message.includes("отменена")) {
        message = t("accounts.canceled")
      }
      setAuthError(message)
    } finally {
      setMicrosoftAuthLoading(false)
    }
  }, [addAccount, accounts.length])

  const handleEnableDeviceCode = useCallback(async () => {
    setMicrosoftAuthLoading(true)
    setAuthError("")
    setDeviceStatus("waiting")
    setDeviceCodeInfo(null)
    setMicrosoftMethod("device")
    try {
      const info = await window.electronAPI?.startMicrosoftDeviceCode()
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
      setAuthError(err instanceof Error ? err.message : t("accounts.unknownError"))
      setMicrosoftMethod("device")
    } finally {
      setMicrosoftAuthLoading(false)
    }
  }, [t])

  const finishDeviceLogin = useCallback((result: { id: string; username: string; uuid?: string; accessToken: string; refreshToken?: string }) => {
    addAccount({
      id: result.id,
      type: "microsoft",
      username: result.username,
      uuid: result.uuid,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      isActive: accounts.length === 0,
    })
    setDeviceStatus("done")
    setDevicePolling(false)
    setDeviceCodeInfo(null)
    setMicrosoftMethod("choose")
    setSelectedAccountType(null)
    setShowAddModal(false)
  }, [addAccount, accounts.length])

  useEffect(() => {
    if (!deviceCodeInfo || !devicePolling || deviceStatus !== "waiting") return

    const activeMethod = selectedAccountType === "elyby" ? "elyby" : selectedAccountType === "xnskins" ? "xnskins" : "microsoft"
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled) return
      try {
        const result = activeMethod === "elyby"
          ? await window.electronAPI?.pollElyByDeviceCode(deviceCodeInfo.deviceCode)
          : activeMethod === "xnskins"
            ? await window.electronAPI?.pollXnSkinsDeviceCode(deviceCodeInfo.deviceCode)
            : await window.electronAPI?.pollMicrosoftDeviceCode(deviceCodeInfo.deviceCode)
        if (cancelled) return
        if (!result) return
        if (result.status === "complete" && result.account) {
          if (activeMethod === "elyby") finishElyDeviceLogin(result.account)
          else if (activeMethod === "xnskins") finishXnSkinsDeviceLogin(result.account)
          else finishDeviceLogin(result.account)
          return
        }
        if (result.status === "expired") {
          setDevicePolling(false)
          setDeviceStatus("expired")
          setAuthError(t("accounts.deviceExpired"))
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
        setAuthError(err instanceof Error ? err.message : t("accounts.unknownError"))
        pollTimer = setTimeout(poll, deviceCodeInfo.interval * 1000)
      }
    }

    pollTimer = setTimeout(poll, deviceCodeInfo.interval * 1000)
    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [deviceCodeInfo, devicePolling, deviceStatus, selectedAccountType, finishDeviceLogin, finishElyDeviceLogin, finishXnSkinsDeviceLogin, t])

  const handleAddOfflineAccount = () => {
    const username = offlineUsername.trim()
    if (!username) return
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username) && !allowInvalidUsername) {
      setAuthError(t("accounts.offlineInvalidHint"))
      return
    }
    addAccount({
      id: Date.now().toString(),
      type: "offline",
      username,
      isActive: accounts.length === 0,
    })
    setOfflineUsername("")
    setAllowInvalidUsername(false)
    setSelectedAccountType(null)
    setShowAddModal(false)
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-card border border-border">
        <div className="absolute -top-32 -right-32 w-64 h-64 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />

        <div className="relative z-10 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-foreground">{t("accounts.title")}</h2>
            <button
              onClick={() => { setShowAddModal(true); setAuthError("") }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all duration-200 shadow-[0_0_15px_var(--glow-primary)]"
            >
              <IconCirclePlus className="w-5 h-5" />
              {t("accounts.addAccount")}
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <IconUser className="w-10 h-10 text-muted-foreground" />
              </div>
              <p className="text-lg text-muted-foreground">{t("accounts.noAccounts")}</p>
              <p className="text-sm text-muted-foreground/70 mt-1">{t("accounts.noAccountsDesc")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border transition-all duration-200",
                    account.isActive
                      ? "border-primary bg-primary/10 shadow-[0_0_15px_var(--glow-primary)]"
                      : "border-border bg-muted/30 hover:border-primary/50"
                  )}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{ backgroundColor: `${accountTypeInfo[account.type].color}20` }}
                  >
                    <CachedAvatar src={getAvatarUrl(account, account.username)} alt="" className="w-full h-full object-cover" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{account.username}</span>
                      {account.isActive && (
                        <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium flex-shrink-0">
                          {t("accounts.active")}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">{accountTypeInfo[account.type].name}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveAccount(account.id, -1)}
                        disabled={accounts.findIndex(a => a.id === account.id) === 0}
                        title={t("accounts.moveUp")}
                        className="w-7 h-6 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <IconChevronUp className="w-4 h-4" strokeWidth={1.75} />
                      </button>
                      <button
                        onClick={() => moveAccount(account.id, 1)}
                        disabled={accounts.findIndex(a => a.id === account.id) === accounts.length - 1}
                        title={t("accounts.moveDown")}
                        className="w-7 h-6 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <IconChevronDown className="w-4 h-4" strokeWidth={1.75} />
                      </button>
                    </div>
                    {!account.isActive && (
                      <button
                        onClick={() => setActiveAccount(account.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm"
                      >
                        <IconCheck className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.select")}
                      </button>
                    )}
                    <button
                      onClick={() => removeAccount(account.id)}
                      className="w-9 h-9 rounded-lg bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors flex items-center justify-center"
                    >
                      <IconTrash className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAddModal && !selectedAccountType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-lg mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">{t("accounts.addAccount")}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {(["elyby", "xnskins", "microsoft", "offline"] as AccountType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => { 
                    setAuthError("")
                    if (type === "microsoft") {
                      setMicrosoftMethod("choose")
                      setDeviceCodeInfo(null)
                      setDevicePolling(false)
                      setDeviceStatus("waiting")
                    }
                    if (type === "elyby") {
                      setElybyMethod("choose")
                      setDeviceCodeInfo(null)
                      setDevicePolling(false)
                      setDeviceStatus("waiting")
                    }
                    if (type === "xnskins") {
                      setXnskinsMethod("choose")
                      setDeviceCodeInfo(null)
                      setDevicePolling(false)
                      setDeviceStatus("waiting")
                    }
                    setSelectedAccountType(type) 
                  }}
                  className={cn(
                    "p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50 transition-all text-left",
                    type === "elyby" && "hover:border-emerald-500/60",
                    type === "xnskins" && "hover:border-orange-500/60",
                    type === "microsoft" && "hover:border-blue-500/60",
                  )}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                    style={{ backgroundColor: `${accountTypeInfo[type].color}20` }}
                  >
                    <div style={{ color: accountTypeInfo[type].color }}>
                      {getAccountIcon(type)}
                    </div>
                  </div>
                  <div className="font-medium text-foreground">{accountTypeInfo[type].name}</div>
                  <div className="text-sm text-muted-foreground mt-1">{accountTypeInfo[type].description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAddModal && selectedAccountType === "offline" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">{t("accounts.offline")} {t("accounts.title").toLowerCase()}</h3>
              <button
                onClick={() => { setSelectedAccountType(null); setShowAddModal(false) }}
                className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("accounts.nickname")}</label>
                <input
                  type="text"
                  value={offlineUsername}
                  onChange={(e) => setOfflineUsername(e.target.value)}
                  placeholder={t("accounts.enterNickname")}
                  className="w-full px-4 py-3 rounded-xl bg-input border border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleAddOfflineAccount()}
                />
                {!allowInvalidUsername && offlineUsername.trim() && !/^[A-Za-z0-9_]{3,16}$/.test(offlineUsername.trim()) && (
                  <p className="text-xs text-destructive">{t("accounts.offlineInvalidHint")}</p>
                )}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={allowInvalidUsername}
                  onCheckedChange={(v) => setAllowInvalidUsername(!!v)}
                />
                {t("accounts.offlineAllowInvalid")}
              </label>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setSelectedAccountType(null)}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                >
                <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                {t("accounts.back")}
              </button>
                <button
                  onClick={handleAddOfflineAccount}
                  disabled={!offlineUsername.trim() || (!allowInvalidUsername && !/^[A-Za-z0-9_]{3,16}$/.test(offlineUsername.trim()))}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <IconPlus className="w-4 h-4" strokeWidth={1.75} />
                  {t("accounts.addAccount")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && selectedAccountType === "elyby" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">{t("accounts.loginTitle.elyby")}</h3>
              <button
                onClick={() => {
                  setElybyAuthLoading(false)
                  setElybyMethod("choose")
                  setDeviceCodeInfo(null)
                  setDevicePolling(false)
                  setDeviceStatus("waiting")
                  setSelectedAccountType(null)
                }}
                disabled={elybyAuthLoading || devicePolling}
                className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center py-6">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `${accountTypeInfo.elyby.color}20` }}
              >
                <div style={{ color: accountTypeInfo.elyby.color }}>
                  {getAccountIcon("elyby")}
                </div>
              </div>
            </div>

            {elybyMethod === "choose" && (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => setElybyMethod("oauth")}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-emerald-500/60 hover:bg-muted/50 transition-all text-left"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${accountTypeInfo.elyby.color}20`, color: accountTypeInfo.elyby.color }}
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                        <circle cx="12" cy="15" r="1.4" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t("accounts.microsoftMethodOAuth")}</div>
                      <div className="text-sm text-muted-foreground mt-1">{t("accounts.elyMethodOAuthDesc")}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => void handleEnableElyDeviceCode()}
                    disabled={elybyAuthLoading}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-emerald-500/60 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${accountTypeInfo.elyby.color}20`, color: accountTypeInfo.elyby.color }}
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M14 14h4v4h-4z" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t("accounts.microsoftMethodDevice")}</div>
                      <div className="text-sm text-muted-foreground mt-1">{t("accounts.elyMethodDeviceDesc")}</div>
                    </div>
                  </button>
                </div>
                <div className="flex gap-3 mt-5">
                  <button
                    onClick={() => {
                      setElybyMethod("choose")
                      setSelectedAccountType(null)
                    }}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back")}
                  </button>
                </div>
              </>
            )}

            {elybyMethod === "oauth" && (
              <>
                <div className="text-center mb-4">
                  {elybyAuthLoading ? (
                    <div>
                      <IconLoader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                      <p className="text-sm text-muted-foreground">{t("accounts.connectElyBy")}</p>
                    </div>
                  ) : authError ? (
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p className="text-sm text-destructive-foreground">{authError}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("accounts.connectElyByDesc")}
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setElybyAuthLoading(false)
                      setElybyMethod("choose")
                    }}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back")}
                  </button>
                  {!elybyAuthLoading && (
                    <button
                      onClick={handleElyByLogin}
                      className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] text-white font-medium transition-colors"
                    >
                      <IconLogin className="w-4 h-4" strokeWidth={1.75} />
                      {t("accounts.login")}
                    </button>
                  )}
                </div>
              </>
            )}

            {elybyMethod === "device" && (
              <>
                {!deviceCodeInfo ? (
                  <div>
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <IconLoader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
                      <p className="text-sm text-muted-foreground">{t("accounts.generatingDeviceCode")}</p>
                    </div>
                    {authError && !devicePolling && (
                      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                        <p className="text-sm text-destructive-foreground">{authError}</p>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setElybyAuthLoading(false)
                          setElybyMethod("choose")
                        }}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      {!elybyAuthLoading && !deviceCodeInfo && authError && (
                        <button
                          onClick={handleEnableElyDeviceCode}
                          className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] text-white font-medium transition-colors"
                        >
                          <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.restartDeviceCode")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : deviceStatus === "expired" ? (
                  <div>
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                      <p className="text-sm text-destructive-foreground">{t("accounts.deviceExpired")}</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setElybyMethod("choose")}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      <button
                        onClick={handleEnableElyDeviceCode}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] text-white font-medium transition-colors"
                      >
                        <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.restartDeviceCode")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-5 rounded-2xl bg-muted/40 border border-border">
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-2">{t("accounts.enterCodeAtLink")}</p>
                        <button
                          onClick={() => window.electronAPI?.openExternal(deviceCodeInfo.verificationUriComplete)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] text-white text-sm font-medium transition-colors"
                        >
                          <IconExternalLink className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.openDeviceCodeLink")}
                        </button>
                        <div className="my-4 text-xs uppercase tracking-widest text-muted-foreground/70">{t("accounts.enterCodeLabel")}</div>
                        <div className="flex items-center gap-2">
                          <div
                            className="text-3xl font-bold tracking-[0.35em] text-foreground select-all flex-1 px-3 py-2 rounded-xl border border-border bg-background"
                            style={{ color: "#217e5c" }}
                          >
                            {deviceCodeInfo.userCode}
                          </div>
                          <button
                            onClick={() => handleCopyCode(deviceCodeInfo.userCode)}
                            className="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            title={t("accounts.clickToCopy")}
                          >
                            {copied
                              ? <IconCheck className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                              : <IconCopy className="w-4 h-4" strokeWidth={1.75} />}
                          </button>
                        </div>
                        {devicePolling && (
                          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
                            <IconLoader2 className="w-4 h-4 animate-spin text-primary" />
                            {authError || t("accounts.deviceWaiting")}
                          </div>
                        )}
                        {!devicePolling && authError && (
                          <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                            <p className="text-sm text-destructive-foreground">{authError}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setDevicePolling(false)
                          setDeviceStatus("waiting")
                          setDeviceCodeInfo(null)
                          setAuthError("")
                          setElybyMethod("choose")
                        }}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showAddModal && selectedAccountType === "xnskins" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">{t("accounts.loginTitle.xnskins")}</h3>
              <button
                onClick={() => {
                  setXnSkinsAuthLoading(false)
                  setXnskinsMethod("choose")
                  setDeviceCodeInfo(null)
                  setDevicePolling(false)
                  setDeviceStatus("waiting")
                  setSelectedAccountType(null)
                }}
                disabled={xnskinsAuthLoading || devicePolling}
                className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center py-6">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `${accountTypeInfo.xnskins.color}20` }}
              >
                <div style={{ color: accountTypeInfo.xnskins.color }}>
                  {getAccountIcon("xnskins")}
                </div>
              </div>
            </div>

            {xnskinsMethod === "choose" && (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => setXnskinsMethod("oauth")}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-orange-500/60 hover:bg-muted/50 transition-all text-left"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${accountTypeInfo.xnskins.color}20`, color: accountTypeInfo.xnskins.color }}
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                        <circle cx="12" cy="15" r="1.4" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t("accounts.microsoftMethodOAuth")}</div>
                      <div className="text-sm text-muted-foreground mt-1">{t("accounts.connectXnSkinsDesc")}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => void handleEnableXnSkinsDeviceCode()}
                    disabled={xnskinsAuthLoading}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-orange-500/60 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${accountTypeInfo.xnskins.color}20`, color: accountTypeInfo.xnskins.color }}
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M14 14h4v4h-4z" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t("accounts.microsoftMethodDevice")}</div>
                      <div className="text-sm text-muted-foreground mt-1">{t("accounts.xnskinsMethodDeviceDesc")}</div>
                    </div>
                  </button>
                </div>
                <div className="flex gap-3 mt-5">
                  <button
                    onClick={() => {
                      setXnskinsMethod("choose")
                      setSelectedAccountType(null)
                    }}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back")}
                  </button>
                </div>
              </>
            )}

            {xnskinsMethod === "oauth" && (
              <>
                <div className="text-center mb-4">
                  {xnskinsAuthLoading ? (
                    <div>
                      <IconLoader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                      <p className="text-sm text-muted-foreground">{t("accounts.connectXnSkins")}</p>
                    </div>
                  ) : authError ? (
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p className="text-sm text-destructive-foreground">{authError}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("accounts.connectXnSkinsDesc")}
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setXnSkinsAuthLoading(false)
                      setXnskinsMethod("choose")
                    }}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back")}
                  </button>
                  {!xnskinsAuthLoading && (
                    <button
                      onClick={handleXnSkinsLogin}
                      className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#f97316] hover:bg-[#ea580c] text-white font-medium transition-colors"
                    >
                      <IconLogin className="w-4 h-4" strokeWidth={1.75} />
                      {t("accounts.login")}
                    </button>
                  )}
                </div>
              </>
            )}

            {xnskinsMethod === "device" && (
              <>
                {!deviceCodeInfo ? (
                  <div>
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <IconLoader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
                      <p className="text-sm text-muted-foreground">{t("accounts.generatingDeviceCode")}</p>
                    </div>
                    {authError && !devicePolling && (
                      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                        <p className="text-sm text-destructive-foreground">{authError}</p>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setXnSkinsAuthLoading(false)
                          setXnskinsMethod("choose")
                        }}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      {!xnskinsAuthLoading && !deviceCodeInfo && authError && (
                        <button
                          onClick={handleEnableXnSkinsDeviceCode}
                          className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#f97316] hover:bg-[#ea580c] text-white font-medium transition-colors"
                        >
                          <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.restartDeviceCode")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : deviceStatus === "expired" ? (
                  <div>
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                      <p className="text-sm text-destructive-foreground">{t("accounts.deviceExpired")}</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setXnskinsMethod("choose")}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      <button
                        onClick={handleEnableXnSkinsDeviceCode}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#f97316] hover:bg-[#ea580c] text-white font-medium transition-colors"
                      >
                        <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.restartDeviceCode")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-5 rounded-2xl bg-muted/40 border border-border">
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-2">{t("accounts.enterCodeAtLink")}</p>
                        <button
                          onClick={() => window.electronAPI?.openExternal(deviceCodeInfo.verificationUriComplete)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#f97316] hover:bg-[#ea580c] text-white text-sm font-medium transition-colors"
                        >
                          <IconExternalLink className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.openDeviceCodeLink")}
                        </button>
                        <div className="my-4 text-xs uppercase tracking-widest text-muted-foreground/70">{t("accounts.enterCodeLabel")}</div>
                        <div className="flex items-center gap-2">
                          <div
                            className="text-3xl font-bold tracking-[0.35em] text-foreground select-all flex-1 px-3 py-2 rounded-xl border border-border bg-background"
                            style={{ color: "#f97316" }}
                          >
                            {deviceCodeInfo.userCode}
                          </div>
                          <button
                            onClick={() => handleCopyCode(deviceCodeInfo.userCode)}
                            className="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            title={t("accounts.clickToCopy")}
                          >
                            {copied
                              ? <IconCheck className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                              : <IconCopy className="w-4 h-4" strokeWidth={1.75} />}
                          </button>
                        </div>
                        {devicePolling && (
                          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
                            <IconLoader2 className="w-4 h-4 animate-spin text-primary" />
                            {authError || t("accounts.deviceWaiting")}
                          </div>
                        )}
                        {!devicePolling && authError && (
                          <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                            <p className="text-sm text-destructive-foreground">{authError}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setDevicePolling(false)
                          setDeviceStatus("waiting")
                          setDeviceCodeInfo(null)
                          setAuthError("")
                          setXnskinsMethod("choose")
                        }}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showAddModal && selectedAccountType === "microsoft" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">{t("accounts.loginTitle.microsoft")}</h3>
              <button
                onClick={() => {
                  setMicrosoftAuthLoading(false)
                  setMicrosoftMethod("choose")
                  setDeviceCodeInfo(null)
                  setDevicePolling(false)
                  setDeviceStatus("waiting")
                  setSelectedAccountType(null)
                }}
                disabled={microsoftAuthLoading || devicePolling}
                className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center py-6">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `${accountTypeInfo.microsoft.color}20` }}
              >
                <div style={{ color: accountTypeInfo.microsoft.color }}>
                  {getAccountIcon("microsoft")}
                </div>
              </div>
            </div>

            {microsoftMethod === "choose" && (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => setMicrosoftMethod("oauth")}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-blue-500/60 hover:bg-muted/50 transition-all text-left"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${accountTypeInfo.microsoft.color}20`, color: accountTypeInfo.microsoft.color }}
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                        <circle cx="12" cy="15" r="1.4" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t("accounts.microsoftMethodOAuth")}</div>
                      <div className="text-sm text-muted-foreground mt-1">{t("accounts.microsoftMethodOAuthDesc")}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => void handleEnableDeviceCode()}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-blue-500/60 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
                    disabled={microsoftAuthLoading}
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${accountTypeInfo.microsoft.color}20`, color: accountTypeInfo.microsoft.color }}
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M14 14h4v4h-4z" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t("accounts.microsoftMethodDevice")}</div>
                      <div className="text-sm text-muted-foreground mt-1">{t("accounts.microsoftMethodDeviceDesc")}</div>
                    </div>
                  </button>
                </div>
                <div className="flex gap-3 mt-5">
                  <button
                    onClick={() => {
                      setMicrosoftMethod("choose")
                      setSelectedAccountType(null)
                    }}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back")}
                  </button>
                </div>
              </>
            )}

            {microsoftMethod === "oauth" && (
              <>
                <div className="text-center mb-4">
                  {microsoftAuthLoading ? (
                    <div>
                      <IconLoader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                      <p className="text-sm text-muted-foreground">{t("accounts.connectMicrosoft")}</p>
                    </div>
                  ) : authError ? (
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p className="text-sm text-destructive-foreground">{authError}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("accounts.connectMicrosoftDesc")}
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setMicrosoftAuthLoading(false)
                      setMicrosoftMethod("choose")
                    }}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back")}
                  </button>
                  {!microsoftAuthLoading && (
                    <button
                      onClick={handleMicrosoftLogin}
                      className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium transition-colors"
                    >
                      <IconLogin className="w-4 h-4" strokeWidth={1.75} />
                      {t("accounts.login")}
                    </button>
                  )}
                </div>
              </>
            )}

            {microsoftMethod === "device" && (
              <>
                {!deviceCodeInfo ? (
                  <div>
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <IconLoader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
                      <p className="text-sm text-muted-foreground">{t("accounts.generatingDeviceCode")}</p>
                    </div>
                    {authError && !devicePolling && (
                      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                        <p className="text-sm text-destructive-foreground">{authError}</p>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setMicrosoftAuthLoading(false)
                          setMicrosoftMethod("choose")
                        }}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      {!microsoftAuthLoading && !deviceCodeInfo && authError && (
                        <button
                          onClick={handleEnableDeviceCode}
                          className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium transition-colors"
                        >
                          <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.restartDeviceCode")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : deviceStatus === "expired" ? (
                  <div>
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                      <p className="text-sm text-destructive-foreground">{t("accounts.deviceExpired")}</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setMicrosoftMethod("choose")}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      <button
                        onClick={handleEnableDeviceCode}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium transition-colors"
                      >
                        <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.restartDeviceCode")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-5 rounded-2xl bg-muted/40 border border-border">
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-2">{t("accounts.enterCodeAtLink")}</p>
                        <button
                          onClick={() => window.electronAPI?.openExternal(deviceCodeInfo.verificationUriComplete)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium transition-colors"
                        >
                          <IconExternalLink className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.openDeviceCodeLink")}
                        </button>
                        <div className="my-4 text-xs uppercase tracking-widest text-muted-foreground/70">{t("accounts.enterCodeLabel")}</div>
                        <div className="flex items-center gap-2">
                          <div
                            className="text-3xl font-bold tracking-[0.35em] text-foreground select-all flex-1 px-3 py-2 rounded-xl border border-border bg-background"
                            style={{ color: "#2563EB" }}
                          >
                            {deviceCodeInfo.userCode}
                          </div>
                          <button
                            onClick={() => handleCopyCode(deviceCodeInfo.userCode)}
                            className="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            title={t("accounts.clickToCopy")}
                          >
                            {copied
                              ? <IconCheck className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                              : <IconCopy className="w-4 h-4" strokeWidth={1.75} />}
                          </button>
                        </div>
                        {devicePolling && (
                          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
                            <IconLoader2 className="w-4 h-4 animate-spin text-primary" />
                            {authError || t("accounts.deviceWaiting")}
                          </div>
                        )}
                        {!devicePolling && authError && (
                          <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                            <p className="text-sm text-destructive-foreground">{authError}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setDevicePolling(false)
                          setDeviceStatus("waiting")
                          setDeviceCodeInfo(null)
                          setAuthError("")
                          setMicrosoftMethod("choose")
                        }}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
