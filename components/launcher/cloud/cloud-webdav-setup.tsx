import { useState } from "react"
import { IconLoader2 } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import { ModalLayer } from "@/components/ui/modal-layer"

type Props = {
  onClose: () => void
  onConnect: (url: string, username: string, password: string) => void
  connecting: boolean
}

export function WebDavSetupModal({ onClose, onConnect, connecting }: Props) {
  const { t } = useTranslation()
  const [url, setUrl] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = () => {
    if (!url.trim() || !username.trim() || !password.trim()) return
    onConnect(url.trim(), username.trim(), password.trim())
  }

  return (
    <ModalLayer windowId="cloud-cloud-webdav-setup-window-1" onClose={onClose} className="bg-black/50">
      <div data-ui="cloud-cloud-webdav-setup-div-1" data-component="web-dav-setup-modal" className="w-full max-w-sm mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden">
        <div data-ui="cloud-cloud-webdav-setup-div-2" className="p-5">
          <h3 data-ui="cloud-cloud-webdav-setup-h3-1" className="text-lg font-semibold text-foreground mb-1">WebDAV</h3>
          <p data-ui="cloud-cloud-webdav-setup-p-1" className="text-sm text-muted-foreground mb-4">{t("cloud.webdav.desc")}</p>

          <div data-ui="cloud-cloud-webdav-setup-div-3" className="space-y-3">
            <div data-ui="cloud-cloud-webdav-setup-div-4">
              <label data-ui="cloud-cloud-webdav-setup-label-1" className="text-xs font-medium text-muted-foreground mb-1 block">{t("cloud.webdav.url")}</label>
              <input data-ui="cloud-cloud-webdav-setup-input-1" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/dav/"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div data-ui="cloud-cloud-webdav-setup-div-5">
              <label data-ui="cloud-cloud-webdav-setup-label-2" className="text-xs font-medium text-muted-foreground mb-1 block">{t("cloud.webdav.login")}</label>
              <input data-ui="cloud-cloud-webdav-setup-input-2" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div data-ui="cloud-cloud-webdav-setup-div-6">
              <label data-ui="cloud-cloud-webdav-setup-label-3" className="text-xs font-medium text-muted-foreground mb-1 block">{t("cloud.webdav.password")}</label>
              <input data-ui="cloud-cloud-webdav-setup-input-3" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
          </div>
        </div>
        <div data-ui="cloud-cloud-webdav-setup-div-7" className="p-3 border-t border-border flex justify-end gap-2">
          <button data-ui="cloud-cloud-webdav-setup-button-1" onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors">
            {t("common.cancel")}
          </button>
          <button data-ui="cloud-cloud-webdav-setup-button-2" onClick={handleSubmit} disabled={connecting || !url.trim() || !username.trim() || !password.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-all disabled:opacity-50">
            {connecting && <IconLoader2 className="w-4 h-4 animate-spin" />}
            {t("cloud.connect")}
          </button>
        </div>
      </div>
    </ModalLayer>
  )
}
