import { useState } from "react"
import { IconLoader2 } from "@tabler/icons-react"

type Props = {
  onClose: () => void
  onConnect: (data: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string; forcePathStyle: string }) => void
  connecting: boolean
}

export function S3SetupModal({ onClose, onConnect, connecting }: Props) {
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
  const selectClass = "w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors appearance-none cursor-pointer"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm mx-4 rounded-2xl bg-card border border-border shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-5">
          <h3 className="text-lg font-semibold text-foreground mb-1">S3 Storage</h3>
          <p className="text-sm text-muted-foreground mb-4">Введите данные вашего S3-хранилища</p>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Endpoint URL</label>
              <input value={endpoint} onChange={e => setEndpoint(e.target.value)}
                placeholder="https://s3.amazonaws.com"
                className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Bucket</label>
              <input value={bucket} onChange={e => setBucket(e.target.value)}
                placeholder="my-bucket"
                className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Access Key ID</label>
              <input value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Secret Access Key</label>
              <input type="password" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Region</label>
                <input value={region} onChange={e => setRegion(e.target.value)}
                  placeholder="us-east-1"
                  className={inputClass} />
              </div>
              <div className="relative">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Path Style</label>
                <select value={forcePathStyle} onChange={e => setForcePathStyle(e.target.value)}
                  className={selectClass}>
                  <option value="true">Path-style</option>
                  <option value="false">Virtual-hosted</option>
                </select>
                <svg className="absolute right-3 top-[calc(50%+6px)] -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-muted/50 hover:bg-muted text-foreground transition-colors">
            Отмена
          </button>
          <button onClick={handleSubmit} disabled={connecting || !endpoint.trim() || !bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-all disabled:opacity-50">
            {connecting && <IconLoader2 className="w-4 h-4 animate-spin" />}
            Подключить
          </button>
        </div>
      </div>
    </div>
  )
}
