import { CONTENT_ENTER_DELAYED } from "./content-motion"
import { useState, useEffect, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {   IconUser, IconUserCircle, IconPuzzle, IconUserMinus, IconLoader2, IconCirclePlus, IconTrash, IconX, IconCheck, IconLogin, IconArrowLeft, IconPlus, IconBrandWindows, IconChevronUp, IconChevronDown, IconExternalLink, IconRefresh, IconCopy, IconHelpCircle, IconCoffee } from "@tabler/icons-react"
import { Checkbox } from "@/components/ui/checkbox"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { useAccounts } from "@/src/AccountsContext"
import { cn } from "@/lib/utils"
import { ModalLayer } from "@/components/ui/modal-layer"
import { AuthlibInjectorModal } from "@/components/launcher/accounts/authlib-injector-modal"

type AccountWithAvatar = { uuid?: string; type?: string; skinUrl?: string }

export const getAvatarUrl = (account: AccountWithAvatar, username: string, version?: number | string) => {
  if (account.type === "offline") return "avatar://head/Steve"
  const name = username || "Steve"
  const params = new URLSearchParams()
  if (account.type) params.set("type", account.type)
  if (account.uuid) params.set("uuid", account.uuid)
  if (account.skinUrl) params.set("skin_url", account.skinUrl)
  if (version !== undefined && version !== null && version !== "") {
    params.set("v", String(version))
  }
  const qs = params.toString() ? `?${params.toString()}` : ""
  return `avatar://head/${encodeURIComponent(name)}${qs}`
}

type AccountType = "elyby" | "xnskins" | "microsoft" | "offline" | "authlib-injector"
type DisplayAccountType = AccountType

export type { AccountType }

export const getAccountTypeInfo = (t: (k: string) => string): Record<DisplayAccountType, { name: string; description: string; color: string }> => ({
  elyby: { name: t("accounts.elyBy"), description: t("accounts.elyByDesc"), color: "var(--primary)" },
  xnskins: { name: t("accounts.xneonSkins"), description: t("accounts.xneonSkinsDesc"), color: "var(--primary)" },
  microsoft: { name: t("accounts.microsoft"), description: t("accounts.microsoftDesc"), color: "var(--primary)" },
  offline: { name: t("accounts.offline"), description: t("accounts.offlineDesc"), color: "var(--muted-foreground)" },
  "authlib-injector": { name: t("accounts.authlibInjector"), description: t("accounts.authlibInjectorDesc"), color: "var(--primary)" },
})

const getAccountIcon = (type: DisplayAccountType) => {
  switch (type) {
    case "authlib-injector":
      return <IconCoffee className="w-6 h-6" strokeWidth={1.8} />
    case "elyby":
      return (
        <svg data-ui="accounts-page-svg-1" data-icon="accounts-page-svg-1" className="w-6 h-6" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg">
          <path data-ui="accounts-page-path-1" fill="currentColor" d="M262 207.5V351h-37V64h37zM193.5 98v14.5H86V197h93v30H86v94l54.3.2 54.2.3v29l-72.7.3-72.8.2V83l72.3.2 72.2.3zm135.9 55.7c.3 1 7.3 31.7 15.6 68.3 8.4 36.6 15.5 67.3 15.8 68.3.4 1 7.8-26.8 18.2-68.3l17.5-70h20.2c12.5 0 20.3.4 20.3 1 0 .5-6.3 22.9-14 49.7-7.8 26.9-22.4 77.8-32.6 113.3s-19.5 67.2-20.6 70.5c-4.4 12.9-13.6 28.5-20.1 34.2-8.6 7.6-23 11.4-35.5 9.4-8.9-1.5-13.3-2.5-13.4-3.1-.1-.3.7-6.7 1.7-14.3l1.9-13.7 6.2.6c16.6 1.7 21-3.3 30.9-35.2l4.7-15.2-5.1-16.8c-2.7-9.3-10.4-35.6-17.1-58.4-19.1-65.1-35-119.4-35.5-120.8-.3-.9 4.1-1.2 20-1.2 18.5 0 20.4.2 20.9 1.7"/>
        </svg>
      )
    case "xnskins":
      return (
        <svg data-ui="accounts-page-svg-2" data-icon="accounts-page-svg-2" className="w-6 h-6" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
          <path data-ui="accounts-page-path-2" d="M 121.270 53.270 L 93 81.539 93 86.387 C 93 90.685, 93.440 91.676, 96.882 95.118 C 100.594 98.829, 102.357 99.451, 108 99.039 C 109.813 98.907, 117.168 92.210, 134.750 74.686 L 159 50.515 159 88.493 L 159 126.471 146.236 113.736 L 133.472 101 126.244 101 L 119.016 101 111.008 108.754 L 103 116.508 103 126.876 C 103 138.904, 103.732 138.905, 92.871 126.857 L 85.778 118.988 89.363 115.019 C 93.760 110.153, 94.655 106.955, 92.869 102.487 C 92.037 100.404, 80.782 88.072, 64.162 71.030 L 36.823 43 19.709 43 L 2.595 43 16.024 56.750 C 35.123 76.307, 55.993 97.939, 59.465 101.779 L 62.430 105.058 33.215 134.285 C 17.147 150.360, 4 163.847, 4 164.256 C 4 164.665, 11.982 165, 21.739 165 L 39.477 165 55.296 149.250 L 71.114 133.500 86.307 149.285 L 101.500 165.071 109.827 165.035 C 117.581 165.002, 118.346 164.808, 120.939 162.215 C 123.315 159.838, 123.831 158.300, 124.445 151.746 C 124.841 147.520, 124.845 139.549, 124.454 134.031 C 124.062 128.514, 123.997 124, 124.308 124 C 124.619 124, 133.974 133.225, 145.097 144.500 L 165.320 165 171.144 165 C 176.166 165, 177.418 164.598, 180.234 162.083 L 183.500 159.165 183.774 103.301 L 184.048 47.437 172.678 36.218 L 161.307 25 155.423 25 L 149.539 25 121.270 53.270" stroke="none" fill="currentColor"/>
        </svg>
      )
case "microsoft":
      return (
        <svg data-ui="accounts-page-svg-3" data-icon="accounts-page-svg-3" className="w-6 h-6" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
          <path data-ui="accounts-page-path-3" fill="currentColor" d="M67.328 67.331h60.669V128H67.328zm-67.325 0h60.669V128H.003zM67.328 0h60.669v60.669H67.328zM.003 0h60.669v60.669H.003z"/>
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
  const { accounts, addAccount, removeAccount, setActiveAccount, moveAccount, avatarVersion } = useAccounts()
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedAccountType, setSelectedAccountType] = useState<AccountType | null>(null)
  const [offlineUsername, setOfflineUsername] = useState("")
  const [allowInvalidUsername, setAllowInvalidUsername] = useState(false)
  const [elybyAuthLoading, setElybyAuthLoading] = useState(false)
  const [xnskinsAuthLoading, setXnSkinsAuthLoading] = useState(false)
  const [microsoftAuthLoading, setMicrosoftAuthLoading] = useState(false)
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

  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
          skinUrl: result.skinUrl,
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

  const finishDeviceLogin = useCallback((result: { id: string; username: string; uuid?: string; accessToken: string; refreshToken?: string; skinUrl?: string }) => {
    addAccount({
      id: result.id,
      type: "microsoft",
      username: result.username,
      uuid: result.uuid,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      skinUrl: result.skinUrl,
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
      {/* Нормальное окно раздела: без карточки, рамки и размытых пятен */}
      <div data-ui="accounts-page-div-1" data-component="accounts-page" id="accounts-page" className={`flex h-full min-h-0 flex-col ${CONTENT_ENTER_DELAYED}`}>
        <div data-ui="accounts-page-div-2" className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div data-ui="accounts-page-div-3" className="flex items-center justify-between mb-6">
            <div data-ui="accounts-page-div-4" className="flex items-center gap-3">
              {/* Значок у заголовка — как у остальных разделов лаунчера */}
              <div data-ui="accounts-page-div-5" className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <IconUserCircle className="w-5 h-5 text-primary" />
              </div>
              <div data-ui="accounts-page-div-6">
                <h2 data-ui="accounts-page-h2-1" className="text-xl font-bold text-foreground">{t("accounts.title")}</h2>
                <p data-ui="accounts-page-p-1" className="mt-0.5 text-sm text-muted-foreground">{t("accounts.subtitle")}</p>
              </div>
            </div>
            <button data-ui="accounts-page-button-1"
              onClick={() => { setShowAddModal(true); setAuthError("") }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all duration-200 shadow-[0_0_15px_var(--glow-primary)]"
            >
              <IconCirclePlus className="w-5 h-5" />
              {t("accounts.addAccount")}
            </button>
          </div>

          {accounts.length === 0 ? (
            <div data-ui="accounts-page-div-7" className="text-center py-16">
              <div data-ui="accounts-page-div-8" className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <IconUser className="w-10 h-10 text-muted-foreground" />
              </div>
              <p data-ui="accounts-page-p-2" className="text-lg text-muted-foreground">{t("accounts.noAccounts")}</p>
              <p data-ui="accounts-page-p-3" className="text-sm text-muted-foreground/70 mt-1">{t("accounts.noAccountsDesc")}</p>
            </div>
          ) : (
            <div data-ui="accounts-page-div-9" className="space-y-3">
              {accounts.map((account) => (
                <div data-ui="accounts-page-div-10"
                  key={account.id}
                  data-component="account-card"
                  data-active={account.isActive}
                  data-account-type={account.type}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border transition-all duration-200",
                    account.isActive
                      ? "border-primary bg-primary/10 shadow-[0_0_15px_var(--glow-primary)]"
                      : "border-border bg-muted/30 hover:border-primary/50"
                  )}
                >
                  <div data-ui="accounts-page-div-11"
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo[account.type].color} 12.5%, transparent)` }}
                  >
                    <CachedAvatar src={getAvatarUrl(account, account.username, avatarVersion)} alt="" className="w-full h-full object-cover" />
                  </div>

                  <div data-ui="accounts-page-div-12" className="flex-1 min-w-0">
                    <div data-ui="accounts-page-div-13" className="flex items-center gap-2">
                      <span data-ui="accounts-page-span-1" className="font-medium text-foreground truncate">{account.username}</span>
                      {account.isActive && (
                        <span data-ui="accounts-page-span-2" className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium flex-shrink-0">
                          {t("accounts.active")}
                        </span>
                      )}
                    </div>
                    <span data-ui="accounts-page-span-3" className="text-sm text-muted-foreground">
                      {account.type === "authlib-injector" && account.serverName
                        ? `${accountTypeInfo[account.type]?.name ?? "Authlib"} · ${account.serverName}`
                        : accountTypeInfo[account.type]?.name ?? account.type}
                    </span>
                  </div>

                  <div data-ui="accounts-page-div-14" className="flex items-center gap-2 flex-shrink-0">
                    <div data-ui="accounts-page-div-15" className="flex flex-col gap-0.5">
                      <button data-ui="accounts-page-button-2"
                        onClick={() => moveAccount(account.id, -1)}
                        disabled={accounts.findIndex(a => a.id === account.id) === 0}
                        title={t("accounts.moveUp")}
                        className="w-7 h-6 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <IconChevronUp className="w-4 h-4" strokeWidth={1.75} />
                      </button>
                      <button data-ui="accounts-page-button-3"
                        onClick={() => moveAccount(account.id, 1)}
                        disabled={accounts.findIndex(a => a.id === account.id) === accounts.length - 1}
                        title={t("accounts.moveDown")}
                        className="w-7 h-6 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <IconChevronDown className="w-4 h-4" strokeWidth={1.75} />
                      </button>
                    </div>
                    {!account.isActive && (
                      <button data-ui="accounts-page-button-4"
                        onClick={() => setActiveAccount(account.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors text-sm"
                      >
                        <IconCheck className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.select")}
                      </button>
                    )}
                    <button data-ui="accounts-page-button-5"
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
        <ModalLayer windowId="accounts-page-window-1" onClose={() => setShowAddModal(false)} className="animate-in fade-in-0">
          <div data-ui="accounts-page-div-16" className="w-full max-w-lg mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="accounts-page-div-17" className="flex items-center justify-between mb-6">
              <h3 data-ui="accounts-page-h3-1" className="text-lg font-semibold text-foreground">{t("accounts.addAccount")}</h3>
              <button data-ui="accounts-page-button-6"
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div data-ui="accounts-page-div-18" className="grid grid-cols-2 gap-4">
              {(["elyby", "xnskins", "microsoft", "offline", "authlib-injector"] as AccountType[]).map((type) => (
                <button data-ui="accounts-page-button-7"
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
                    type === "elyby" && "hover:border-primary/60",
                    type === "xnskins" && "hover:border-primary/60",
                    type === "microsoft" && "hover:border-primary/60",
                    type === "authlib-injector" && "col-span-2 flex items-center gap-4 hover:border-primary/60",
                  )}
                >
                  {type === "authlib-injector" ? (
                    <>
                      <div data-ui="accounts-page-div-19"
                        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo[type].color} 12.5%, transparent)` }}
                      >
                        <div data-ui="accounts-page-div-20" style={{ color: accountTypeInfo[type].color }}>
                          {getAccountIcon(type)}
                        </div>
                      </div>
                      <div data-ui="accounts-page-div-21" className="flex-1 min-w-0">
                        <div data-ui="accounts-page-div-22" className="font-medium text-foreground">{accountTypeInfo[type].name}</div>
                        <div data-ui="accounts-page-div-23" className="text-sm text-muted-foreground mt-0.5">{accountTypeInfo[type].description}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div data-ui="accounts-page-div-24"
                        className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                        style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo[type].color} 12.5%, transparent)` }}
                      >
                        <div data-ui="accounts-page-div-25" style={{ color: accountTypeInfo[type].color }}>
                          {getAccountIcon(type)}
                        </div>
                      </div>
                      <div data-ui="accounts-page-div-26" className="font-medium text-foreground">{accountTypeInfo[type].name}</div>
                      <div data-ui="accounts-page-div-27" className="text-sm text-muted-foreground mt-1">{accountTypeInfo[type].description}</div>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        </ModalLayer>
      )}

      {showAddModal && selectedAccountType === "offline" && (
        <ModalLayer windowId="accounts-page-window-2" onClose={() => { setSelectedAccountType(null); setShowAddModal(false) }} className="animate-in fade-in-0">
          <div data-ui="accounts-page-div-28" className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="accounts-page-div-29" className="flex items-center justify-between mb-6">
              <h3 data-ui="accounts-page-h3-2" className="text-lg font-semibold text-foreground">{t("accounts.offline")} {t("accounts.title").toLowerCase()}</h3>
              <button data-ui="accounts-page-button-8"
                onClick={() => { setSelectedAccountType(null); setShowAddModal(false) }}
                className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div data-ui="accounts-page-div-30" className="space-y-4">
              <div data-ui="accounts-page-div-31" className="space-y-2">
                <label data-ui="accounts-page-label-1" className="text-sm text-muted-foreground">{t("accounts.nickname")}</label>
                <input data-ui="accounts-page-input-1"
                  type="text"
                  value={offlineUsername}
                  onChange={(e) => setOfflineUsername(e.target.value)}
                  placeholder={t("accounts.enterNickname")}
                  className="w-full px-4 py-3 rounded-xl bg-input border border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleAddOfflineAccount()}
                />
                {!allowInvalidUsername && offlineUsername.trim() && !/^[A-Za-z0-9_]{3,16}$/.test(offlineUsername.trim()) && (
                  <p data-ui="accounts-page-p-4" className="text-xs text-destructive">{t("accounts.offlineInvalidHint")}</p>
                )}
              </div>

              <label data-ui="accounts-page-label-2" className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={allowInvalidUsername}
                  onCheckedChange={(v) => setAllowInvalidUsername(!!v)}
                />
                {t("accounts.offlineAllowInvalid")}
                <span data-ui="accounts-page-span-4"
                  title={t("accounts.offlineAllowInvalidHint")}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                  className="inline-flex cursor-help items-center text-muted-foreground/70 hover:text-foreground"
                >
                  <IconHelpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
              </label>

              <div data-ui="accounts-page-div-32" className="flex gap-3 pt-2">
                <button data-ui="accounts-page-button-9"
                  onClick={() => setSelectedAccountType(null)}
                  className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                >
                <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                {t("accounts.back")}
              </button>
                <button data-ui="accounts-page-button-10"
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
        </ModalLayer>
      )}

      {showAddModal && selectedAccountType === "authlib-injector" && (
        <AuthlibInjectorModal
          onClose={() => {
            setSelectedAccountType(null)
          }}
          onAccountAdded={(newAccount) => {
            addAccount(newAccount)
            setSelectedAccountType(null)
            setShowAddModal(false)
          }}
        />
      )}

      {showAddModal && selectedAccountType === "elyby" && (
        <ModalLayer windowId="accounts-page-window-3"
          onClose={() => {
            if (elybyAuthLoading || devicePolling) return
            setElybyAuthLoading(false)
            setElybyMethod("choose")
            setDeviceCodeInfo(null)
            setDevicePolling(false)
            setDeviceStatus("waiting")
            setSelectedAccountType(null)
          }}
          className="animate-in fade-in-0"
        >
          <div data-ui="accounts-page-div-33" className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="accounts-page-div-34" className="flex items-center justify-between mb-6">
              <h3 data-ui="accounts-page-h3-3" className="text-lg font-semibold text-foreground">{t("accounts.loginTitle.elyby")}</h3>
              <button data-ui="accounts-page-button-11"
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

            <div data-ui="accounts-page-div-35" className="text-center py-6">
              <div data-ui="accounts-page-div-36"
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.elyby.color} 12.5%, transparent)` }}
              >
                <div data-ui="accounts-page-div-37" style={{ color: accountTypeInfo.elyby.color }}>
                  {getAccountIcon("elyby")}
                </div>
              </div>
            </div>

            {elybyMethod === "choose" && (
              <>
                <div data-ui="accounts-page-div-38" className="grid grid-cols-1 gap-3">
                  <button data-ui="accounts-page-button-12"
                    onClick={() => setElybyMethod("oauth")}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50 transition-all text-left"
                  >
                    <div data-ui="accounts-page-div-39"
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.elyby.color} 12.5%, transparent)`, color: accountTypeInfo.elyby.color }}
                    >
                      <svg data-ui="accounts-page-svg-4" data-icon="accounts-page-svg-4" className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect data-ui="accounts-page-rect-1" x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path data-ui="accounts-page-path-4" d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                        <circle data-ui="accounts-page-circle-1" cx="12" cy="15" r="1.4" fill="currentColor" />
                      </svg>
                    </div>
                    <div data-ui="accounts-page-div-40">
                      <div data-ui="accounts-page-div-41" className="font-medium text-foreground">{t("accounts.microsoftMethodOAuth")}</div>
                      <div data-ui="accounts-page-div-42" className="text-sm text-muted-foreground mt-1">{t("accounts.elyMethodOAuthDesc")}</div>
                    </div>
                  </button>
                  <button data-ui="accounts-page-button-13"
                    onClick={() => void handleEnableElyDeviceCode()}
                    disabled={elybyAuthLoading}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
                  >
                    <div data-ui="accounts-page-div-43"
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.elyby.color} 12.5%, transparent)`, color: accountTypeInfo.elyby.color }}
                    >
                      <svg data-ui="accounts-page-svg-5" data-icon="accounts-page-svg-5" className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect data-ui="accounts-page-rect-2" x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect data-ui="accounts-page-rect-3" x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect data-ui="accounts-page-rect-4" x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <path data-ui="accounts-page-path-5" d="M14 14h4v4h-4z" fill="currentColor" />
                      </svg>
                    </div>
                    <div data-ui="accounts-page-div-44">
                      <div data-ui="accounts-page-div-45" className="font-medium text-foreground">{t("accounts.microsoftMethodDevice")}</div>
                      <div data-ui="accounts-page-div-46" className="text-sm text-muted-foreground mt-1">{t("accounts.elyMethodDeviceDesc")}</div>
                    </div>
                  </button>
                </div>
                <div data-ui="accounts-page-div-47" className="flex gap-3 mt-5">
                  <button data-ui="accounts-page-button-14"
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
                <div data-ui="accounts-page-div-48" className="text-center mb-4">
                  {elybyAuthLoading ? (
                    <div data-ui="accounts-page-div-49">
                      <IconLoader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                      <p data-ui="accounts-page-p-5" className="text-sm text-muted-foreground">{t("accounts.connectElyBy")}</p>
                    </div>
                  ) : authError ? (
                    <div data-ui="accounts-page-div-50" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p data-ui="accounts-page-p-6" className="text-sm text-destructive">{authError}</p>
                    </div>
                  ) : (
                    <p data-ui="accounts-page-p-7" className="text-sm text-muted-foreground mb-4">
                      {t("accounts.connectElyByDesc")}
                    </p>
                  )}
                </div>

                <div data-ui="accounts-page-div-51" className="flex gap-3">
                  <button data-ui="accounts-page-button-15"
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
                    <button data-ui="accounts-page-button-16"
                      onClick={handleElyByLogin}
                      className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
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
                  <div data-ui="accounts-page-div-52">
                    <div data-ui="accounts-page-div-53" className="flex flex-col items-center justify-center py-6 text-center">
                      <IconLoader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
                      <p data-ui="accounts-page-p-8" className="text-sm text-muted-foreground">{t("accounts.generatingDeviceCode")}</p>
                    </div>
                    {authError && !devicePolling && (
                      <div data-ui="accounts-page-div-54" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                        <p data-ui="accounts-page-p-9" className="text-sm text-destructive">{authError}</p>
                      </div>
                    )}
                    <div data-ui="accounts-page-div-55" className="flex gap-3">
                      <button data-ui="accounts-page-button-17"
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
                        <button data-ui="accounts-page-button-18"
                          onClick={handleEnableElyDeviceCode}
                          className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
                        >
                          <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.restartDeviceCode")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : deviceStatus === "expired" ? (
                  <div data-ui="accounts-page-div-56">
                    <div data-ui="accounts-page-div-57" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                      <p data-ui="accounts-page-p-10" className="text-sm text-destructive">{t("accounts.deviceExpired")}</p>
                    </div>
                    <div data-ui="accounts-page-div-58" className="flex gap-3">
                      <button data-ui="accounts-page-button-19"
                        onClick={() => setElybyMethod("choose")}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      <button data-ui="accounts-page-button-20"
                        onClick={handleEnableElyDeviceCode}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
                      >
                        <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.restartDeviceCode")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div data-ui="accounts-page-div-59" className="space-y-4">
                    <div data-ui="accounts-page-div-60" className="p-5 rounded-2xl bg-muted/40 border border-border">
                      <div data-ui="accounts-page-div-61" className="text-center">
                        <p data-ui="accounts-page-p-11" className="text-sm text-muted-foreground mb-2">{t("accounts.enterCodeAtLink")}</p>
                        <button data-ui="accounts-page-button-21"
                          onClick={() => window.electronAPI?.openExternal(deviceCodeInfo.verificationUriComplete)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors"
                        >
                          <IconExternalLink className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.openDeviceCodeLink")}
                        </button>
                        <div data-ui="accounts-page-div-62" className="my-4 text-xs uppercase tracking-widest text-muted-foreground/70">{t("accounts.enterCodeLabel")}</div>
                        <div data-ui="accounts-page-div-63" className="flex items-center gap-2">
                          <div data-ui="accounts-page-div-64"
                            className="text-3xl font-bold tracking-[0.35em] text-foreground select-all flex-1 px-3 py-2 rounded-xl border border-border bg-background"
                            style={{ color: "var(--primary)" }}
                          >
                            {deviceCodeInfo.userCode}
                          </div>
                          <button data-ui="accounts-page-button-22"
                            onClick={() => handleCopyCode(deviceCodeInfo.userCode)}
                            className="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            title={t("accounts.clickToCopy")}
                          >
                            {copied
                              ? <IconCheck className="w-4 h-4 text-success" strokeWidth={2} />
                              : <IconCopy className="w-4 h-4" strokeWidth={1.75} />}
                          </button>
                        </div>
                        {devicePolling && (
                          <div data-ui="accounts-page-div-65" className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
                            <IconLoader2 className="w-4 h-4 animate-spin text-primary" />
                            {authError || t("accounts.deviceWaiting")}
                          </div>
                        )}
                        {!devicePolling && authError && (
                          <div data-ui="accounts-page-div-66" className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                            <p data-ui="accounts-page-p-12" className="text-sm text-destructive">{authError}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div data-ui="accounts-page-div-67" className="flex gap-3">
                      <button data-ui="accounts-page-button-23"
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
        </ModalLayer>
      )}

      {showAddModal && selectedAccountType === "xnskins" && (
        <ModalLayer windowId="accounts-page-window-4"
          onClose={() => {
            if (xnskinsAuthLoading || devicePolling) return
            setXnSkinsAuthLoading(false)
            setXnskinsMethod("choose")
            setDeviceCodeInfo(null)
            setDevicePolling(false)
            setDeviceStatus("waiting")
            setSelectedAccountType(null)
          }}
          className="animate-in fade-in-0"
        >
          <div data-ui="accounts-page-div-68" className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="accounts-page-div-69" className="flex items-center justify-between mb-6">
              <h3 data-ui="accounts-page-h3-4" className="text-lg font-semibold text-foreground">{t("accounts.loginTitle.xnskins")}</h3>
              <button data-ui="accounts-page-button-24"
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

            <div data-ui="accounts-page-div-70" className="text-center py-6">
              <div data-ui="accounts-page-div-71"
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.xnskins.color} 12.5%, transparent)` }}
              >
                <div data-ui="accounts-page-div-72" style={{ color: accountTypeInfo.xnskins.color }}>
                  {getAccountIcon("xnskins")}
                </div>
              </div>
            </div>

            {xnskinsMethod === "choose" && (
              <>
                <div data-ui="accounts-page-div-73" className="grid grid-cols-1 gap-3">
                  <button data-ui="accounts-page-button-25"
                    onClick={() => setXnskinsMethod("oauth")}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50 transition-all text-left"
                  >
                    <div data-ui="accounts-page-div-74"
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.xnskins.color} 12.5%, transparent)`, color: accountTypeInfo.xnskins.color }}
                    >
                      <svg data-ui="accounts-page-svg-6" data-icon="accounts-page-svg-6" className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect data-ui="accounts-page-rect-5" x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path data-ui="accounts-page-path-6" d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                        <circle data-ui="accounts-page-circle-2" cx="12" cy="15" r="1.4" fill="currentColor" />
                      </svg>
                    </div>
                    <div data-ui="accounts-page-div-75">
                      <div data-ui="accounts-page-div-76" className="font-medium text-foreground">{t("accounts.microsoftMethodOAuth")}</div>
                      <div data-ui="accounts-page-div-77" className="text-sm text-muted-foreground mt-1">{t("accounts.connectXnSkinsDesc")}</div>
                    </div>
                  </button>
                  <button data-ui="accounts-page-button-26"
                    onClick={() => void handleEnableXnSkinsDeviceCode()}
                    disabled={xnskinsAuthLoading}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
                  >
                    <div data-ui="accounts-page-div-78"
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.xnskins.color} 12.5%, transparent)`, color: accountTypeInfo.xnskins.color }}
                    >
                      <svg data-ui="accounts-page-svg-7" data-icon="accounts-page-svg-7" className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect data-ui="accounts-page-rect-6" x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect data-ui="accounts-page-rect-7" x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect data-ui="accounts-page-rect-8" x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <path data-ui="accounts-page-path-7" d="M14 14h4v4h-4z" fill="currentColor" />
                      </svg>
                    </div>
                    <div data-ui="accounts-page-div-79">
                      <div data-ui="accounts-page-div-80" className="font-medium text-foreground">{t("accounts.microsoftMethodDevice")}</div>
                      <div data-ui="accounts-page-div-81" className="text-sm text-muted-foreground mt-1">{t("accounts.xnskinsMethodDeviceDesc")}</div>
                    </div>
                  </button>
                </div>
                <div data-ui="accounts-page-div-82" className="flex gap-3 mt-5">
                  <button data-ui="accounts-page-button-27"
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
                <div data-ui="accounts-page-div-83" className="text-center mb-4">
                  {xnskinsAuthLoading ? (
                    <div data-ui="accounts-page-div-84">
                      <IconLoader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                      <p data-ui="accounts-page-p-13" className="text-sm text-muted-foreground">{t("accounts.connectXnSkins")}</p>
                    </div>
                  ) : authError ? (
                    <div data-ui="accounts-page-div-85" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p data-ui="accounts-page-p-14" className="text-sm text-destructive">{authError}</p>
                    </div>
                  ) : (
                    <p data-ui="accounts-page-p-15" className="text-sm text-muted-foreground mb-4">
                      {t("accounts.connectXnSkinsDesc")}
                    </p>
                  )}
                </div>

                <div data-ui="accounts-page-div-86" className="flex gap-3">
                  <button data-ui="accounts-page-button-28"
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
                    <button data-ui="accounts-page-button-29"
                      onClick={handleXnSkinsLogin}
                      className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
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
                  <div data-ui="accounts-page-div-87">
                    <div data-ui="accounts-page-div-88" className="flex flex-col items-center justify-center py-6 text-center">
                      <IconLoader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
                      <p data-ui="accounts-page-p-16" className="text-sm text-muted-foreground">{t("accounts.generatingDeviceCode")}</p>
                    </div>
                    {authError && !devicePolling && (
                      <div data-ui="accounts-page-div-89" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                        <p data-ui="accounts-page-p-17" className="text-sm text-destructive">{authError}</p>
                      </div>
                    )}
                    <div data-ui="accounts-page-div-90" className="flex gap-3">
                      <button data-ui="accounts-page-button-30"
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
                        <button data-ui="accounts-page-button-31"
                          onClick={handleEnableXnSkinsDeviceCode}
                          className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
                        >
                          <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.restartDeviceCode")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : deviceStatus === "expired" ? (
                  <div data-ui="accounts-page-div-91">
                    <div data-ui="accounts-page-div-92" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                      <p data-ui="accounts-page-p-18" className="text-sm text-destructive">{t("accounts.deviceExpired")}</p>
                    </div>
                    <div data-ui="accounts-page-div-93" className="flex gap-3">
                      <button data-ui="accounts-page-button-32"
                        onClick={() => setXnskinsMethod("choose")}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      <button data-ui="accounts-page-button-33"
                        onClick={handleEnableXnSkinsDeviceCode}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
                      >
                        <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.restartDeviceCode")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div data-ui="accounts-page-div-94" className="space-y-4">
                    <div data-ui="accounts-page-div-95" className="p-5 rounded-2xl bg-muted/40 border border-border">
                      <div data-ui="accounts-page-div-96" className="text-center">
                        <p data-ui="accounts-page-p-19" className="text-sm text-muted-foreground mb-2">{t("accounts.enterCodeAtLink")}</p>
                        <button data-ui="accounts-page-button-34"
                          onClick={() => window.electronAPI?.openExternal(deviceCodeInfo.verificationUriComplete)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors"
                        >
                          <IconExternalLink className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.openDeviceCodeLink")}
                        </button>
                        <div data-ui="accounts-page-div-97" className="my-4 text-xs uppercase tracking-widest text-muted-foreground/70">{t("accounts.enterCodeLabel")}</div>
                        <div data-ui="accounts-page-div-98" className="flex items-center gap-2">
                          <div data-ui="accounts-page-div-99"
                            className="text-3xl font-bold tracking-[0.35em] text-foreground select-all flex-1 px-3 py-2 rounded-xl border border-border bg-background"
                            style={{ color: "var(--primary)" }}
                          >
                            {deviceCodeInfo.userCode}
                          </div>
                          <button data-ui="accounts-page-button-35"
                            onClick={() => handleCopyCode(deviceCodeInfo.userCode)}
                            className="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            title={t("accounts.clickToCopy")}
                          >
                            {copied
                              ? <IconCheck className="w-4 h-4 text-success" strokeWidth={2} />
                              : <IconCopy className="w-4 h-4" strokeWidth={1.75} />}
                          </button>
                        </div>
                        {devicePolling && (
                          <div data-ui="accounts-page-div-100" className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
                            <IconLoader2 className="w-4 h-4 animate-spin text-primary" />
                            {authError || t("accounts.deviceWaiting")}
                          </div>
                        )}
                        {!devicePolling && authError && (
                          <div data-ui="accounts-page-div-101" className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                            <p data-ui="accounts-page-p-20" className="text-sm text-destructive">{authError}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div data-ui="accounts-page-div-102" className="flex gap-3">
                      <button data-ui="accounts-page-button-36"
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
        </ModalLayer>
      )}

      {showAddModal && selectedAccountType === "microsoft" && (
        <ModalLayer windowId="accounts-page-window-5"
          onClose={() => {
            if (microsoftAuthLoading || devicePolling) return
            setMicrosoftAuthLoading(false)
            setMicrosoftMethod("choose")
            setDeviceCodeInfo(null)
            setDevicePolling(false)
            setDeviceStatus("waiting")
            setSelectedAccountType(null)
          }}
          className="animate-in fade-in-0"
        >
          <div data-ui="accounts-page-div-103" className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
            <div data-ui="accounts-page-div-104" className="flex items-center justify-between mb-6">
              <h3 data-ui="accounts-page-h3-5" className="text-lg font-semibold text-foreground">{t("accounts.loginTitle.microsoft")}</h3>
              <button data-ui="accounts-page-button-37"
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

            <div data-ui="accounts-page-div-105" className="text-center py-6">
              <div data-ui="accounts-page-div-106"
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.microsoft.color} 12.5%, transparent)` }}
              >
                <div data-ui="accounts-page-div-107" style={{ color: accountTypeInfo.microsoft.color }}>
                  {getAccountIcon("microsoft")}
                </div>
              </div>
            </div>

            {microsoftMethod === "choose" && (
              <>
                <div data-ui="accounts-page-div-108" className="grid grid-cols-1 gap-3">
                  <button data-ui="accounts-page-button-38"
                    onClick={() => setMicrosoftMethod("oauth")}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50 transition-all text-left"
                  >
                    <div data-ui="accounts-page-div-109"
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.microsoft.color} 12.5%, transparent)`, color: accountTypeInfo.microsoft.color }}
                    >
                      <svg data-ui="accounts-page-svg-8" data-icon="accounts-page-svg-8" className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect data-ui="accounts-page-rect-9" x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path data-ui="accounts-page-path-8" d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                        <circle data-ui="accounts-page-circle-3" cx="12" cy="15" r="1.4" fill="currentColor" />
                      </svg>
                    </div>
                    <div data-ui="accounts-page-div-110">
                      <div data-ui="accounts-page-div-111" className="font-medium text-foreground">{t("accounts.microsoftMethodOAuth")}</div>
                      <div data-ui="accounts-page-div-112" className="text-sm text-muted-foreground mt-1">{t("accounts.microsoftMethodOAuthDesc")}</div>
                    </div>
                  </button>
                  <button data-ui="accounts-page-button-39"
                    onClick={() => void handleEnableDeviceCode()}
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50 transition-all text-left disabled:opacity-60"
                    disabled={microsoftAuthLoading}
                  >
                    <div data-ui="accounts-page-div-113"
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${accountTypeInfo.microsoft.color} 12.5%, transparent)`, color: accountTypeInfo.microsoft.color }}
                    >
                      <svg data-ui="accounts-page-svg-9" data-icon="accounts-page-svg-9" className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect data-ui="accounts-page-rect-10" x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect data-ui="accounts-page-rect-11" x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <rect data-ui="accounts-page-rect-12" x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                        <path data-ui="accounts-page-path-9" d="M14 14h4v4h-4z" fill="currentColor" />
                      </svg>
                    </div>
                    <div data-ui="accounts-page-div-114">
                      <div data-ui="accounts-page-div-115" className="font-medium text-foreground">{t("accounts.microsoftMethodDevice")}</div>
                      <div data-ui="accounts-page-div-116" className="text-sm text-muted-foreground mt-1">{t("accounts.microsoftMethodDeviceDesc")}</div>
                    </div>
                  </button>
                </div>
                <div data-ui="accounts-page-div-117" className="flex gap-3 mt-5">
                  <button data-ui="accounts-page-button-40"
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
                <div data-ui="accounts-page-div-118" className="text-center mb-4">
                  {microsoftAuthLoading ? (
                    <div data-ui="accounts-page-div-119">
                      <IconLoader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                      <p data-ui="accounts-page-p-21" className="text-sm text-muted-foreground">{t("accounts.connectMicrosoft")}</p>
                    </div>
                  ) : authError ? (
                    <div data-ui="accounts-page-div-120" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                      <p data-ui="accounts-page-p-22" className="text-sm text-destructive">{authError}</p>
                    </div>
                  ) : (
                    <p data-ui="accounts-page-p-23" className="text-sm text-muted-foreground mb-4">
                      {t("accounts.connectMicrosoftDesc")}
                    </p>
                  )}
                </div>

                <div data-ui="accounts-page-div-121" className="flex gap-3">
                  <button data-ui="accounts-page-button-41"
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
                    <button data-ui="accounts-page-button-42"
                      onClick={handleMicrosoftLogin}
                      className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
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
                  <div data-ui="accounts-page-div-122">
                    <div data-ui="accounts-page-div-123" className="flex flex-col items-center justify-center py-6 text-center">
                      <IconLoader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
                      <p data-ui="accounts-page-p-24" className="text-sm text-muted-foreground">{t("accounts.generatingDeviceCode")}</p>
                    </div>
                    {authError && !devicePolling && (
                      <div data-ui="accounts-page-div-124" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                        <p data-ui="accounts-page-p-25" className="text-sm text-destructive">{authError}</p>
                      </div>
                    )}
                    <div data-ui="accounts-page-div-125" className="flex gap-3">
                      <button data-ui="accounts-page-button-43"
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
                        <button data-ui="accounts-page-button-44"
                          onClick={handleEnableDeviceCode}
                          className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
                        >
                          <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.restartDeviceCode")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : deviceStatus === "expired" ? (
                  <div data-ui="accounts-page-div-126">
                    <div data-ui="accounts-page-div-127" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-4">
                      <p data-ui="accounts-page-p-26" className="text-sm text-destructive">{t("accounts.deviceExpired")}</p>
                    </div>
                    <div data-ui="accounts-page-div-128" className="flex gap-3">
                      <button data-ui="accounts-page-button-45"
                        onClick={() => setMicrosoftMethod("choose")}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors"
                      >
                        <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.back")}
                      </button>
                      <button data-ui="accounts-page-button-46"
                        onClick={handleEnableDeviceCode}
                        className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
                      >
                        <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                        {t("accounts.restartDeviceCode")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div data-ui="accounts-page-div-129" className="space-y-4">
                    <div data-ui="accounts-page-div-130" className="p-5 rounded-2xl bg-muted/40 border border-border">
                      <div data-ui="accounts-page-div-131" className="text-center">
                        <p data-ui="accounts-page-p-27" className="text-sm text-muted-foreground mb-2">{t("accounts.enterCodeAtLink")}</p>
                        <button data-ui="accounts-page-button-47"
                          onClick={() => window.electronAPI?.openExternal(deviceCodeInfo.verificationUriComplete)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors"
                        >
                          <IconExternalLink className="w-4 h-4" strokeWidth={1.75} />
                          {t("accounts.openDeviceCodeLink")}
                        </button>
                        <div data-ui="accounts-page-div-132" className="my-4 text-xs uppercase tracking-widest text-muted-foreground/70">{t("accounts.enterCodeLabel")}</div>
                        <div data-ui="accounts-page-div-133" className="flex items-center gap-2">
                          <div data-ui="accounts-page-div-134"
                            className="text-3xl font-bold tracking-[0.35em] text-foreground select-all flex-1 px-3 py-2 rounded-xl border border-border bg-background"
                            style={{ color: "var(--primary)" }}
                          >
                            {deviceCodeInfo.userCode}
                          </div>
                          <button data-ui="accounts-page-button-48"
                            onClick={() => handleCopyCode(deviceCodeInfo.userCode)}
                            className="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            title={t("accounts.clickToCopy")}
                          >
                            {copied
                              ? <IconCheck className="w-4 h-4 text-success" strokeWidth={2} />
                              : <IconCopy className="w-4 h-4" strokeWidth={1.75} />}
                          </button>
                        </div>
                        {devicePolling && (
                          <div data-ui="accounts-page-div-135" className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
                            <IconLoader2 className="w-4 h-4 animate-spin text-primary" />
                            {authError || t("accounts.deviceWaiting")}
                          </div>
                        )}
                        {!devicePolling && authError && (
                          <div data-ui="accounts-page-div-136" className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                            <p data-ui="accounts-page-p-28" className="text-sm text-destructive">{authError}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div data-ui="accounts-page-div-137" className="flex gap-3">
                      <button data-ui="accounts-page-button-49"
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
        </ModalLayer>
      )}
    </>
  )
}
