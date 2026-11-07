import { ModalCloseButton } from "@/components/ui/modal-close-button"
import { ProviderIcon } from "./provider-icon"
import { ModalTitleIcon } from "@/components/ui/modal-title-icon"
import { IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useState } from "react"
import { IconLoader2, IconLock, IconUser, IconWorld } from "@tabler/icons-react"
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
      <div data-ui="cloud-cloud-webdav-setup-div-1" data-component="web-dav-setup-modal" className="relative w-full max-w-sm mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden">
          <ModalCloseButton className="absolute right-3 top-3 z-10" onClick={onClose} />
        <div data-ui="cloud-cloud-webdav-setup-div-2" className="p-5">
          <h3 data-ui="cloud-cloud-webdav-setup-h3-1" className="flex items-center gap-2 pr-10 text-lg font-semibold text-foreground mb-1"><ModalTitleIcon><ProviderIcon id="webdav" className="size-4" strokeWidth={1.75} /></ModalTitleIcon>WebDAV</h3>
          <p data-ui="cloud-cloud-webdav-setup-p-1" className="text-sm text-muted-foreground mb-4">{t("cloud.webdav.desc")}</p>

          <div data-ui="cloud-cloud-webdav-setup-div-3" className="space-y-3">
            <div data-ui="cloud-cloud-webdav-setup-div-4">
              <label data-ui="cloud-cloud-webdav-setup-label-1" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconWorld className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("cloud.webdav.url")}</label>
              <input data-ui="cloud-cloud-webdav-setup-input-1" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/dav/"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div data-ui="cloud-cloud-webdav-setup-div-5">
              <label data-ui="cloud-cloud-webdav-setup-label-2" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconUser className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("cloud.webdav.login")}</label>
              <input data-ui="cloud-cloud-webdav-setup-input-2" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
            <div data-ui="cloud-cloud-webdav-setup-div-6">
              <label data-ui="cloud-cloud-webdav-setup-label-3" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconLock className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("cloud.webdav.password")}</label>
              <input data-ui="cloud-cloud-webdav-setup-input-3" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
          </div>
        </div>
        <div data-ui="cloud-cloud-webdav-setup-div-7" className="p-3 border-t border-border flex justify-end gap-2">
          <button data-ui="cloud-cloud-webdav-setup-button-1" onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-muted/50 px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            {<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t("common.cancel")}</span>}
          </button>
          <button data-ui="cloud-cloud-webdav-setup-button-2" onClick={handleSubmit} disabled={connecting || !url.trim() || !username.trim() || !password.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
            {connecting ? <IconLoader2 className="w-4 h-4 shrink-0 animate-spin text-primary-foreground" /> : <ProviderIcon id="webdav" className="size-4 shrink-0 text-primary-foreground" strokeWidth={1.75} />}
            {t("cloud.connect")}
          </button>
        </div>
      </div>
    </ModalLayer>
  )
}
