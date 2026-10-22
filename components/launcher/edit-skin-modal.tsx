import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { ModalLayer } from "@/components/ui/modal-layer"
import { SkinViewer3D } from "@/components/ui/skin-viewer-3d"
import { batchRenderCapes } from "@/lib/batch-cape-renderer"
import { localFileToBlobUrl } from "@/lib/local-file-url"
import {
  IconUpload, IconLoader2, IconX, IconCheck, IconShirt,
} from "@tabler/icons-react"
import type { McProfile, LibrarySkin } from "@xnlc/types"

interface EditSkinModalProps {
  open: boolean
  onClose: () => void
  skin: LibrarySkin | null
  capes: McProfile["capes"]
  activeCapeId: string | null
  onSave: (params: { filePath?: string; variant: "classic" | "slim"; capeId: string | null }) => Promise<void>
}

export function EditSkinModal({ open, onClose, skin, capes, activeCapeId, onSave }: EditSkinModalProps) {
  const { t } = useTranslation()
  const [variant, setVariant] = useState<"classic" | "slim">("classic")
  const [selectedCapeId, setSelectedCapeId] = useState<string | null>(activeCapeId)
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [capePreviews, setCapePreviews] = useState<Map<string, string>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (skin) {
      setVariant(skin.variant === "slim" ? "slim" : "classic")
      setPendingFile(null)
      localFileToBlobUrl(skin.filePath).then(url => {
        if (url) setPreviewUrl(url)
      })
    } else {
      setPreviewUrl("")
      setPendingFile(null)
    }
    setSelectedCapeId(activeCapeId)
  }, [skin, activeCapeId, open])

  // Batch render capes when modal opens
  useEffect(() => {
    if (!open || capes.length === 0) return
    let cancelled = false
    const jobs = capes.filter(c => c.url).map(c => ({ id: c.id, url: c.url! }))
    batchRenderCapes(jobs).then(map => {
      if (!cancelled) setCapePreviews(map)
    })
    return () => { cancelled = true }
  }, [open, capes])

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".png")) return
    setPendingFile(file)
    const dataUrl = URL.createObjectURL(file)
    setPreviewUrl(dataUrl)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }, [processFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      let filePath: string | undefined
      if (pendingFile && window.electronAPI) {
        filePath = window.electronAPI.getFilePath(pendingFile)
      }
      await onSave({ filePath, variant, capeId: selectedCapeId })
      onClose()
    } finally {
      setSaving(false)
    }
  }, [pendingFile, variant, selectedCapeId, onSave, onClose])

  const selectedCape = capes.find(c => c.id === selectedCapeId)
  // Плащ показываем всегда: смена текстуры скина не должна его скрывать
  const displayCapeUrl = selectedCape?.url

  if (!open) return null

  return (
    <ModalLayer windowId="edit-skin-modal-window-1" onClose={onClose} className="z-50">
      <div data-ui="edit-skin-modal-div-1" data-component="edit-skin-modal" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div data-ui="edit-skin-modal-div-2" data-component="edit-skin-modal" className="relative z-10 w-full max-w-3xl max-h-[85vh] mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <input data-ui="edit-skin-modal-input-1"
          ref={fileInputRef}
          type="file"
          accept=".png"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Header */}
        <div data-ui="edit-skin-modal-div-3" className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 data-ui="edit-skin-modal-h2-1" className="text-lg font-bold text-foreground">
            {skin ? t("skins.editSkin") : t("skins.addSkin")}
          </h2>
          <button data-ui="edit-skin-modal-button-1" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div data-ui="edit-skin-modal-div-4" className="flex gap-6 p-6 overflow-y-auto max-h-[calc(85vh-130px)]">
          {/* Left — 3D preview */}
          <div data-ui="edit-skin-modal-div-5" className="flex-shrink-0 w-64 h-[25rem] flex items-center justify-center rounded-xl bg-muted/30 border border-border overflow-hidden">
            {previewUrl ? (
              <SkinViewer3D
                skinUrl={previewUrl}
                capeUrl={displayCapeUrl}
                slim={variant === "slim"}
                width={256}
                height={400}
              />
            ) : (
              <svg data-ui="edit-skin-modal-svg-1" data-icon="edit-skin-modal-svg-1" viewBox="0 0 60 80" fill="none" className="w-16 h-[85px] text-muted-foreground">
                <rect data-ui="edit-skin-modal-rect-1" x="18" y="2" width="24" height="24" rx="2" className="stroke-current opacity-25" strokeWidth="1.5" />
                <rect data-ui="edit-skin-modal-rect-2" x="23" y="12" width="4" height="3" rx="0.5" className="fill-current opacity-10" />
                <rect data-ui="edit-skin-modal-rect-3" x="33" y="12" width="4" height="3" rx="0.5" className="fill-current opacity-10" />
                <rect data-ui="edit-skin-modal-rect-4" x="18" y="28" width="24" height="24" rx="2" className="stroke-current opacity-20" strokeWidth="1.5" />
                <rect data-ui="edit-skin-modal-rect-5" x="6" y="28" width="10" height="24" rx="2" className="stroke-current opacity-15" strokeWidth="1.5" />
                <rect data-ui="edit-skin-modal-rect-6" x="44" y="28" width="10" height="24" rx="2" className="stroke-current opacity-15" strokeWidth="1.5" />
                <rect data-ui="edit-skin-modal-rect-7" x="18" y="54" width="11" height="24" rx="2" className="stroke-current opacity-18" strokeWidth="1.5" />
                <rect data-ui="edit-skin-modal-rect-8" x="31" y="54" width="11" height="24" rx="2" className="stroke-current opacity-18" strokeWidth="1.5" />
              </svg>
            )}
          </div>

          {/* Right — controls */}
          <div data-ui="edit-skin-modal-div-6" className="flex-1 flex flex-col gap-5 min-w-0">
            {/* Texture section — drop zone */}
            <section data-ui="edit-skin-modal-section-1">
              <h3 data-ui="edit-skin-modal-h3-1" className="text-sm font-semibold text-foreground mb-2">{t("skins.texture")}</h3>
              <div data-ui="edit-skin-modal-div-7"
                className={cn(
                  "flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer",
                  dragOver
                    ? "border-primary bg-primary/10 scale-[1.01]"
                    : "border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-muted/30"
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload className={cn("w-5 h-5 transition-colors", dragOver ? "text-primary" : "text-muted-foreground")} />
                <span data-ui="edit-skin-modal-span-1" className="text-sm text-muted-foreground">
                  {pendingFile
                    ? pendingFile.name
                    : t("skins.replaceTexture")}
                </span>
                <span data-ui="edit-skin-modal-span-2" className="text-xs text-primary font-medium">{t("skins.dragDropHint")}</span>
              </div>
            </section>

            {/* Arm style */}
            <section data-ui="edit-skin-modal-section-2">
              <h3 data-ui="edit-skin-modal-h3-2" className="text-sm font-semibold text-foreground mb-2">{t("skins.armStyle")}</h3>
              <div data-ui="edit-skin-modal-div-8" className="flex gap-2">
                {(["classic", "slim"] as const).map(v => (
                  <button data-ui="edit-skin-modal-button-2"
                    key={v}
                    onClick={() => setVariant(v)}
                    className={cn(
                      "flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all",
                      variant === v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v === "classic" ? t("skins.wide") : t("skins.slim")}
                  </button>
                ))}
              </div>
            </section>

            {/* Cape section */}
            <section data-ui="edit-skin-modal-section-3">
              <h3 data-ui="edit-skin-modal-h3-3" className="text-sm font-semibold text-foreground mb-2">{t("skins.capes")}</h3>
              <div data-ui="edit-skin-modal-div-9" className="flex flex-wrap gap-2 max-h-60 overflow-y-auto">
                <button data-ui="edit-skin-modal-button-3"
                  onClick={() => setSelectedCapeId(null)}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl border-2 cursor-pointer transition-all duration-200 shrink-0",
                    !selectedCapeId
                      ? "border-primary shadow-[0_0_8px_2px_var(--glow-primary)]"
                      : "border-border/60 hover:border-border"
                  )}
                  style={{ width: 76, height: 116 }}
                  title={t("skins.none")}
                >
                  <IconX className="w-5 h-5 text-muted-foreground" />
                  <span data-ui="edit-skin-modal-span-3" className="text-[10px] text-muted-foreground mt-1">{t("skins.none")}</span>
                </button>
                {capes.map(cape => {
                  const previewDataUrl = capePreviews.get(cape.id)
                  return (
                    <button data-ui="edit-skin-modal-button-4"
                      key={cape.id}
                      onClick={() => setSelectedCapeId(cape.id)}
                      className={cn(
                        "relative rounded-xl border-2 cursor-pointer transition-all duration-200 shrink-0 overflow-hidden",
                        selectedCapeId === cape.id
                          ? "border-primary shadow-[0_0_8px_2px_var(--glow-primary)]"
                          : "border-border/60 hover:border-border"
                      )}
                      style={{ width: 76, height: 116 }}
                      title={cape.alias ?? cape.id.slice(0, 8)}
                    >
                      {previewDataUrl ? (
                        <img data-ui="edit-skin-modal-img-1"
                          src={previewDataUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain"
                          draggable={false}
                        />
                      ) : cape.url ? (
                        <div data-ui="edit-skin-modal-div-10" className="w-full h-full flex items-center justify-center">
                          <IconLoader2 className="w-4 h-4 text-primary animate-spin" />
                        </div>
                      ) : (
                        <div data-ui="edit-skin-modal-div-11" className="w-full h-full flex items-center justify-center">
                          <IconShirt className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div data-ui="edit-skin-modal-div-12" className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button data-ui="edit-skin-modal-button-5"
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button data-ui="edit-skin-modal-button-6"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? <IconLoader2 className="w-4 h-4 animate-spin" /> : <IconCheck className="w-4 h-4" />}
            {t("skins.save")}
          </button>
        </div>
      </div>
    </ModalLayer>
  )
}
