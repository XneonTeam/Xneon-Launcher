import { useState } from "react"
import { IconLoader2 } from "@tabler/icons-react"
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
      <div data-ui="cloud-cloud-s3-setup-div-1" data-component="s3-setup-modal" className="w-full max-w-sm mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden">
        <div data-ui="cloud-cloud-s3-setup-div-2" className="p-5">
          <h3 data-ui="cloud-cloud-s3-setup-h3-1" className="text-lg font-semibold text-foreground mb-1">S3 Storage</h3>
          <p data-ui="cloud-cloud-s3-setup-p-1" className="text-sm text-muted-foreground mb-4">{t("cloud.s3.desc")}</p>

          <div data-ui="cloud-cloud-s3-setup-div-3" className="space-y-3">
            <div data-ui="cloud-cloud-s3-setup-div-4">
              <label data-ui="cloud-cloud-s3-setup-label-1" className="text-xs font-medium text-muted-foreground mb-1 block">Endpoint URL</label>
              <input data-ui="cloud-cloud-s3-setup-input-1" value={endpoint} onChange={e => setEndpoint(e.target.value)}
                placeholder="https://s3.amazonaws.com"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-5">
              <label data-ui="cloud-cloud-s3-setup-label-2" className="text-xs font-medium text-muted-foreground mb-1 block">Bucket</label>
              <input data-ui="cloud-cloud-s3-setup-input-2" value={bucket} onChange={e => setBucket(e.target.value)}
                placeholder="my-bucket"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-6">
              <label data-ui="cloud-cloud-s3-setup-label-3" className="text-xs font-medium text-muted-foreground mb-1 block">Access Key ID</label>
              <input data-ui="cloud-cloud-s3-setup-input-3" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-7">
              <label data-ui="cloud-cloud-s3-setup-label-4" className="text-xs font-medium text-muted-foreground mb-1 block">Secret Access Key</label>
              <input data-ui="cloud-cloud-s3-setup-input-4" type="password" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                className={inputClass} />
            </div>
            <div data-ui="cloud-cloud-s3-setup-div-8" className="grid grid-cols-2 gap-3">
              <div data-ui="cloud-cloud-s3-setup-div-9">
                <label data-ui="cloud-cloud-s3-setup-label-5" className="text-xs font-medium text-muted-foreground mb-1 block">Region</label>
                <input data-ui="cloud-cloud-s3-setup-input-5" value={region} onChange={e => setRegion(e.target.value)}
                  placeholder="us-east-1"
                  className={inputClass} />
              </div>
              <div data-ui="cloud-cloud-s3-setup-div-10">
                <label data-ui="cloud-cloud-s3-setup-label-6" className="text-xs font-medium text-muted-foreground mb-1 block">Path Style</label>
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
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors">
            {t("common.cancel")}
          </button>
          <button data-ui="cloud-cloud-s3-setup-button-2" onClick={handleSubmit} disabled={connecting || !endpoint.trim() || !bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-all disabled:opacity-50">
            {connecting && <IconLoader2 className="w-4 h-4 animate-spin" />}
            {t("cloud.connect")}
          </button>
        </div>
      </div>
    </ModalLayer>
  )
}
