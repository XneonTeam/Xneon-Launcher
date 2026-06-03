import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import { IconCamera, IconTrash, IconExternalLink, IconFolderOpen } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MOD_LOADERS, VERSIONS } from "./constants"
import { useMinecraftVersionOptions } from "@/src/hooks/use-minecraft-version-options"
import { useLoaderVersionOptions } from "@/src/hooks/use-loader-version-options"
import type { Build } from "./types"

function formatPlaytime(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`
  const days = Math.floor(hours / 24)
  const hrs = hours % 24
  return hrs > 0 ? `${days} д ${hrs} ч` : `${days} д`
}

interface InstanceDetailGeneralProps {
  activeBuild: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export function InstanceDetailGeneral({ activeBuild, updateBuild, fileInputRef }: InstanceDetailGeneralProps) {
  const { t } = useTranslation()
  const { visibleVersions, versionsLoaded } = useMinecraftVersionOptions()
  const { loaderVersions, loaderVersionsLoaded, recommendedLoaderVersion } = useLoaderVersionOptions(activeBuild.modLoader, activeBuild.version)
  const buildHasImage = !!(activeBuild.icon && (activeBuild.icon.startsWith("data:") || activeBuild.icon.startsWith("http")))
  const availableVersions = visibleVersions.includes(activeBuild.version)
    ? visibleVersions
    : [activeBuild.version, ...visibleVersions.filter((item) => item !== activeBuild.version)]
  const formattedCreatedAt = new Date(activeBuild.createdAt).toLocaleDateString()
  const showLoaderVersionSelect = activeBuild.modLoader !== "vanilla" && activeBuild.modLoader !== "instance"

  useEffect(() => {
    if (!showLoaderVersionSelect) {
      if (activeBuild.loaderVersion) updateBuild(activeBuild.id, { loaderVersion: undefined })
      return
    }

    if (!loaderVersionsLoaded) return
    if (loaderVersions.some(option => option.value === activeBuild.loaderVersion)) return
    updateBuild(activeBuild.id, { loaderVersion: recommendedLoaderVersion || undefined })
  }, [activeBuild.id, activeBuild.loaderVersion, loaderVersions, loaderVersionsLoaded, recommendedLoaderVersion, showLoaderVersionSelect, updateBuild])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-3xl border border-border bg-card/60 p-5">
          <label className="mb-4 block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t("builds.cover")}
          </label>

          <div className="flex flex-col items-center text-center">
            <div
              className="relative flex h-32 w-32 cursor-pointer items-center justify-center overflow-hidden rounded-[28px] border border-border bg-muted/70 transition-colors hover:border-primary/50"
              onClick={() => fileInputRef.current?.click()}
            >
              {buildHasImage ? (
                <img src={activeBuild.icon} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <IconCamera className="h-10 w-10 text-muted-foreground/50" />
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

            <div className="mt-4 text-sm font-medium text-foreground">{activeBuild.name || "Новая сборка"}</div>
            <div className="mt-1 text-xs text-muted-foreground">Нажми на аватарку, чтобы изменить иконку сборки</div>

            {buildHasImage && (
              <button
                type="button"
                onClick={() => updateBuild(activeBuild.id, { icon: "", coverImage: undefined })}
                className="mt-4 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <IconTrash className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("builds.remove")}
              </button>
            )}
          </div>

          <div className="mt-6 grid gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 text-left">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Наиграно</div>
              <div className="mt-1 text-sm text-foreground">{formatPlaytime(activeBuild.playtime ?? 0)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Создана</div>
              <div className="mt-1 text-sm text-foreground">{formattedCreatedAt}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 rounded-3xl border border-border bg-card/40 p-6">
          <div className="grid gap-1">
            <div className="text-xl font-semibold text-foreground">Создание сборки</div>
            <div className="text-sm text-muted-foreground">
              Заполни основные параметры сборки. Интерфейс стал плотнее, а ключевые настройки теперь собраны в одном блоке.
            </div>
          </div>

          <div className="grid gap-5">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.name")}</label>
              <input
                type="text"
                value={activeBuild.name}
                onChange={e => updateBuild(activeBuild.id, { name: e.target.value })}
                className="h-12 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.description")}</label>
              <textarea
                value={activeBuild.description}
                onChange={e => updateBuild(activeBuild.id, { description: e.target.value })}
                rows={5}
                className="w-full rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
              />
            </div>

            <div className={showLoaderVersionSelect ? "grid gap-4 lg:grid-cols-3" : "grid gap-4 lg:grid-cols-2"}>
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.version")}</label>
                <Select value={activeBuild.version} onValueChange={(value) => updateBuild(activeBuild.id, { version: value })}>
                  <SelectTrigger className="h-12 w-full rounded-2xl border-border bg-muted/40 text-foreground">
                    <SelectValue placeholder={versionsLoaded ? t("builds.version") : "Loading..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {(availableVersions.length > 0 ? availableVersions : VERSIONS).map((item) => (
                      <SelectItem key={item} value={item}>Minecraft {item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.modLoader")}</label>
                <Select value={activeBuild.modLoader} onValueChange={(value) => updateBuild(activeBuild.id, { modLoader: value, loaderVersion: undefined })}>
                  <SelectTrigger className="h-12 w-full rounded-2xl border-border bg-muted/40 text-foreground">
                    <SelectValue placeholder={t("builds.modLoader")} />
                  </SelectTrigger>
                  <SelectContent>
                    {MOD_LOADERS.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {showLoaderVersionSelect && (
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Loader Version</label>
                  <Select value={activeBuild.loaderVersion ?? ""} onValueChange={(value) => updateBuild(activeBuild.id, { loaderVersion: value })} disabled={!loaderVersionsLoaded || loaderVersions.length === 0}>
                    <SelectTrigger className="h-12 w-full rounded-2xl border-border bg-muted/40 text-foreground">
                      <SelectValue placeholder={loaderVersionsLoaded ? "Loader Version" : "Loading..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {!loaderVersionsLoaded ? <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
                        : loaderVersions.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">No versions available</div>
                        : loaderVersions.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {!loaderVersionsLoaded ? "Loading available loader versions..." : activeBuild.loaderVersion ? `Current loader version: ${activeBuild.loaderVersion}` : "Choose an exact loader version for this profile"}
                  </p>
                </div>
              )}
            </div>


            {activeBuild.projectSlug && (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                <span className="text-muted-foreground/70">{t("builds.source")}: </span>
                <button
                  type="button"
                  onClick={() => window.open(`https://modrinth.com/modpack/${activeBuild.projectSlug}`, "_blank")}
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <IconExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Modrinth — {activeBuild.projectSlug}
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              {activeBuild.intentPath && (
                <button
                  type="button"
                  onClick={() => window.electronAPI?.openPath(activeBuild.intentPath!)}
                  className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <IconFolderOpen className="h-4 w-4" strokeWidth={1.75} />
                  Открыть папку игры
                </button>
              )}
              <div className="flex items-center rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                {t("builds.created", { date: formattedCreatedAt })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}




