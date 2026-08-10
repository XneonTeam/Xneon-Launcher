import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconNetwork, IconX, IconLoader2 } from "@tabler/icons-react"

const eapi = typeof window !== "undefined" ? window.electronAPI : undefined

export function NetworkAuthModal({ isOpen, onClose, onSuccess }: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!eapi) return
    setLoading(true)
    setError("")
    try {
      const res = mode === "login"
        ? await eapi.p2pLogin(login, password)
        : await eapi.p2pRegister(login, password)
      if (!res.success) throw new Error(res.error || "Error")
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-card border border-border p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <IconX className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconNetwork className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">
              {mode === "login" ? "Вход" : "Регистрация"}
            </h3>
            <p className="text-sm text-muted-foreground">{t("network.noXnAccountDesc")}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("network.login")}</label>
            <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder={t("network.enterLogin")} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("network.password")}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4}
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder="••••" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all disabled:opacity-50">
            {loading ? <IconLoader2 className="w-5 h-5 animate-spin mx-auto" /> : (mode === "login" ? "Войти" : "Зарегистрироваться")}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "login" ? "Нет аккаунта? " : "Уже есть аккаунт? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError("") }} className="text-primary hover:underline font-medium">
            {mode === "login" ? "Зарегистрироваться" : "Войти"}
          </button>
        </p>
      </div>
    </div>
  )
}

export function NetworkCreateModal({ isOpen, onClose, onSubmit, name, setName, password, setPassword, loading, error }: {
  isOpen: boolean
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  name: string
  setName: (v: string) => void
  password: string
  setPassword: (v: string) => void
  loading: boolean
  error: string
}) {
  const { t } = useTranslation()
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-card border border-border p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <IconX className="w-5 h-5 text-muted-foreground" />
        </button>
        <h3 className="text-lg font-semibold text-foreground mb-4">{t("network.createNetwork")}</h3>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("network.networkName")}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder={t("network.enterNetworkName")} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
              {t("network.password")} <span className="text-xs text-muted-foreground/70">(optional)</span>
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder={t("network.enterPassword")} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground font-medium transition-all">
              {t("network.cancel")}
            </button>
            <button type="submit" disabled={loading || !name.trim()}
              className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all disabled:opacity-50">
              {loading ? <IconLoader2 className="w-5 h-5 animate-spin mx-auto" /> : t("network.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function NetworkJoinModal({ isOpen, onClose, onSubmit, name, setName, password, setPassword, loading, error }: {
  isOpen: boolean
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  name: string
  setName: (v: string) => void
  password: string
  setPassword: (v: string) => void
  loading: boolean
  error: string
}) {
  const { t } = useTranslation()
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-card border border-border p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <IconX className="w-5 h-5 text-muted-foreground" />
        </button>
        <h3 className="text-lg font-semibold text-foreground mb-4">{t("network.joinNetwork")}</h3>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("network.networkName")}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder={t("network.enterNetworkName")} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">{t("network.password")}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder="••••" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground font-medium transition-all">
              {t("network.cancel")}
            </button>
            <button type="submit" disabled={loading || !name.trim()}
              className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all disabled:opacity-50">
              {loading ? <IconLoader2 className="w-5 h-5 animate-spin mx-auto" /> : t("network.join")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
