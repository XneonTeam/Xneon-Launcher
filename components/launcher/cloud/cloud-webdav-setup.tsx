import { useState } from "react"
import { IconLoader2 } from "@tabler/icons-react"

type Props = {
  onClose: () => void
  onConnect: (url: string, username: string, password: string) => void
  connecting: boolean
}

export function WebDavSetupModal({ onClose, onConnect, connecting }: Props) {
  const [url, setUrl] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = () => {
    if (!url.trim() || !username.trim() || !password.trim()) return
    onConnect(url.trim(), username.trim(), password.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-5">
          <h3 className="text-lg font-semibold text-foreground mb-1">WebDAV</h3>
          <p className="text-sm text-muted-foreground mb-4">Введите данные вашего WebDAV-сервера</p>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">URL сервера</label>
              <input value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/dav/"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Логин</label>
              <input value={username} onChange={e => setUsername(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Пароль</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
          </div>
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors">
            Отмена
          </button>
          <button onClick={handleSubmit} disabled={connecting || !url.trim() || !username.trim() || !password.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-all disabled:opacity-50">
            {connecting && <IconLoader2 className="w-4 h-4 animate-spin" />}
            Подключить
          </button>
        </div>
      </div>
    </div>
  )
}
