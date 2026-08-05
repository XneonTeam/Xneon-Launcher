import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { IconLoader2, IconX } from "@tabler/icons-react"
import { LoaderIcon } from "@/components/launcher/instance/loader-icon"
import type { LocalBuild } from "./types"

const MOD_LOADERS = [
  { id: "vanilla", name: "Vanilla", dot: "bg-zinc-400" },
  { id: "fabric", name: "Fabric", dot: "bg-yellow-500" },
  { id: "quilt", name: "Quilt", dot: "bg-purple-500" },
  { id: "neoforge", name: "NeoForge", dot: "bg-orange-500" },
]

interface CloudBuildUploadModalProps {
  localBuilds: LocalBuild[]
  uploadingBuild: string | null
  buildUploadProgress: number
  onClose: () => void
  onUpload: (build: LocalBuild) => void
}

export function CloudBuildUploadModal({ localBuilds, uploadingBuild, buildUploadProgress, onClose, onUpload }: CloudBuildUploadModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 rounded-2xl bg-card border border-border p-6 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <IconX className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="mb-4">
          <h3 className="text-xl font-semibold text-foreground">Выбор сборки</h3>
          <p className="text-sm text-muted-foreground">Выберите локальную сборку для загрузки в облако</p>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {localBuilds.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Локальные сборки не найдены</div>
          ) : (
            localBuilds.map(build => {
              const loader = MOD_LOADERS.find(l => l.id === build.modLoader) ?? MOD_LOADERS[0]
              return (
                <button
                  key={build.id}
                  type="button"
                  disabled={!!uploadingBuild}
                  onClick={() => onUpload(build)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40 transition-all text-left disabled:opacity-60 disabled:cursor-wait group"
                >
                  <div className="w-14 h-14 rounded-xl bg-muted/70 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {build.icon && <img src={build.icon} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">{build.name}</p>
                    {build.description && <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-1">{build.description}</p>}
                    <div className="flex items-center gap-1.5 mt-1">
                      <LoaderIcon loaderId={build.modLoader} className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-[11px] text-muted-foreground">{loader.name} · MC {build.version}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-primary flex-shrink-0">
                    {uploadingBuild === build.name ? (
                      <><IconLoader2 className="w-4 h-4 animate-spin" />{buildUploadProgress}%</>
                    ) : "Загрузить"}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
