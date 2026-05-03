import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCamera, IconPlus, IconX, IconTrash } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogTrigger } from "@/components/ui/dialog"
import { VERSIONS, MOD_LOADERS } from "./constants"

interface InstanceCreateDialogProps {
  open: boolean
  setOpen: (v: boolean) => void
  onCreate: (params: { name: string; description: string; version: string; modLoader: string; icon: string }) => Promise<void>
}

export function InstanceCreateDialog({ open, setOpen, onCreate }: InstanceCreateDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [version, setVersion] = useState(VERSIONS[0])
  const [modLoader, setModLoader] = useState(MOD_LOADERS[0].id)
  const [icon, setIcon] = useState("")
  const formFileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => { setName(""); setDescription(""); setVersion(VERSIONS[0]); setModLoader(MOD_LOADERS[0].id); setIcon("") }

  const handleCreate = async () => {
    await onCreate({ name, description, version, modLoader, icon })
    reset()
    setOpen(false)
  }

  const iconHasImage = icon && (icon.startsWith("data:") || icon.startsWith("http"))

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <button type="button" onClick={() => { setOpen(true); reset() }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90">
          <IconPlus className="w-4 h-4" strokeWidth={1.75} />
          {t("builds.createBuild")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("builds.creatingBuild")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-3">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-xl bg-muted/70 overflow-hidden border border-border cursor-pointer hover:border-primary/50 transition-colors flex-shrink-0 flex items-center justify-center"
              onClick={() => formFileInputRef.current?.click()}
            >
              {iconHasImage ? <img src={icon} alt="" className="w-full h-full object-cover" /> : <IconCamera className="w-6 h-6 text-muted-foreground" />}
              <input ref={formFileInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) {
                    const reader = new FileReader()
                    reader.onloadend = () => { if (typeof reader.result === "string") setIcon(reader.result) }
                    reader.readAsDataURL(file)
                  }
                }}
              />
            </div>
            {iconHasImage && (
              <button type="button" onClick={() => setIcon("")} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <IconTrash className="w-3.5 h-3.5" strokeWidth={1.75} />
                {t("builds.remove")}
              </button>
            )}
          </div>
          <input type="text" value={name} onChange={e => setName(e.target.value)}           placeholder={t("builds.name")} className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder={t("builds.description")} className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
          <div className="grid grid-cols-2 gap-3">
            <select value={version} onChange={e => setVersion(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm appearance-none focus:outline-none focus:border-primary">
              {VERSIONS.map(v => <option key={v} value={v}>Minecraft {v}</option>)}
            </select>
            <select value={modLoader} onChange={e => setModLoader(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm appearance-none focus:outline-none focus:border-primary">
              {MOD_LOADERS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            {t("settings.cancel")}
          </DialogClose>
          <button type="button" onClick={handleCreate} disabled={!name.trim()} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
            <IconPlus className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.createBuild")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
