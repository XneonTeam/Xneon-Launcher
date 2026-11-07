import { ModalCloseButton } from "@/components/ui/modal-close-button"
import { ProviderIcon } from "./provider-icon"
import { ModalTitleIcon } from "@/components/ui/modal-title-icon"
import { IconX as LauncherCancelIcon } from "@tabler/icons-react"
import { useState } from "react"
import { IconLoader2, IconDatabase, IconKey, IconLock, IconMapPin, IconRoute, IconWorld } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { ModalLayer } from "@/components/ui/modal-layer"

type Props = {
  onClose: () => void
  onConnect: (data: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string; forcePathStyle: string }) => void
  connecting: boolean
}

export function S3SetupModal({ onClose, onConnect, connecting }: Props) {
  const { t } = useTranslation()
  const [endpoint, setEndpoint] = useState("")
  const [bucket, setBucket] = useState("")
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [region, setRegion] = useState("us-east-1")
  const [forcePathStyle, setForcePathStyle] = useState("true")

  const handleSubmit = () => {
    if (!endpoint.trim() || !bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) return
    onConnect({ endpoint: endpoint.trim(), bucket: bucket.trim(), accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), region: region.trim() || "us-east-1", forcePathStyle })
  }

  const inputClass = "w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"

  return (
    <ModalLayer windowId="cloud-cloud-s3-setup-window-1" onClose={onClose} className="bg-black/50">
      <div data-ui="cloud-cloud-s3-setup-div-1" data-component="s3-setup-modal" className="relative w-full max-w-sm mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden">
          <ModalCloseButton className="absolute right-3 top-3 z-10" onClick={onClose} />
        <div data-ui="cloud-cloud-s3-setup-div-2" className="p-5">
          <h3 data-ui="cloud-cloud-s3-setup-h3-1" className="flex items-center gap-2 pr-10 text-lg font-semibold text-foreground mb-1"><ModalTitleIcon><ProviderIcon id="s3" className="size-4" strokeWidth={1.75} /></ModalTitleIcon>S3 Storage</h3>
          <p data-ui="cloud-cloud-s3-setup-p-1" className="text-sm text-muted-foreground mb-4">{t("cloud.s3.desc")}</p>

          <div data-ui="cloud-cloud-s3-setup-div-3" className="space-y-3">
            <div data-ui="cloud-cloud-s3-setup-div-4">
              <label data-ui="cloud-cloud-s3-setup-label-1" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconWorld className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />Endpoint URL</label>
              <input data-ui="cloud-cloud-s3-setup-input-1" value={endpoint} onChange={e => setEndpoint(e.target.value)}
                placeholder="https://s3.amazonaws.com"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-5">
              <label data-ui="cloud-cloud-s3-setup-label-2" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconDatabase className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />Bucket</label>
              <input data-ui="cloud-cloud-s3-setup-input-2" value={bucket} onChange={e => setBucket(e.target.value)}
                placeholder="my-bucket"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-6">
              <label data-ui="cloud-cloud-s3-setup-label-3" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconKey className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />Access Key ID</label>
              <input data-ui="cloud-cloud-s3-setup-input-3" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-7">
              <label data-ui="cloud-cloud-s3-setup-label-4" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconLock className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />Secret Access Key</label>
              <input data-ui="cloud-cloud-s3-setup-input-4" type="password" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-8" className="grid grid-cols-2 gap-3">
              <div data-ui="cloud-cloud-s3-setup-div-9">
                <label data-ui="cloud-cloud-s3-setup-label-5" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconMapPin className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />Region</label>
                <input data-ui="cloud-cloud-s3-setup-input-5" value={region} onChange={e => setRegion(e.target.value)}
                  placeholder="us-east-1"
                  className={inputClass} />
              </div>
              <div data-ui="cloud-cloud-s3-setup-div-10">
                <label data-ui="cloud-cloud-s3-setup-label-6" className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1"><IconRoute className="size-3.5 text-primary" strokeWidth={1.75} aria-hidden="true" />Path Style</label>
                <Select value={forcePathStyle} onValueChange={setForcePathStyle}>
                  <SelectTrigger className="w-full rounded-xl bg-muted/50 border-border text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Path-style</SelectItem>
                    <SelectItem value="false">Virtual-hosted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        <div data-ui="cloud-cloud-s3-setup-div-11" className="p-3 border-t border-border flex justify-end gap-2">
          <button data-ui="cloud-cloud-s3-setup-button-1" onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-muted/50 px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            {<span className="inline-flex items-center justify-center gap-2"><LauncherCancelIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />{t("common.cancel")}</span>}
          </button>
          <button data-ui="cloud-cloud-s3-setup-button-2" onClick={handleSubmit} disabled={connecting || !endpoint.trim() || !bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
            {connecting ? <IconLoader2 className="w-4 h-4 shrink-0 animate-spin text-primary-foreground" /> : <ProviderIcon id="s3" className="size-4 shrink-0 text-primary-foreground" strokeWidth={1.75} />}
            {t("cloud.connect")}
          </button>
        </div>
      </div>
    </ModalLayer>
  )
}
