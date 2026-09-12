import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconX,
  IconCheck,
  IconLoader2,
  IconArrowsExchange,
  IconAlertTriangle,
  IconDownload,
  IconSearch,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { LoaderIcon } from "./loader-icon"
import type { ImportProgress } from "@xnlc/types"
import type { Build, ModVersion } from "./types"

interface ModpackChangeVersionDialogProps {
  open: boolean
  onClose: () => void
  build: Build
  onVersionChanged: (newVersionInfo: {
    modpackVersion: string
    modpackVersionId?: string
    version: string
    modLoader: string
    loaderVersion?: string
    mods?: Build["mods"]
    resourcepacks?: Build["resourcepacks"]
    shaders?: Build["shaders"]
  }) => void
}

export function ModpackChangeVersionDialog({
  open,
  onClose,
  build,
  onVersionChanged,
}: ModpackChangeVersionDialogProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<ModVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyProgress, setApplyProgress] = useState<string | null>(null)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [search, setSearch] = useState("")

  // Загружаем список версий модпака
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(null)
    setVersions([])
    setSelectedVersionId(null)

    const fetchVersions = async () => {
      try {
        let list: ModVersion[] = []
        if (build.source === "modrinth" && build.projectSlug) {
          list = (await window.electronAPI?.modsModrinthVersions(build.projectSlug)) ?? []
        } else if (build.source === "curseforge" && build.modId) {
          const details = await window.electronAPI?.modsCurseforgeDetails(build.modId)
          list = details?.versions ?? []
        }
        if (!active) return
        setVersions(list)
      } catch (err: any) {
        if (!active) return
        setError(err?.message || "Не удалось загрузить версии модпака")
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchVersions()
    return () => {
      active = false
    }
  }, [open, build.source, build.projectSlug, build.modId])

  // Слушаем прогресс скачивания/обновления модпака (тот же канал, что и при установке сборки)
  useEffect(() => {
    if (!open) {
      setImportProgress(null)
      return
    }
    const off = window.electronAPI?.onImportProgress?.((progress) => {
      setImportProgress(progress)
    })
    return () => {
      off?.()
    }
  }, [open])

  // Фильтрация версий
  const filteredVersions = useMemo(() => {
    if (!search.trim()) return versions
    const q = search.trim().toLowerCase()
    return versions.filter((v) => {
      const name = (v.name || "").toLowerCase()
      const verNum = (v.versionNumber || "").toLowerCase()
      const mc = (v.gameVersion || "").toLowerCase()
      const loaders = (v.loaders || []).join(" ").toLowerCase()
      return name.includes(q) || verNum.includes(q) || mc.includes(q) || loaders.includes(q)
    })
  }, [versions, search])

  const selectedVersion = useMemo(() => {
    return versions.find((v) => v.id === selectedVersionId)
  }, [versions, selectedVersionId])

  // Применение смены версии модпака
  const handleApply = async () => {
    if (!selectedVersion) return
    setApplying(true)
    setApplyProgress("Подготовка к обновлению модпака...")
    setImportProgress(null)

    try {
      if (build.source === "modrinth" && build.projectSlug) {
        const res = await window.electronAPI?.importModrinthModpack(
          build.name,
          build.projectSlug,
          selectedVersion.id,
          build.id
        )
        if (!res?.success) {
          throw new Error(res?.error || "Ошибка применения версии")
        }
        onVersionChanged({
          modpackVersion: selectedVersion.name || selectedVersion.versionNumber || selectedVersion.id,
          modpackVersionId: selectedVersion.id,
          version: res.version || build.version,
          modLoader: res.modLoader || build.modLoader,
          loaderVersion: res.loaderVersion || build.loaderVersion,
          mods: res.mods,
          resourcepacks: res.resourcepacks,
          shaders: res.shaders,
        })
      } else if (build.source === "curseforge" && build.modId) {
        const fileId = Number(selectedVersion.id)
        const res = await window.electronAPI?.importCurseforgeModpack(
          build.name,
          build.modId,
          fileId,
          build.id
        )
        if (!res?.success) {
          throw new Error(res?.error || "Ошибка применения версии")
        }
        onVersionChanged({
          modpackVersion: selectedVersion.name || selectedVersion.versionNumber || selectedVersion.id,
          version: res.version || build.version,
          modLoader: res.modLoader || build.modLoader,
          loaderVersion: res.loaderVersion || build.loaderVersion,
          mods: res.mods,
          resourcepacks: res.resourcepacks,
          shaders: res.shaders,
        })
      }
      onClose()
    } catch (err: any) {
      setError(err?.message || "Не удалось сменить версию модпака")
    } finally {
      setApplying(false)
      setApplyProgress(null)
    }
  }

  const currentModpackVersion = build.modpackVersion || build.version

  const progressTotal = importProgress?.total ?? 0
  const progressCurrent = importProgress?.current ?? 0
  const progressPercent = progressTotal > 0
    ? Math.max(0, Math.min(100, Math.round((progressCurrent / progressTotal) * 100)))
    : 0
  const applyingVersionLabel = selectedVersion?.name || selectedVersion?.versionNumber || selectedVersion?.id || ""

  return (
    <Dialog open={open} onOpenChange={(v) => !applying && !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-card border-border shadow-2xl">
        <DialogHeader className="p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <IconArrowsExchange className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Сменить версию модпака
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Выберите версию {build.name} для переключения
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 border-b border-border/70 bg-muted/20 flex items-center gap-2">
          <div className="relative flex-1">
            <IconSearch className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по версии Minecraft или названию..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[260px]">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <IconLoader2 className="w-7 h-7 animate-spin text-primary" />
              <span className="text-sm">Загрузка доступных версий...</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl border border-destructive/20 bg-destructive/10 text-destructive text-sm">
              <IconAlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && filteredVersions.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              Версии не найдены
            </div>
          )}

          {!loading &&
            !error &&
            filteredVersions.map((v) => {
              const isCurrent =
                v.name === currentModpackVersion ||
                v.versionNumber === currentModpackVersion ||
                v.id === currentModpackVersion
              const isSelected = v.id === selectedVersionId

              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVersionId(v.id)}
                  disabled={applying}
                  className={cn(
                    "w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3",
                    isSelected
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/60 bg-muted/30 hover:bg-muted/60 hover:border-border"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {v.name || v.versionNumber || v.id}
                      </span>
                      {v.versionType && v.versionType !== "release" && (
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                            v.versionType === "beta"
                              ? "bg-yellow-500/15 text-yellow-500"
                              : "bg-red-500/15 text-red-500"
                          )}
                        >
                          {v.versionType}
                        </span>
                      )}
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-500 flex items-center gap-1">
                          <IconCheck className="w-3 h-3" />
                          Установлена
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                      {v.gameVersion && (
                        <span>{v.gameVersion}</span>
                      )}
                      {v.loaders && v.loaders.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1.5 capitalize">
                            {v.loaders.map((ldr) => (
                              <span key={ldr} className="inline-flex items-center gap-1">
                                <LoaderIcon loaderId={ldr.toLowerCase()} className="w-3.5 h-3.5 shrink-0" />
                                <span>{ldr}</span>
                              </span>
                            ))}
                          </span>
                        </>
                      )}
                      {v.datePublished && (
                        <>
                          <span>•</span>
                          <span>{new Date(v.datePublished).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div>
                    <div
                      className={cn(
                        "w-5 h-5 rounded-full border flex items-center justify-center transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {isSelected && <IconCheck className="w-3 h-3" strokeWidth={3} />}
                    </div>
                  </div>
                </button>
              )
            })}
        </div>

        {applying && (
          <div className="px-4 py-4 border-t border-border bg-muted/5 space-y-2 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <IconDownload className="w-4 h-4 animate-pulse" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {importProgress?.message || applyProgress || "Обновление модпака..."}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {applyingVersionLabel ? `Установка версии ${applyingVersionLabel}` : "Загрузка файлов..."}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-foreground">{progressPercent}%</span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="p-4 border-t border-border flex items-center justify-between bg-card shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Отмена
          </button>

          <button
            type="button"
            onClick={handleApply}
            disabled={!selectedVersion || applying || selectedVersion.name === currentModpackVersion}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm",
              !selectedVersion || selectedVersion.name === currentModpackVersion
                ? "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                : "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-[1.01]"
            )}
          >
            {applying ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                <span>{progressTotal > 0 ? `Обновление ${progressPercent}%` : "Обновление..."}</span>
              </>
            ) : (
              <>
                <IconDownload className="w-4 h-4" />
                <span>Применить версию</span>
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
