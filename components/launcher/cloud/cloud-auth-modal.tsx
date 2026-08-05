import { createPortal } from "react-dom"
import { useState } from "react"
import { IconLoader2, IconLock, IconX } from "@tabler/icons-react"
import { cloudApiLogin, cloudApiRegister, setCloudToken } from "./api"

interface CloudAuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CloudAuthModal({ isOpen, onClose, onSuccess }: CloudAuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [loginInput, setLoginInput] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      if (mode === "login") {
        const result = await cloudApiLogin(loginInput, password)
        if (!result.success) throw new Error(result.error || "Ошибка авторизации")
        if (!result.token) throw new Error("Токен не получен")
        await setCloudToken(result.token)
      } else {
        const result = await cloudApiRegister(loginInput, password, email || undefined)
        if (!result.success) throw new Error(result.error || "Ошибка регистрации")
        setMode("login")
        setError("Регистрация успешна. Войдите.")
        return
      }
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-card border border-border p-6 shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <IconX className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <IconLock className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">{mode === "login" ? "Вход в аккаунт" : "Регистрация"}</h3>
            <p className="text-sm text-muted-foreground">Для доступа к облачному хранилищу</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Имя пользователя</label>
            <input type="text" value={loginInput} onChange={e => setLoginInput(e.target.value)} required
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder="Введите имя пользователя" />
          </div>
          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">Email <span className="text-xs text-muted-foreground/70">(опционально)</span></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
                placeholder="user@example.com" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">Пароль</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
              placeholder="••••••••" />
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
    </div>,
    document.body
  )
}
