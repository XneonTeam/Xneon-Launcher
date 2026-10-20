import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  IconLoader2,
  IconArrowLeft,
  IconPlus,
  IconCheck,
  IconAlertTriangle,
  IconExternalLink,
  IconTrash,
  IconWorld,
  IconShieldCheck,
  IconX,
  IconLogin,
  IconUser,
  IconChevronDown,
  IconCoffee,
} from "@tabler/icons-react"
import { ModalLayer } from "@/components/ui/modal-layer"
import type { Account } from "@/src/AccountsContext"
import type {
  AuthlibInjectorErrorPayload,
  AuthlibInjectorServerSummary,
  AuthlibInjectorServer,
  AuthlibLoginPhase,
  YggdrasilProfileWithTextures,
} from "@xnlc/types"

interface AuthlibInjectorModalProps {
  onClose: () => void
  onAccountAdded: (account: Account) => void
}

type ModalView = "login" | "add-server" | "select-profile"
type AddServerStep = "input" | "probing" | "confirm"

const AUTHLIB_COLOR = "var(--primary)"

export function AuthlibInjectorModal({ onClose, onAccountAdded }: AuthlibInjectorModalProps) {
  const { t } = useTranslation()

  const [view, setView] = useState<ModalView>("login")
  const [servers, setServers] = useState<AuthlibInjectorServerSummary[]>([])
  const [loadingServers, setLoadingServers] = useState(true)
  const [selectedServerId, setSelectedServerId] = useState<string>("")
  const [showServerPicker, setShowServerPicker] = useState(false)

  // Login form state
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loginLoading, setLoginLoading] = useState(false)
  const [authError, setAuthError] = useState("")

  // Profile selection state
  const [availableProfiles, setAvailableProfiles] = useState<YggdrasilProfileWithTextures[]>([])
  const [cachedCredentials, setCachedCredentials] = useState<{ username: string; password: string } | null>(null)

  // Add Server flow state
  const [addStep, setAddStep] = useState<AddServerStep>("input")
  const [inputUrl, setInputUrl] = useState("")
  const [probeResult, setProbeResult] = useState<AuthlibInjectorServer | null>(null)
  const [probeError, setProbeError] = useState("")
  const [addingServer, setAddingServer] = useState(false)

  // Login progress: main присылает фазы (метаданные → вход → профили).
  const [loginPhase, setLoginPhase] = useState<AuthlibLoginPhase | null>(null)
  // Окно закрыли во время логина — ответ нужно просто проигнорировать.
  const closedRef = useRef(false)

  const closeModal = useCallback(() => {
    closedRef.current = true
    onClose()
  }, [onClose])

  /** Код ошибки → локализованный текст (fallback — сообщение из main). */
  const localizeAuthlibError = useCallback((error: AuthlibInjectorErrorPayload): string => {
    // Для этих кодов серверный текст конкретнее общей локализации.
    if ((error.code === "server_error" || error.code === "unknown") && error.message) return error.message
    const errKey = `accounts.authlibErrors.${error.code}`
    const localized = t(errKey)
    return localized !== errKey ? localized : error.message
  }, [t])

  const phaseLabel = useCallback((phase: AuthlibLoginPhase): string => {
    switch (phase) {
      case "metadata":
        return t("accounts.authlibPhaseMetadata", "Проверка сервера...")
      case "authenticate":
        return t("accounts.authlibPhaseAuthenticate", "Вход...")
      case "profiles":
        return t("accounts.authlibPhaseProfiles", "Загрузка профилей...")
    }
  }, [t])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onAuthlibLoginProgress((progress) => {
      if (closedRef.current) return
      setLoginPhase(progress.phase)
    })
    return () => unsubscribe?.()
  }, [])

  // Load servers on mount
  const loadServers = useCallback(async () => {
    setLoadingServers(true)
    try {
      const list = await window.electronAPI?.authlibListServers()
      if (list) {
        setServers(list)
        if (list.length > 0 && !selectedServerId) {
          setSelectedServerId(list[0].id)
        }
      }
    } catch (err) {
      console.error("Failed to load authlib servers:", err)
    } finally {
      setLoadingServers(false)
    }
  }, [selectedServerId])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const selectedServer = servers.find((s) => s.id === selectedServerId)

  // ── Handler: Login ──
  const handleLogin = async (overrideProfileId?: string) => {
    if (!selectedServerId || !username.trim() || !password) return
    setLoginLoading(true)
    setAuthError("")
    setLoginPhase("metadata")

    try {
      const outcome = await window.electronAPI?.authlibLogin(
        selectedServerId,
        username.trim(),
        password,
        overrideProfileId,
      )

      // Окно закрыли, пока шёл запрос — ответ больше никому не нужен.
      if (closedRef.current) return

      if (!outcome) {
        setAuthError(t("accounts.authlibLoginFailed", "Authentication failed"))
        return
      }

      if (!outcome.ok) {
        setAuthError(localizeAuthlibError(outcome.error))
        return
      }

      const { result } = outcome

      // If server returned multiple profiles and user hasn't picked one yet
      if (result.requiresProfileSelection && result.availableProfiles.length > 0) {
        setAvailableProfiles(result.availableProfiles)
        setCachedCredentials({ username: username.trim(), password })
        setView("select-profile")
        return
      }

      // Login completed successfully
      onAccountAdded({
        id: result.id,
        type: "authlib-injector",
        username: result.username,
        uuid: result.uuid,
        accessToken: result.accessToken,
        yggClientToken: result.clientToken,
        serverId: result.serverId,
        serverUrl: result.serverUrl,
        serverName: result.serverName,
        skinUrl: result.skinUrl,
        profiles: JSON.stringify({
          selected: result.selectedProfile,
          available: result.availableProfiles,
        }),
        isActive: true,
      })
      closeModal()
    } catch (err: unknown) {
      if (closedRef.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setAuthError(msg)
    } finally {
      setLoginLoading(false)
      setLoginPhase(null)
    }
  }

  // ── Handler: Profile selected ──
  const handleSelectProfile = async (profile: YggdrasilProfileWithTextures) => {
    if (!cachedCredentials) return
    setLoginLoading(true)
    try {
      await handleLogin(profile.id)
    } finally {
      setLoginLoading(false)
    }
  }

  // ── Handler: Probe server ──
  const handleProbeServer = async () => {
    if (!inputUrl.trim()) return
    setAddStep("probing")
    setProbeError("")

    try {
      const outcome = await window.electronAPI?.authlibProbeServer(inputUrl.trim())
      if (!outcome) {
        setProbeError(t("accounts.authlibCheckFailed", "Failed to check authorization server"))
        setAddStep("input")
        return
      }

      if (!outcome.ok) {
        setProbeError(localizeAuthlibError(outcome.error))
        setAddStep("input")
        return
      }

      setProbeResult(outcome.server)
      setAddStep("confirm")
    } catch (err: unknown) {
      setProbeError(err instanceof Error ? err.message : String(err))
      setAddStep("input")
    }
  }

  // ── Handler: Save Server ──
  const handleAddServer = async () => {
    if (!probeResult) return
    setAddingServer(true)
    setProbeError("")
    try {
      const outcome = await window.electronAPI?.authlibAddServer(probeResult)
      if (!outcome) {
        setProbeError(t("accounts.authlibCheckFailed", "Failed to check authorization server"))
        return
      }
      if (!outcome.ok) {
        // Остаёмся на шаге подтверждения, но с причиной: раньше ошибка
        // resolve улетала rejection'ом и на этом экране не показывалась.
        setProbeError(localizeAuthlibError(outcome.error))
        return
      }

      await loadServers()
      setSelectedServerId(outcome.server.id)
      setView("login")
      // Reset add flow
      setAddStep("input")
      setInputUrl("")
      setProbeResult(null)
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddingServer(false)
    }
  }

  // ── Handler: Remove Server ──
  const handleRemoveServer = async (serverId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      // Сервер удаляется вместе с привязкой аккаунтов — предупреждаем заранее.
      const accounts = await window.electronAPI?.loadAccounts() ?? []
      const linked = accounts.filter((a) => a.type === "authlib-injector" && a.serverId === serverId)
      if (linked.length > 0) {
        const confirmText = t("accounts.authlibRemoveServerConfirm", {
          count: linked.length,
          defaultValue: "Будут затронуты аккаунты: {{count}}. Сервер будет удалён. Продолжить?",
        })
        if (!window.confirm(confirmText)) return
      }

      const result = await window.electronAPI?.authlibRemoveServer(serverId)
      const removed = result?.removedAccounts ?? 0
      await loadServers()
      if (selectedServerId === serverId) {
        const remaining = servers.filter((s) => s.id !== serverId)
        setSelectedServerId(remaining.length > 0 ? remaining[0].id : "")
      }
      if (removed > 0) {
        window.alert(t("accounts.authlibServerRemovedAccounts", {
          count: removed,
          defaultValue: "Сервер удалён. Затронуто аккаунтов: {{count}}.",
        }))
      }
    } catch (err) {
      console.error("Failed to remove server:", err)
    }
  }

  return (
    <ModalLayer windowId="accounts-authlib-injector-modal-window-1"
      onClose={closeModal}
      className="animate-in fade-in-0"
    >
      <div data-ui="accounts-authlib-injector-modal-div-1" data-component="authlib-injector-modal" className="w-full max-w-md mx-4 p-6 rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
        {/* Header — identical layout to Ely.by / Microsoft modals */}
        <div data-ui="accounts-authlib-injector-modal-div-2" className="flex items-center justify-between mb-6">
          <h3 data-ui="accounts-authlib-injector-modal-h3-1" className="text-lg font-semibold text-foreground">
            {view === "add-server"
              ? t("accounts.addAuthServer", "Добавить сервер авторизации")
              : view === "select-profile"
                ? t("accounts.authlibSelectProfile", "Выбор персонажа")
                : t("accounts.loginTitle.authlib", "Вход через Authlib-Injector")}
          </h3>
          <button data-ui="accounts-authlib-injector-modal-button-1"
            onClick={closeModal}
            className="w-8 h-8 rounded-lg border border-border bg-muted/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Hero Section — identical w-16 h-16 rounded-2xl brand icon */}
        <div data-ui="accounts-authlib-injector-modal-div-3" className="text-center py-5">
          <div data-ui="accounts-authlib-injector-modal-div-4"
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 overflow-hidden shadow-inner"
            style={{ backgroundColor: `color-mix(in srgb, ${AUTHLIB_COLOR} 12.5%, transparent)` }}
          >
            {view === "login" && selectedServer?.favicon ? (
              <img data-ui="accounts-authlib-injector-modal-img-1"
                src={selectedServer.favicon}
                alt=""
                className="w-10 h-10 object-contain rounded-lg"
              />
            ) : view === "add-server" && probeResult?.favicon ? (
              <img data-ui="accounts-authlib-injector-modal-img-2"
                src={probeResult.favicon}
                alt=""
                className="w-10 h-10 object-contain rounded-lg"
              />
            ) : (
              <div data-ui="accounts-authlib-injector-modal-div-5" style={{ color: AUTHLIB_COLOR }}>
                <IconCoffee className="w-8 h-8" strokeWidth={1.8} />
              </div>
            )}
          </div>
          {view === "login" && selectedServer && (
            <p data-ui="accounts-authlib-injector-modal-p-1" className="text-sm font-medium text-foreground">
              {selectedServer.name}
            </p>
          )}
          {view === "add-server" && (
            <p data-ui="accounts-authlib-injector-modal-p-2" className="text-sm text-muted-foreground">
              {t("accounts.authlibAddServerSubtitle", "Yggdrasil-совместимый сервер авторизации")}
            </p>
          )}
          {view === "select-profile" && (
            <p data-ui="accounts-authlib-injector-modal-p-3" className="text-sm text-muted-foreground">
              {t("accounts.authlibSelectProfileDesc", "Выберите игровой профиль для игры")}
            </p>
          )}
        </div>

        {/* ── VIEW: ADD SERVER ── */}
        {view === "add-server" && (
          <div data-ui="accounts-authlib-injector-modal-div-6" className="space-y-4">
            {addStep === "input" && (
              <>
                <p data-ui="accounts-authlib-injector-modal-p-4" className="text-xs text-muted-foreground">
                  {t("accounts.authlibEnterUrlDesc", "Введите URL сервера авторизации (например, https://ely.by или адрес вашего сервера):")}
                </p>
                <div data-ui="accounts-authlib-injector-modal-div-7">
                  <input data-ui="accounts-authlib-injector-modal-input-1"
                    type="text"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleProbeServer()}
                    placeholder="https://example.com"
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 focus:border-primary focus:bg-background transition-all outline-none text-foreground text-sm"
                  />
                </div>

                {probeError && (
                  <div data-ui="accounts-authlib-injector-modal-div-8" className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    {probeError}
                  </div>
                )}

                <div data-ui="accounts-authlib-injector-modal-div-9" className="flex gap-3 pt-2">
                  <button data-ui="accounts-authlib-injector-modal-button-2"
                    onClick={() => {
                      setView("login")
                      setAddStep("input")
                      setProbeError("")
                    }}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors font-medium text-sm"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back", "Назад")}
                  </button>
                  <button data-ui="accounts-authlib-injector-modal-button-3"
                    onClick={handleProbeServer}
                    disabled={!inputUrl.trim()}
                    className="flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm transition-colors disabled:opacity-50"
                  >
                    {t("accounts.next", "Далее")}
                  </button>
                </div>
              </>
            )}

            {addStep === "probing" && (
              <div data-ui="accounts-authlib-injector-modal-div-10" className="py-8 flex flex-col items-center justify-center text-center">
                <IconLoader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                <p data-ui="accounts-authlib-injector-modal-p-5" className="text-sm font-medium text-foreground">{t("accounts.authlibChecking", "Проверка сервера...")}</p>
                <p data-ui="accounts-authlib-injector-modal-p-6" className="text-xs text-muted-foreground mt-1">{t("accounts.authlibValidatingMetadata", "Проверка Yggdrasil API и метаданных")}</p>
              </div>
            )}

            {addStep === "confirm" && probeResult && (
              <>
                <div data-ui="accounts-authlib-injector-modal-div-11" className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                  <div data-ui="accounts-authlib-injector-modal-div-12" className="flex items-center gap-3">
                    <div data-ui="accounts-authlib-injector-modal-div-13" className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center overflow-hidden flex-shrink-0 border border-border/50">
                      {probeResult.favicon ? (
                        <img data-ui="accounts-authlib-injector-modal-img-3" src={probeResult.favicon} alt="" className="w-6 h-6 object-contain" />
                      ) : (
                        <IconWorld className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div data-ui="accounts-authlib-injector-modal-div-14" className="min-w-0 flex-1">
                      <div data-ui="accounts-authlib-injector-modal-div-15" className="text-sm font-semibold text-foreground truncate">{probeResult.name}</div>
                      <div data-ui="accounts-authlib-injector-modal-div-16" className="text-xs font-mono text-muted-foreground truncate">{probeResult.url}</div>
                    </div>
                  </div>

                  <div data-ui="accounts-authlib-injector-modal-div-17" className="flex items-center gap-2 pt-1 text-success text-xs font-medium">
                    <IconShieldCheck className="w-4 h-4 flex-shrink-0" />
                    <span data-ui="accounts-authlib-injector-modal-span-1">{t("accounts.authlibCompatible", "✓ Совместим с Authlib-Injector")}</span>
                  </div>

                  {probeResult.url.startsWith("http://") && (
                    <div data-ui="accounts-authlib-injector-modal-div-18" className="p-2.5 rounded-lg bg-warning/10 border border-warning/20 flex items-start gap-2 text-xs text-warning">
                      <IconAlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span data-ui="accounts-authlib-injector-modal-span-2">{t("accounts.authlibHttpWarning", "Этот сервер не использует HTTPS. Ваши учётные данные могут передаваться небезопасно.")}</span>
                    </div>
                  )}

                  {Object.keys(probeResult.links).length > 0 && (
                    <div data-ui="accounts-authlib-injector-modal-div-19" className="pt-2 border-t border-border flex flex-wrap items-center justify-center gap-3">
                      {probeResult.links.homepage && (
                        <a data-ui="accounts-authlib-injector-modal-a-1"
                          href={probeResult.links.homepage}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <IconWorld className="w-3.5 h-3.5" />
                          {t("accounts.authlibHomepage", "Главная")}
                        </a>
                      )}
                      {probeResult.links.register && (
                        <a data-ui="accounts-authlib-injector-modal-a-2"
                          href={probeResult.links.register}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <IconExternalLink className="w-3.5 h-3.5" />
                          {t("accounts.authlibRegister", "Регистрация")}
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {probeError && (
                  <div data-ui="accounts-authlib-injector-modal-div-20" className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    {probeError}
                  </div>
                )}

                <div data-ui="accounts-authlib-injector-modal-div-21" className="flex gap-3 pt-2">
                  <button data-ui="accounts-authlib-injector-modal-button-4"
                    onClick={() => {
                      setAddStep("input")
                      setProbeError("")
                    }}
                    disabled={addingServer}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground font-medium text-sm transition-colors"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back", "Назад")}
                  </button>
                  <button data-ui="accounts-authlib-injector-modal-button-5"
                    onClick={handleAddServer}
                    disabled={addingServer}
                    className="flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
                  >
                    {addingServer ? <IconLoader2 className="w-4 h-4 animate-spin" /> : <IconPlus className="w-4 h-4" />}
                    {t("accounts.add", "Добавить")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── VIEW: SELECT PROFILE ── */}
        {view === "select-profile" && (
          <div data-ui="accounts-authlib-injector-modal-div-22" className="space-y-4">
            <p data-ui="accounts-authlib-injector-modal-p-7" className="text-xs text-muted-foreground text-center">
              {t("accounts.authlibSelectProfilePrompt", "На этом аккаунте несколько персонажей. Выберите, под кем играть:")}
            </p>

            <div data-ui="accounts-authlib-injector-modal-div-23" className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {availableProfiles.map((p) => (
                <button data-ui="accounts-authlib-injector-modal-button-6"
                  key={p.id}
                  onClick={() => handleSelectProfile(p)}
                  disabled={loginLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/20 hover:border-primary hover:bg-primary/10 transition-all text-left group"
                >
                  <div data-ui="accounts-authlib-injector-modal-div-24" className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                    {p.textures?.skin?.url ? (
                      <img data-ui="accounts-authlib-injector-modal-img-4" src={p.textures.skin.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <IconUser className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div data-ui="accounts-authlib-injector-modal-div-25" className="flex-1 min-w-0">
                    <div data-ui="accounts-authlib-injector-modal-div-26" className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                      {p.name}
                    </div>
                    <div data-ui="accounts-authlib-injector-modal-div-27" className="text-xs font-mono text-muted-foreground truncate">{p.id}</div>
                  </div>
                  <IconCheck className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>

            {authError && (
              <div data-ui="accounts-authlib-injector-modal-div-28" className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                {authError}
              </div>
            )}

            <button data-ui="accounts-authlib-injector-modal-button-7"
              onClick={() => {
                setView("login")
                setAuthError("")
              }}
              disabled={loginLoading}
              className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
              {t("accounts.back", "Назад")}
            </button>
          </div>
        )}

        {/* ── VIEW: LOGIN ── */}
        {view === "login" && (
          <div data-ui="accounts-authlib-injector-modal-div-29" className="space-y-4">
            {loadingServers ? (
              <div data-ui="accounts-authlib-injector-modal-div-30" className="py-8 flex flex-col items-center justify-center text-center">
                <IconLoader2 className="w-6 h-6 animate-spin text-primary mb-2" />
                <p data-ui="accounts-authlib-injector-modal-p-8" className="text-xs text-muted-foreground">{t("accounts.loading", "Загрузка серверов...")}</p>
              </div>
            ) : servers.length === 0 ? (
              /* No servers configured */
              <div data-ui="accounts-authlib-injector-modal-div-31" className="py-6 text-center space-y-3">
                <div data-ui="accounts-authlib-injector-modal-div-32" className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto text-muted-foreground">
                  <IconWorld className="w-6 h-6" />
                </div>
                <div data-ui="accounts-authlib-injector-modal-div-33">
                  <p data-ui="accounts-authlib-injector-modal-p-9" className="text-sm font-medium text-foreground">
                    {t("accounts.authlibNoServers", "Нет настроенных серверов авторизации")}
                  </p>
                  <p data-ui="accounts-authlib-injector-modal-p-10" className="text-xs text-muted-foreground mt-1">
                    {t("accounts.authlibNoServersDesc", "Добавьте Authlib-Injector совместимый сервер для входа.")}
                  </p>
                </div>
                <button data-ui="accounts-authlib-injector-modal-button-8"
                  onClick={() => {
                    setView("add-server")
                    setAddStep("input")
                    setInputUrl("")
                    setProbeError("")
                  }}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors shadow-lg shadow-primary/20"
                >
                  <IconPlus className="w-4 h-4" />
                  {t("accounts.authlibAddServer", "Добавить сервер авторизации")}
                </button>
              </div>
            ) : (
              /* Normal Login Form */
              <>
                {/* Styled Server Selector with Favicon */}
                <div data-ui="accounts-authlib-injector-modal-div-34" className="relative">
                  <div data-ui="accounts-authlib-injector-modal-div-35" className="flex items-center justify-between mb-1.5">
                    <span data-ui="accounts-authlib-injector-modal-span-3" className="text-xs font-medium text-muted-foreground">
                      {t("accounts.authlibServer", "Сервер авторизации")}
                    </span>
                    <button data-ui="accounts-authlib-injector-modal-button-9"
                      type="button"
                      onClick={() => {
                        setView("add-server")
                        setAddStep("input")
                        setInputUrl("")
                        setProbeError("")
                      }}
                      className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                    >
                      <IconPlus className="w-3.5 h-3.5" />
                      {t("accounts.add", "Добавить")}
                    </button>
                  </div>

                  {/* Server Picker Trigger Card */}
                  <div data-ui="accounts-authlib-injector-modal-div-36"
                    onClick={() => setShowServerPicker(!showServerPicker)}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 transition-all cursor-pointer"
                  >
                    <div data-ui="accounts-authlib-injector-modal-div-37" className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 border border-border/50">
                      {selectedServer?.favicon ? (
                        <img data-ui="accounts-authlib-injector-modal-img-5" src={selectedServer.favicon} alt="" className="w-5 h-5 object-contain" />
                      ) : (
                        <IconWorld className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div data-ui="accounts-authlib-injector-modal-div-38" className="flex-1 min-w-0">
                      <div data-ui="accounts-authlib-injector-modal-div-39" className="font-medium text-sm text-foreground truncate">
                        {selectedServer?.name ?? "Выберите сервер"}
                      </div>
                      <div data-ui="accounts-authlib-injector-modal-div-40" className="text-xs text-muted-foreground truncate font-mono">
                        {selectedServer ? new URL(selectedServer.url).hostname : ""}
                      </div>
                    </div>
                    <IconChevronDown className="w-4 h-4 text-muted-foreground transition-transform" />
                  </div>

                  {/* Server Picker Dropdown */}
                  {showServerPicker && (
                    <div data-ui="accounts-authlib-injector-modal-div-41" className="absolute top-full left-0 right-0 mt-2 p-2 rounded-xl border border-border bg-card shadow-xl z-20 space-y-1 max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                      {servers.map((s) => (
                        <div data-ui="accounts-authlib-injector-modal-div-42"
                          key={s.id}
                          onClick={() => {
                            setSelectedServerId(s.id)
                            setShowServerPicker(false)
                          }}
                          className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${
                            s.id === selectedServerId
                              ? "bg-primary/15 text-primary"
                              : "hover:bg-muted/50 text-foreground"
                          }`}
                        >
                          <div data-ui="accounts-authlib-injector-modal-div-43" className="w-6 h-6 rounded-md bg-muted/60 flex items-center justify-center overflow-hidden flex-shrink-0 border border-border/40">
                            {s.favicon ? (
                              <img data-ui="accounts-authlib-injector-modal-img-6" src={s.favicon} alt="" className="w-4 h-4 object-contain" />
                            ) : (
                              <IconWorld className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                          </div>
                          <div data-ui="accounts-authlib-injector-modal-div-44" className="flex-1 min-w-0 text-left">
                            <div data-ui="accounts-authlib-injector-modal-div-45" className="text-xs font-semibold truncate">{s.name}</div>
                            <div data-ui="accounts-authlib-injector-modal-div-46" className="text-[10px] text-muted-foreground truncate font-mono">
                              {new URL(s.url).hostname}
                            </div>
                          </div>
                          {s.id === selectedServerId && <IconCheck className="w-4 h-4 text-primary" />}
                          {/* Удалять можно и последний сервер: иначе сломанный
                              единственный сервер нельзя убрать из UI. */}
                          <button data-ui="accounts-authlib-injector-modal-button-10"
                            onClick={(e) => handleRemoveServer(s.id, e)}
                            title={t("accounts.removeServer", "Удалить сервер")}
                            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <IconTrash className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Username Input */}
                <div data-ui="accounts-authlib-injector-modal-div-47">
                  <label data-ui="accounts-authlib-injector-modal-label-1" className="text-xs font-medium text-muted-foreground mb-1 block">
                    {selectedServer?.nonEmailLogin
                      ? t("accounts.usernameOrEmail", "Имя пользователя или email")
                      : t("accounts.email", "Email")}
                  </label>
                  <input data-ui="accounts-authlib-injector-modal-input-2"
                    type={selectedServer?.nonEmailLogin ? "text" : "email"}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={selectedServer?.nonEmailLogin ? "Steve" : "player@example.com"}
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 focus:border-primary focus:bg-background transition-all outline-none text-foreground text-sm"
                  />
                </div>

                {/* Password Input */}
                <div data-ui="accounts-authlib-injector-modal-div-48">
                  <label data-ui="accounts-authlib-injector-modal-label-2" className="text-xs font-medium text-muted-foreground mb-1 block">
                    {t("accounts.password", "Пароль")}
                  </label>
                  <input data-ui="accounts-authlib-injector-modal-input-3"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 focus:border-primary focus:bg-background transition-all outline-none text-foreground text-sm"
                  />
                </div>

                {/* HTTP-предупреждение нужно и при входе, а не только при
                    добавлении сервера: учётные данные уходят на тот же хост. */}
                {selectedServer?.url.startsWith("http://") && (
                  <div data-ui="accounts-authlib-injector-modal-div-49" className="p-2.5 rounded-lg bg-warning/10 border border-warning/20 flex items-start gap-2 text-xs text-warning">
                    <IconAlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span data-ui="accounts-authlib-injector-modal-span-4">{t("accounts.authlibHttpWarning", "Этот сервер не использует HTTPS. Ваши учётные данные могут передаваться небезопасно.")}</span>
                  </div>
                )}

                {/* Server Links */}
                {selectedServer && Object.keys(selectedServer.links).length > 0 && (
                  <div data-ui="accounts-authlib-injector-modal-div-50" className="flex flex-wrap items-center justify-center gap-3 pt-1 text-xs">
                    {selectedServer.links.register && (
                      <a data-ui="accounts-authlib-injector-modal-a-3"
                        href={selectedServer.links.register}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 font-medium"
                      >
                        <IconExternalLink className="w-3.5 h-3.5" />
                        {t("accounts.authlibRegister", "Регистрация")}
                      </a>
                    )}
                    {selectedServer.links.homepage && (
                      <a data-ui="accounts-authlib-injector-modal-a-4"
                        href={selectedServer.links.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 font-medium"
                      >
                        <IconWorld className="w-3.5 h-3.5" />
                        {t("accounts.authlibHomepage", "Главная")}
                      </a>
                    )}
                  </div>
                )}

                {authError && (
                  <div data-ui="accounts-authlib-injector-modal-div-51" className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    {authError}
                  </div>
                )}

                {/* Bottom Action Buttons: Back + Login */}
                <div data-ui="accounts-authlib-injector-modal-div-52" className="flex gap-3 pt-2">
                  <button data-ui="accounts-authlib-injector-modal-button-11"
                    onClick={closeModal}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 text-foreground transition-colors font-medium text-sm"
                  >
                    <IconArrowLeft className="w-4 h-4" strokeWidth={1.75} />
                    {t("accounts.back", "Назад")}
                  </button>
                  <button data-ui="accounts-authlib-injector-modal-button-12"
                    onClick={() => handleLogin()}
                    disabled={loginLoading || !username.trim() || !password}
                    className="flex items-center justify-center gap-2 flex-1 px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm transition-colors shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    {loginLoading ? (
                      <IconLoader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <IconLogin className="w-4 h-4" strokeWidth={1.75} />
                    )}
                    {t("accounts.login", "Войти")}
                  </button>
                </div>

                {/* Текущая фаза логина: окно можно закрыть в любой момент. */}
                {loginLoading && (
                  <p data-ui="accounts-authlib-injector-modal-p-11" className="text-xs text-muted-foreground text-center">
                    {loginPhase
                      ? phaseLabel(loginPhase)
                      : t("accounts.authlibChecking", "Проверка сервера...")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </ModalLayer>
  )
}
