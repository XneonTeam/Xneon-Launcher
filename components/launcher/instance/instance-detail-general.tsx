import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import {
  IconCamera,
  IconTrash,
  IconExternalLink,
  IconFolderOpen,
  IconLock,
  IconLockOpen,
  IconArrowsExchange,
  IconTools,
  IconUnlink,
  IconLink,
  IconLoader2,
  IconCheck,
} from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MOD_LOADERS } from "./constants"
import { LoaderIcon } from "./loader-icon"
import { IconPickerModal } from "./icon-picker-modal"
import { PlatformBadge } from "@/components/launcher/platform-icon"
import { ModpackChangeVersionDialog } from "./modpack-change-version-dialog"
import { ActionConfirmDialog } from "./action-confirm-dialog"
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
  renameBuild: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>
}

export function InstanceDetailGeneral({ activeBuild, updateBuild, renameBuild }: InstanceDetailGeneralProps) {
  const { t } = useTranslation()
  const savedNameRef = useRef(activeBuild.name)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const { visibleVersions, versionsLoaded } = useMinecraftVersionOptions()
  const { loaderVersions, loaderVersionsLoaded, recommendedLoaderVersion } = useLoaderVersionOptions(activeBuild.modLoader, activeBuild.version)
  const buildHasImage = !!activeBuild.icon
  const availableVersions = visibleVersions.includes(activeBuild.version)
    ? visibleVersions
    : [activeBuild.version, ...visibleVersions.filter((item) => item !== activeBuild.version)]
  const formattedCreatedAt = new Date(activeBuild.createdAt).toLocaleDateString()
  const showLoaderVersionSelect = activeBuild.modLoader !== "vanilla" && activeBuild.modLoader !== "instance"

  const [showChangeVersionDialog, setShowChangeVersionDialog] = useState(false)
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [dialogAlert, setDialogAlert] = useState<{ title: string; message: string } | null>(null)
  const [repairing, setRepairing] = useState(false)
  const [repairDone, setRepairDone] = useState(false)

  const isModpack = Boolean(
    (activeBuild.source === "modrinth" && activeBuild.projectSlug) ||
    (activeBuild.source === "curseforge" && activeBuild.modId)
  )
  const isLocked = isModpack && activeBuild.locked !== false

  const handleToggleLock = () => {
    if (isLocked) {
      setShowUnlinkConfirm(true)
    } else {
      updateBuild(activeBuild.id, { locked: true })
    }
  }

  const confirmUnlink = () => {
    updateBuild(activeBuild.id, { locked: false })
  }

  const executeRepair = async () => {
    if (repairing) return
    setRepairing(true)
    setRepairDone(false)
    try {
      if (activeBuild.source === "modrinth" && activeBuild.projectSlug) {
        const res = await window.electronAPI?.importModrinthModpack(
          activeBuild.name,
          activeBuild.projectSlug,
          activeBuild.modpackVersionId,
          activeBuild.id
        )
        if (res?.success) {
          updateBuild(activeBuild.id, {
            version: res.version || activeBuild.version,
            modLoader: res.modLoader || activeBuild.modLoader,
            loaderVersion: res.loaderVersion || activeBuild.loaderVersion,
            mods: res.mods ?? activeBuild.mods,
          })
          setRepairDone(true)
          setTimeout(() => setRepairDone(false), 3000)
        } else {
          setDialogAlert({
            title: "Ошибка восстановления",
            message: res?.error || "Не удалось восстановить файлы модпака",
          })
        }
      } else if (activeBuild.source === "curseforge" && activeBuild.modId && activeBuild.fileId) {
        const res = await window.electronAPI?.importCurseforgeModpack(
          activeBuild.name,
          activeBuild.modId,
          activeBuild.fileId,
          activeBuild.id
        )
        if (res?.success) {
          updateBuild(activeBuild.id, {
            version: res.version || activeBuild.version,
            modLoader: res.modLoader || activeBuild.modLoader,
            loaderVersion: res.loaderVersion || activeBuild.loaderVersion,
            mods: res.mods ?? activeBuild.mods,
          })
          setRepairDone(true)
          setTimeout(() => setRepairDone(false), 3000)
        } else {
          setDialogAlert({
            title: "Ошибка восстановления",
            message: res?.error || "Не удалось восстановить файлы модпака",
          })
        }
      }
    } catch (err: any) {
      setDialogAlert({
        title: "Ошибка восстановления",
        message: err?.message || String(err),
      })
    } finally {
      setRepairing(false)
    }
  }

  const handleNameBlur = async () => {
    const current = activeBuild.name.trim()
    const saved = savedNameRef.current
    if (current === saved) return
    const result = await renameBuild(activeBuild.id, current)
    if (result.success) {
      savedNameRef.current = current
    } else {
      // Revert to the last saved name if the folder could not be renamed.
      updateBuild(activeBuild.id, { name: saved })
      alert(result.error ?? "Не удалось переименовать сборку")
    }
  }

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
              onClick={() => setShowIconPicker(true)}
            >
              {buildHasImage ? (
                <img src={activeBuild.icon} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <IconCamera className="h-10 w-10 text-muted-foreground/50" />
                </div>
              )}
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

        <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card/40 p-5">
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.name")}</label>
              <input
                type="text"
                value={activeBuild.name}
                onChange={e => updateBuild(activeBuild.id, { name: e.target.value })}
                onBlur={handleNameBlur}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                className="h-10 w-full rounded-xl border border-border bg-muted/40 px-3.5 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.description")}</label>
              <textarea
                value={activeBuild.description}
                onChange={e => updateBuild(activeBuild.id, { description: e.target.value })}
                rows={2}
                className="w-full rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {isModpack && isLocked && (
              <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    {activeBuild.icon ? (
                      <img src={activeBuild.icon} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0">
                        {activeBuild.name[0]}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">{activeBuild.name}</span>
                        <PlatformBadge source={activeBuild.source} showLabel className="text-[10px] py-0.5 px-1.5" />
                        {activeBuild.projectSlug && (
                          <button
                            type="button"
                            onClick={() => window.open(`https://modrinth.com/modpack/${activeBuild.projectSlug}`, "_blank")}
                            title="Открыть на Modrinth"
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            <IconExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        <span className="font-medium text-foreground/80">
                          {activeBuild.modpackVersion ? `Версия ${activeBuild.modpackVersion}` : activeBuild.version}
                        </span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1.5 capitalize font-medium text-foreground/90">
                          <LoaderIcon loaderId={activeBuild.modLoader} className="w-3.5 h-3.5 shrink-0" />
                          <span>{activeBuild.modLoader}</span>
                        </span>
                        <span>•</span>
                        <span>{activeBuild.version}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowRepairConfirm(true)}
                      disabled={repairing}
                      title="Восстановить оригинальные файлы модпака"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-medium text-foreground transition-colors"
                    >
                      {repairing ? (
                        <IconLoader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      ) : repairDone ? (
                        <IconCheck className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <IconTools className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                      <span>{repairing ? "Восстановление..." : repairDone ? "Готово" : "Восстановить"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowChangeVersionDialog(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors shadow-sm"
                    >
                      <IconArrowsExchange className="w-3.5 h-3.5" />
                      <span>Сменить версию</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleLock}
                      title="Отвязать инстанс от модпака для ручной смены версии и лоадера"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <IconUnlink className="w-3.5 h-3.5" />
                      <span>Отвязать</span>
                    </button>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                  <IconLock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Инстанс заблокирован: версия Minecraft и загрузчик управляются модпаком. Чтобы изменять их вручную, нажмите «Отвязать».</span>
                </div>
              </div>
            )}

            {isModpack && !isLocked && (
              <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-border/70 bg-muted/20 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <IconLockOpen className="w-4 h-4 text-muted-foreground" />
                  <span>Инстанс отвязан от модпака. Вы можете свободно изменять версию и загрузчик.</span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleLock}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-xs font-medium text-foreground transition-colors shrink-0"
                >
                  <IconLink className="w-3 h-3 text-primary" />
                  <span>Привязать обратно</span>
                </button>
              </div>
            )}

            {(!isModpack || !isLocked) && (
              <div className={showLoaderVersionSelect ? "grid gap-3 lg:grid-cols-3" : "grid gap-3 lg:grid-cols-2"}>
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.version")}</label>
                  <Select value={activeBuild.version} onValueChange={(value) => updateBuild(activeBuild.id, { version: value })}>
                    <SelectTrigger className="h-10 w-full rounded-xl border-border bg-muted/40 text-foreground">
                      <SelectValue placeholder={versionsLoaded ? t("builds.version") : "Loading..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableVersions.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("builds.modLoader")}</label>
                  <Select value={activeBuild.modLoader} onValueChange={(value) => updateBuild(activeBuild.id, { modLoader: value, loaderVersion: undefined })}>
                    <SelectTrigger className="h-10 w-full rounded-xl border-border bg-muted/40 text-foreground">
                      <SelectValue placeholder={t("builds.modLoader")} />
                    </SelectTrigger>
                    <SelectContent>
                      {MOD_LOADERS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          <span className="flex items-center gap-2">
                            <LoaderIcon loaderId={item.id} className="w-4 h-4 flex-shrink-0" />
                            {item.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {showLoaderVersionSelect && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Loader Version</label>
                    <Select value={activeBuild.loaderVersion ?? ""} onValueChange={(value) => updateBuild(activeBuild.id, { loaderVersion: value })} disabled={!loaderVersionsLoaded || loaderVersions.length === 0}>
                      <SelectTrigger className="h-10 w-full rounded-xl border-border bg-muted/40 text-foreground">
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
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/50 flex-wrap">
              {activeBuild.intentPath && (
                <button
                  type="button"
                  onClick={() => window.electronAPI?.openPath(activeBuild.intentPath!)}
                  className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <IconFolderOpen className="h-4 w-4" strokeWidth={1.75} />
                  Открыть папку игры
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <IconPickerModal
        open={showIconPicker}
        onOpenChange={setShowIconPicker}
        value={activeBuild.icon}
        onChange={(icon) => updateBuild(activeBuild.id, { icon })}
      />

      <ModpackChangeVersionDialog
        open={showChangeVersionDialog}
        onClose={() => setShowChangeVersionDialog(false)}
        build={activeBuild}
        onVersionChanged={(info) => {
          updateBuild(activeBuild.id, {
            modpackVersion: info.modpackVersion,
            modpackVersionId: info.modpackVersionId,
            version: info.version,
            modLoader: info.modLoader,
            loaderVersion: info.loaderVersion,
            mods: info.mods ?? activeBuild.mods,
            resourcepacks: info.resourcepacks ?? activeBuild.resourcepacks,
            shaders: info.shaders ?? activeBuild.shaders,
          })
        }}
      />

      <ActionConfirmDialog
        open={showUnlinkConfirm}
        onClose={() => setShowUnlinkConfirm(false)}
        onConfirm={confirmUnlink}
        title="Отвязать инстанс от модпака?"
        description={`Этот инстанс больше не будет связан с официальным модпаком.

Вы сможете свободно изменять версию Minecraft, загрузчик и состав модов вручную. Однако автоматические обновления модпака станут недоступны.`}
        confirmText="Отвязать инстанс"
        cancelText="Отмена"
        variant="warning"
        icon="unlink"
      />

      <ActionConfirmDialog
        open={showRepairConfirm}
        onClose={() => setShowRepairConfirm(false)}
        onConfirm={executeRepair}
        title="Восстановить файлы модпака?"
        description={`Лаунчер заново проверит и восстановит все оригинальные файлы и моды для текущей версии модпака.

Поврежденные или отсутствующие файлы сборки будут скачаны заново.`}
        confirmText="Восстановить"
        cancelText="Отмена"
        variant="info"
        icon="repair"
      />

      {dialogAlert && (
        <ActionConfirmDialog
          open={true}
          onClose={() => setDialogAlert(null)}
          title={dialogAlert.title}
          description={dialogAlert.message}
          type="alert"
          variant="danger"
          icon="warning"
        />
      )}
    </div>
  )
}

