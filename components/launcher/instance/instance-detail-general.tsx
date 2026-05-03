import { useTranslation } from "react-i18next"
import { IconCamera, IconTrash, IconExternalLink } from "@tabler/icons-react"
import { MOD_LOADERS, VERSIONS } from "./constants"
import type { Build } from "./types"

interface InstanceDetailGeneralProps {
  activeBuild: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export function InstanceDetailGeneral({ activeBuild, updateBuild, fileInputRef }: InstanceDetailGeneralProps) {
  const { t } = useTranslation()
  const buildHasImage = !!(activeBuild.icon && (activeBuild.icon.startsWith("data:") || activeBuild.icon.startsWith("http")))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid gap-5 max-w-2xl">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">{t("builds.cover")}</label>
          <div className="flex items-center gap-4">
            <div
              className="w-24 h-24 rounded-2xl bg-muted/70 overflow-hidden border border-border cursor-pointer hover:border-primary/50 transition-colors flex-shrink-0 relative"
              onClick={() => fileInputRef.current?.click()}
            >
              {buildHasImage ? (
                <img src={activeBuild.icon} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <IconCamera className="w-8 h-8 text-muted-foreground/50" />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) {
                    const reader = new FileReader()
                    reader.onloadend = () => {
                      if (typeof reader.result === "string") {
                        updateBuild(activeBuild.id, { icon: reader.result })
                      }
                    }
                    reader.readAsDataURL(file)
                  }
                }}
              />
            </div>
            {buildHasImage && (
              <button
                type="button"
                onClick={() => updateBuild(activeBuild.id, { icon: "", coverImage: undefined })}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <IconTrash className="w-3.5 h-3.5" strokeWidth={1.75} />
                {t("builds.remove")}
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t("builds.name")}</label>
          <input
            type="text"
            value={activeBuild.name}
            onChange={e => updateBuild(activeBuild.id, { name: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t("builds.description")}</label>
          <textarea
            value={activeBuild.description}
            onChange={e => updateBuild(activeBuild.id, { description: e.target.value })}
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t("builds.version")}</label>
            <select
              value={activeBuild.version}
              onChange={e => updateBuild(activeBuild.id, { version: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm appearance-none focus:outline-none focus:border-primary"
            >
              {VERSIONS.map(item => (
                <option key={item} value={item}>Minecraft {item}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t("builds.modLoader")}</label>
            <select
              value={activeBuild.modLoader}
              onChange={e => updateBuild(activeBuild.id, { modLoader: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm appearance-none focus:outline-none focus:border-primary"
            >
              {MOD_LOADERS.map(item => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
        </div>

        {activeBuild.projectSlug && (
          <div className="text-sm text-muted-foreground">
            <span className="text-muted-foreground/70">{t("builds.source")}: </span>
            <button
              type="button"
              onClick={() => window.open(`https://modrinth.com/modpack/${activeBuild.projectSlug}`, "_blank")}
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              <IconExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
              Modrinth — {activeBuild.projectSlug}
            </button>
          </div>
        )}

        <div className="text-xs text-muted-foreground/60">
          {t("builds.created", { date: new Date(activeBuild.createdAt).toLocaleDateString() })}
        </div>
      </div>
    </div>
  )
}
