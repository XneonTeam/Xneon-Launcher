import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconSearch, IconUpload, IconInfoCircle, IconPlus, IconTrash, IconRefresh, IconList, IconPower } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MODS_PER_PAGE } from "./constants"
import { Pagination } from "./pagination"
import { Spinner } from "./spinner"
import { formatDownloads } from "./utils"
import type { Build, BuildMod, ModSearchResult, ModSort, Source, ModVersion } from "./types"

function normalizeContentIdentity(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(jar|zip)$/gi, "")
    .replace(/[\W_]+/g, "")
}

interface InstanceContentTabProps {
  activeBuild: Build
  title: string
  placeholder: string
  uploadLabel: string
  type: "mods" | "resourcepacks" | "shaders"
  modSearch: string
  setModSearch: (value: string) => void
  modSource: Source
  setModSource: (value: Source) => void
  modSortBy: ModSort
  setModSortBy: (value: ModSort) => void
  modFileInputRef: React.RefObject<HTMLInputElement | null>
  onUploadFile: (file: File) => void
  modLoading: boolean
  modTotalHits: number
  modPage: number
  setModPrevResults: React.Dispatch<React.SetStateAction<ModSearchResult[]>>
  modResults: ModSearchResult[]
  setModPage: (page: number) => void
  displayResults: ModSearchResult[]
  openProjectModal: (item: ModSearchResult) => void
  installingModSlug: string | null
  setInstallingModSlug: (slug: string | null) => void
  addModToBuild: (buildId: string, mod: ModSearchResult) => void
  addContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", mod: ModSearchResult) => void | Promise<void>
  removeContentFromBuild: (buildId: string, type: "mods" | "resourcepacks" | "shaders", item: Build["mods"][number]) => Promise<boolean>
  installModToBuild: (mod: ModSearchResult) => void | Promise<void>
  setBuilds: React.Dispatch<React.SetStateAction<Build[]>>
  toggleItemEnabled: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string) => void
  updateItemVersion: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string, newVersion: ModVersion) => Promise<boolean>
}

export const InstanceContentTab = memo(function InstanceContentTab({
  activeBuild,
  title,
  placeholder,
  uploadLabel,
  type,
  modSearch,
  setModSearch,
  modSource,
  setModSource,
  modSortBy,
  setModSortBy,
  modFileInputRef,
  onUploadFile,
  modLoading,
  modTotalHits,
  modPage,
  setModPrevResults,
  modResults,
  setModPage,
  displayResults,
  openProjectModal,
  installingModSlug,
  setInstallingModSlug,
  addModToBuild,
  addContentToBuild,
  removeContentFromBuild,
  installModToBuild,
  setBuilds,
  toggleItemEnabled,
  updateItemVersion,
}: InstanceContentTabProps) {
  const { t } = useTranslation()
  const installedItems = type === "mods" ? activeBuild.mods : type === "resourcepacks" ? activeBuild.resourcepacks : activeBuild.shaders
  const installedModsMap = type === "mods" ? (activeBuild.installedMods ?? {}) : {}
  const emptyStateText = type === "mods" ? t("builds.findMods") : type === "resourcepacks" ? t("builds.findResourcePacks") : t("builds.findShaders")
  const notFoundText = type === "mods" ? t("builds.noModsFound") : type === "resourcepacks" ? t("builds.noResourcePacksFound") : t("builds.noShadersFound")
  const visibleProjects = useMemo(
    () => displayResults.filter(project => {
      const projectProjectId = project.projectId ?? (project.source === "modrinth" ? project.id : undefined)
      const normalizedProjectSlug = normalizeContentIdentity(project.slug)
      const normalizedProjectName = normalizeContentIdentity(project.name)
      const isInstalled = installedItems.some(item => {
        if (project.source === "modrinth" && projectProjectId && item.source === "modrinth" && item.projectId === projectProjectId) {
          return true
        }
        if (project.source === "curseforge" && typeof project.modId === "number" && item.source === "curseforge" && item.modId === project.modId) {
          return true
        }
        const normalizedItemSlug = normalizeContentIdentity(item.slug)
        const normalizedItemName = normalizeContentIdentity(item.name)
        if (Boolean(normalizedProjectSlug) && (
          normalizedItemSlug === normalizedProjectSlug
          || normalizedItemSlug === normalizedProjectName
          || normalizedItemName === normalizedProjectSlug
          || normalizedItemName === normalizedProjectName
          || normalizedItemSlug.includes(normalizedProjectName)
          || normalizedProjectSlug.includes(normalizedItemSlug)
        )) {
          return true
        }
        if (normalizedProjectSlug) {
          const itemNameNoVersion = normalizedItemName.replace(/(?:v?\d[\d.]*\w*)$/, "")
          const projNameNoVersion = normalizedProjectName.replace(/(?:v?\d[\d.]*\w*)$/, "")
          if (itemNameNoVersion && projNameNoVersion && (itemNameNoVersion !== normalizedItemName || projNameNoVersion !== normalizedProjectName)) {
            if (itemNameNoVersion === projNameNoVersion) return true
            if (projNameNoVersion.includes(itemNameNoVersion)) return true
            if (itemNameNoVersion.includes(projNameNoVersion)) return true
          }
        }
        return false
      })
      if (isInstalled) return false
      if (project.source === "modrinth" && normalizedProjectSlug) {
        return !Object.keys(installedModsMap).some(key => {
          const normalizedKey = normalizeContentIdentity(key)
          return normalizedKey.includes(normalizedProjectSlug) || normalizedProjectSlug.includes(normalizedKey)
        })
      }
      return true
    }),
    [displayResults, installedItems, installedModsMap],
  )
  const totalPages = useMemo(() => Math.max(1, Math.ceil(modTotalHits / MODS_PER_PAGE)), [modTotalHits])
  const handlePageChange = useCallback((p: number) => {
    setModPrevResults(modResults)
    setModPage(p)
  }, [modResults, setModPage, setModPrevResults])
  const [removingSlug, setRemovingSlug] = useState<string | null>(null)
  const [versionPickerItem, setVersionPickerItem] = useState<BuildMod | null>(null)
  const [versionPickerVersions, setVersionPickerVersions] = useState<ModVersion[]>([])
  const [versionPickerLoading, setVersionPickerLoading] = useState(false)
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null)

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[300px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={modSearch}
            onChange={e => setModSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={modSource} onValueChange={(v) => setModSource(v as Source)}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="modrinth">Modrinth</SelectItem>
              <SelectItem value="curseforge">CurseForge</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modSortBy} onValueChange={(v) => setModSortBy(v as ModSort)}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="downloads">По загрузкам</SelectItem>
              <SelectItem value="popular">По популярности</SelectItem>
              <SelectItem value="updated">По дате обновления</SelectItem>
              <SelectItem value="published">По дате публикации</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => modFileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
          >
            <IconUpload className="w-4 h-4" strokeWidth={1.75} />
            {uploadLabel}
          </button>
          <input
            ref={modFileInputRef}
            type="file"
            accept=".jar,.zip"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) {
                onUploadFile(file)
                e.target.value = ""
              }
            }}
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-border bg-card/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-foreground">Установлено</h3>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{installedItems.length}</span>
            </div>

            <div className="max-h-[540px] space-y-2 overflow-y-auto pr-1">
              {installedItems.length > 0 ? installedItems.map((item) => {
                const isEnabled = item.enabled ?? true
                return (
                <div key={item.id} className={`rounded-xl border p-3 transition-opacity ${isEnabled ? 'border-border bg-muted/20' : 'border-border/50 bg-muted/10 opacity-55'}`}>
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleItemEnabled(activeBuild.id, type, item.id)}
                      className={`mt-0.5 rounded-lg border p-2 transition-colors hover:bg-muted/80 ${isEnabled ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}
                      aria-label={isEnabled ? "Отключить" : "Включить"}
                      title={isEnabled ? "Отключить" : "Включить"}
                    >
                      <IconPower className={`h-4 w-4 ${isEnabled ? 'fill-primary/20' : ''}`} strokeWidth={1.75} />
                    </button>
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background border border-border">
                      {item.icon_url ? (
                        <img src={item.icon_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground">{item.name[0]}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground break-words">{item.name}</div>
                      {item.author && (
                        <div className="mt-0.5 text-xs text-muted-foreground/70">{item.author}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={updatingSlug === item.slug}
                        onClick={() => {
                          setUpdatingSlug(item.slug)
                          const fetchPromise = item.source === "modrinth" && item.projectId
                            ? window.electronAPI?.modsModrinthVersions(item.projectId)
                            : item.source === "curseforge" && item.modId
                              ? window.electronAPI?.modsCurseforgeDetails(item.modId).then(r => r?.versions ?? [])
                              : Promise.resolve([])
                          void Promise.resolve(fetchPromise).then(async (versions) => {
                            if (!(versions as ModVersion[])?.length) return
                            const latest = (versions as ModVersion[]).find(v => v.files?.[0]?.url)
                            if (latest && latest.name !== item.version && latest.id !== item.version) {
                              await updateItemVersion(activeBuild.id, type, item.id, latest)
                            }
                          }).finally(() => setUpdatingSlug(null))
                        }}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Обновить"
                        title="Обновить"
                      >
                        <IconRefresh className={`h-4 w-4 ${updatingSlug === item.slug ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVersionPickerItem(item)
                          setVersionPickerVersions([])
                          setVersionPickerLoading(true)
                          const fetchPromise = item.source === "modrinth" && item.projectId
                            ? window.electronAPI?.modsModrinthVersions(item.projectId)
                            : item.source === "curseforge" && item.modId
                              ? window.electronAPI?.modsCurseforgeDetails(item.modId).then(r => r?.versions ?? [])
                              : Promise.resolve([])
                          void Promise.resolve(fetchPromise).then((versions) => {
                            setVersionPickerVersions((versions ?? []) as ModVersion[])
                            setVersionPickerLoading(false)
                          })
                        }}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-accent-foreground"
                        aria-label="Версии"
                        title="Выбрать версию"
                      >
                        <IconList className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        disabled={removingSlug === item.slug}
                        onClick={() => {
                          setRemovingSlug(item.slug)
                          void removeContentFromBuild(activeBuild.id, type, item).finally(() => setRemovingSlug(null))
                        }}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Удалить"
                        title="Удалить"
                      >
                        <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </div>
              )}) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
                  <IconSearch className="mb-2 h-6 w-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{emptyStateText}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2 rounded-2xl border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
              {!modLoading && (modTotalHits > MODS_PER_PAGE || modSearch) && (
                <Pagination
                  currentPage={modPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto max-h-[540px]">
              {modResults.length > 0 || displayResults.length > 0 ? (
                <div className="grid gap-2 pb-2">
                  {visibleProjects.map(project => (
                    <div key={project.slug} className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-muted flex-shrink-0">
                        {project.iconUrl ? (
                          <img src={project.iconUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-lg font-bold text-muted-foreground">{project.name[0]}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{project.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{formatDownloads(project.downloadCount)}</span>
                          {type === "mods" && project.categories?.slice(0, 3).map(cat => (
                            <span key={cat} className="rounded bg-muted/60 px-1.5 py-0.5 text-xs capitalize">{cat}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openProjectModal(project)}
                          className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/80"
                        >
                          <IconInfoCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {t("builds.details")}
                        </button>
                        <button
                          type="button"
                          disabled={type === "mods" && installingModSlug === project.slug}
                          onClick={() => {
                            if (type === "mods") {
                              setInstallingModSlug(project.slug)
                              Promise.resolve(installModToBuild(project)).finally(() => {
                                setTimeout(() => setInstallingModSlug(null), 500)
                              })
                              return
                            }
                            void addContentToBuild(activeBuild.id, type, project)
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {type === "mods" && installingModSlug === project.slug ? "..." : <><IconPlus className="h-3.5 w-3.5" strokeWidth={1.75} />{t("builds.add")}</>}
                        </button>
                      </div>
                    </div>
                  ))}
                  {type === "mods" && displayResults.length > 0 && visibleProjects.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">{t("builds.allModsInstalled")}</p>
                  )}
                </div>
              ) : modLoading ? (
                <Spinner />
              ) : modSearch ? (
                <div className="flex h-full flex-col items-center justify-center">
                  <p className="text-sm text-muted-foreground">{notFoundText}</p>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
                  <IconSearch className="mb-2 h-6 w-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Начни поиск, чтобы добавить новый контент в сборку</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={versionPickerItem !== null} onOpenChange={(open) => { if (!open) setVersionPickerItem(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{versionPickerItem?.name} — выбор версии</DialogTitle>
          </DialogHeader>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {versionPickerLoading ? (
              <div className="flex items-center justify-center py-8">
                <IconRefresh className="h-5 w-5 animate-spin text-muted-foreground" strokeWidth={1.75} />
              </div>
            ) : versionPickerVersions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Нет доступных версий</p>
            ) : (
              versionPickerVersions.map((v) => {
                const isCurrent = v.name === versionPickerItem?.version || v.id === versionPickerItem?.version
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      const item = versionPickerItem
                      if (!item) return
                      setVersionPickerItem(null)
                      void updateItemVersion(activeBuild.id, type, item.id, v)
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${isCurrent ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border bg-muted/20 hover:bg-muted/40'}`}
                  >
                    <span className="flex-1 truncate font-medium">{v.name}</span>
                    <span className="text-xs text-muted-foreground">{v.gameVersion}</span>
                    {v.versionType && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${v.versionType === 'release' ? 'bg-green-500/10 text-green-500' : v.versionType === 'beta' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-500'}`}>{v.versionType}</span>
                    )}
                    {isCurrent && <span className="text-xs text-primary">текущая</span>}
                  </button>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
})
