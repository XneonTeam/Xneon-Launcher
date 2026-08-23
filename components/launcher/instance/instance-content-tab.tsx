import { memo, useEffect, useMemo, useState, useDeferredValue } from "react"
import { useTranslation } from "react-i18next"
import { IconSearch, IconUpload, IconInfoCircle, IconPlus, IconTrash, IconRefresh, IconList, IconPower, IconCheck, IconChevronDown, IconChevronRight, IconDownload, IconArrowRight, IconX } from "@tabler/icons-react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "./spinner"
import { Pagination } from "./pagination"
import { formatDownloads, matchesBuildVersion } from "./utils"
import type { Build, BuildMod, ModSearchResult, ModSort, SearchSource, ModVersion } from "./types"
import type { ModCategory } from "@xnlc/types"
import type { SelectedModCategory } from "./use-mod-search"
import { SORT_LABELS, SORT_OPTIONS_BY_SOURCE } from "./sort-options"

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-foreground mt-6 mb-3 pb-2 border-b border-border">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold text-foreground mt-5 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold text-foreground mt-4 mb-2">{children}</h3>,
  p: ({ children }) => <p className="text-muted-foreground mb-3 leading-relaxed">{children}</p>,
  li: ({ children }) => <li className="text-muted-foreground ml-4 mb-1">{children}</li>,
  ul: ({ children }) => <ul className="list-disc mb-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal mb-4 space-y-1">{children}</ol>,
  code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground">{children}</code>,
  pre: ({ children }) => <pre className="bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4">{children}</pre>,
  a: ({ href, children }) => <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-primary/50 pl-4 my-4 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr className="border-border my-6" />,
  img: ({ src, alt }) => <img src={src} alt={alt || ""} className="rounded-lg max-w-full my-4" />,
}

function normalizeContentIdentity(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(jar|zip)$/gi, "")
    .replace(/[\W_]+/g, "")
}

function ProviderIcon({ source, className }: { source: string; className?: string }) {
  if (source === "modrinth") {
    return (
      <span className={`inline-flex items-center justify-center rounded-md bg-green-500/15 ${className ?? "w-5 h-5"}`}>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
          <path fill="#26a269" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
        </svg>
      </span>
    )
  }
  if (source === "curseforge") {
    return (
      <span className="inline-flex items-center justify-center rounded-md bg-orange-500/15 w-5 h-5">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
          <path fill="#e66100" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
        </svg>
      </span>
    )
  }
  return null
}

interface InstanceContentTabProps {
  activeBuild: Build
  title: string
  placeholder: string
  uploadLabel: string
  type: "mods" | "resourcepacks" | "shaders"
  modSearch: string
  setModSearch: (value: string) => void
  modSource: SearchSource
  setModSource: (value: SearchSource) => void
  modSortBy: ModSort
  setModSortBy: (value: ModSort) => void
  modCategories?: SelectedModCategory[]
  setModCategories?: (value: SelectedModCategory[]) => void
  categories?: ModCategory[]
  modTotalPages?: number
  modFileInputRef: React.RefObject<HTMLInputElement | null>
  onUploadFile: (file: File) => void
  modLoading: boolean
  modTotalHits: number
  modPage: number
  setModPage: (page: number) => void
  displayResults: ModSearchResult[]
  isInstalledFn?: (project: ModSearchResult) => boolean
  openProjectModal: (item: ModSearchResult) => void
  installingModSlug: string | null
  setInstallingModSlug: (slug: string | null) => void
  addModToBuild: (buildId: string, mod: ModSearchResult) => void
  addContentToBuild: (buildId: string, type: "resourcepacks" | "shaders", mod: ModSearchResult) => void | Promise<void>
  removeContentFromBuild: (buildId: string, type: "mods" | "resourcepacks" | "shaders", item: Build["mods"][number]) => Promise<boolean>
  installModToBuild: (mod: ModSearchResult) => void | Promise<void>
  setBuilds: React.Dispatch<React.SetStateAction<Build[]>>
  toggleItemEnabled: (buildId: string, type: "mods" | "resourcepacks" | "shaders", itemId: string) => void | Promise<boolean>
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
  modCategories,
  setModCategories,
  categories,
  modFileInputRef,
  onUploadFile,
  modLoading,
  modTotalHits,
  modTotalPages,
  modPage,
  setModPage,
  displayResults,
  isInstalledFn,
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
  const emptyStateText = type === "mods" ? t("builds.findMods") : type === "resourcepacks" ? t("builds.findResourcePacks") : t("builds.findShaders")
  const notFoundText = type === "mods" ? t("builds.noModsFound") : type === "resourcepacks" ? t("builds.noResourcePacksFound") : t("builds.noShadersFound")
  const deferredResults = useDeferredValue(displayResults)

  const [removingSlug, setRemovingSlug] = useState<string | null>(null)
  const [versionPickerItem, setVersionPickerItem] = useState<BuildMod | null>(null)
  const [versionPickerVersions, setVersionPickerVersions] = useState<ModVersion[]>([])
  const [versionPickerLoading, setVersionPickerLoading] = useState(false)
  const [selectedPickerVersion, setSelectedPickerVersion] = useState<ModVersion | null>(null)
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<{ fileName: string; current: number; total: number } | null>(null)
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [draftCats, setDraftCats] = useState<SelectedModCategory[]>([])
  const contentType = type === "mods" ? "mod" : type === "resourcepacks" ? "resourcepack" : "shader"
  type ContentCategory = ModCategory & { source?: "modrinth" | "curseforge" }
  const filteredCategories = useMemo(() => (categories ?? []).filter(c => c.projectType === contentType) as ContentCategory[], [categories, contentType])
  const [collapsedSourceGroups, setCollapsedSourceGroups] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const off = window.electronAPI?.onContentDownloadProgress?.((progress) => {
      setDownloadProgress(progress)
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    if (updatingSlug === null) setDownloadProgress(null)
  }, [updatingSlug])

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
          <Select value={modSource} onValueChange={(v) => setModSource(v as SearchSource)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Обе платформы</SelectItem>
              <SelectItem value="modrinth">Modrinth</SelectItem>
              <SelectItem value="curseforge">CurseForge</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modSortBy} onValueChange={(v) => setModSortBy(v as ModSort)}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS_BY_SOURCE[modSource].map((id) => (
                <SelectItem key={id} value={id}>{SORT_LABELS[id]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={catDialogOpen} onOpenChange={(open) => {
            if (open) setDraftCats(modCategories ?? [])
            setCatDialogOpen(open)
          }}>
            <DialogTrigger asChild>
              <button
                type="button"
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  (modCategories?.length ?? 0) > 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground hover:bg-muted/80"
                }`}
              >
                <IconList className="w-4 h-4" strokeWidth={1.75} />
                {(modCategories?.length ?? 0) > 0 ? `${modCategories!.length} кат.` : "Категории"}
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Категории</DialogTitle>
                <DialogDescription>Выбери категории и нажми «Найти»</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-1">
                {filteredCategories.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">Нет категорий для этого типа контента</p>
                )}
                {(() => {
                  const groups = new Map<string, ContentCategory[]>()
                  for (const cat of filteredCategories) {
                    const key = cat.source ?? "both"
                    const list = groups.get(key)
                    if (list) list.push(cat)
                    else groups.set(key, [cat])
                  }
                  const groupLabels: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge", both: "Обе платформы" }
                  return [...groups.entries()].map(([key, cats]) => {
                    const collapsed = collapsedSourceGroups.has(key)
                    return (
                      <div key={key} className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => setCollapsedSourceGroups(prev => {
                            const next = new Set(prev)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })}
                          className="flex w-full items-center gap-2 px-2 py-2 rounded-xl bg-muted/60 border border-border/70 hover:bg-muted/90 text-xs font-semibold text-foreground transition-colors"
                        >
                          {collapsed
                            ? <IconChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            : <IconChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                          {key === "both" ? (
                            <span className="inline-flex items-center gap-1">
                              <ProviderIcon source="modrinth" />
                              <ProviderIcon source="curseforge" />
                            </span>
                          ) : (
                            <ProviderIcon source={key} />
                          )}
                          <span className="min-w-0 flex-1 text-left truncate">{groupLabels[key] ?? key}</span>
                          <span className="rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-normal text-muted-foreground">{cats.length}</span>
                        </button>
                        {!collapsed && cats.map((cat) => {
                          const checked = draftCats.some(c => c.name === cat.name)
                          const hasSvg = cat.icon && cat.icon.trimStart().startsWith("<svg")
                          const hasImg = cat.icon && !hasSvg && cat.icon.startsWith("http")
                          return (
                            <label
                              key={`${key}:${cat.name}`}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => {
                                  if (v) setDraftCats((prev) => [...prev, { name: cat.name, source: cat.source }])
                                  else setDraftCats((prev) => prev.filter((c) => c.name !== cat.name))
                                }}
                              />
                              {hasSvg && (
                                <span
                                  className="w-4 h-4 shrink-0 text-muted-foreground [&_svg]:w-full [&_svg]:h-full"
                                  dangerouslySetInnerHTML={{ __html: cat.icon }}
                                />
                              )}
                              {hasImg && (
                                <img
                                  src={cat.icon}
                                  alt=""
                                  className="w-4 h-4 shrink-0 rounded-sm object-contain"
                                />
                              )}
                              <span className="flex-1">{cat.name}</span>
                              {cat.header !== "categories" && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{cat.header}</span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    )
                  })
                })()}
              </div>
              {(draftCats.length > 0) && (
                <button
                  type="button"
                  onClick={() => setDraftCats([])}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
                >
                  Сбросить все
                </button>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setCatDialogOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModCategories?.(draftCats)
                    setCatDialogOpen(false)
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <IconSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Найти
                </button>
              </div>
            </DialogContent>
          </Dialog>
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
        <div className="grid gap-3 min-h-0 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
          <div className="flex flex-col min-h-0 rounded-2xl border border-border bg-card/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3 shrink-0">
              <h3 className="text-sm font-medium text-foreground">Установлено</h3>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{installedItems.length}</span>
            </div>

            <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
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
                        onClick={() => {
                          setSelectedPickerVersion(null)
                          setVersionPickerItem(item)
                          setVersionPickerVersions([])
                          setVersionPickerLoading(true)
                          const fetchPromise = item.source === "modrinth" && item.projectId
                            ? window.electronAPI?.modsModrinthVersions(item.projectId)
                            : item.source === "curseforge" && item.modId
                              ? window.electronAPI?.modsCurseforgeDetails(item.modId).then(r => r?.versions ?? [])
                              : Promise.resolve([])
                          void Promise.resolve(fetchPromise).then((versions) => {
                            const list = (versions ?? []) as ModVersion[]
                            // Для модов фильтруем по загрузчику сборки (fabric/neoforge/...)
                            // и версии Minecraft, чтобы не показывать несовместимые.
                            const requireLoader = type === "mods"
                            const compatible = list.filter(v => matchesBuildVersion(v, activeBuild, requireLoader))
                            const gameOnly = list.filter(v => matchesBuildVersion(v, activeBuild, false))
                            const shown = compatible.length > 0 ? compatible : (gameOnly.length > 0 ? gameOnly : list)
                            setVersionPickerVersions(shown)
                            setVersionPickerLoading(false)
                          })
                        }}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                        aria-label="Обновить"
                        title="Обновить"
                      >
                        <IconRefresh className="h-4 w-4" strokeWidth={1.75} />
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

          <div className="flex min-h-0 flex-col rounded-2xl border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
              {!modLoading && displayResults.length > 0 && (
                <span className="text-xs text-muted-foreground">{formatDownloads(modTotalHits)} результатов</span>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1 mt-2">
              {displayResults.length > 0 ? (
                <div className="grid gap-2 pb-2">
                  {deferredResults.map(project => {
                    const installed = isInstalledFn?.(project) ?? false
                    return (
                    <div key={project.id} className="group flex items-center gap-3.5 rounded-xl border border-border bg-card px-3.5 py-2.5 transition-colors hover:border-primary/50">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-muted flex-shrink-0">
                        {project.iconUrl ? (
                          <img src={project.iconUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-sm font-bold text-muted-foreground">{project.name[0]}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{project.name}</p>
                          {project.source === "modrinth" ? (
                            <svg className="h-3.5 w-3.5 shrink-0 text-[#1bd96a]" viewBox="0 0 24 24" fill="currentColor"><path d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73 11 10.999 0 0 0-2.17 3.11 11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02.2-.04.22.1-.26-1.7l-.36-1.37-1.01-.06a8.5 8.489 0 0 1-5.18-1.8 5.34 5.34 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97 2.07-.43 2.06-.43 1.47-1.47c.8-.8 1.48-1.5 1.48-1.52 0-.09-.42-1.63-.46-1.7-.04-.06-.2-.03-1.02.18-.53.13-1.2.3-1.45.4l-.48.15-.53.53-.53.53-.93.1-.93.07-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6.43-.57c.68-.9.68-.9 1.46-1.1.4-.1.65-.2.83-.33.13-.099.65-.579 1.14-1.069l.9-.9-.7-.7-.7-.7-1.95.54c-1.07.3-1.96.53-1.97.53-.03 0-2.23 2.48-2.63 2.97l-.29.35.28 1.03c.16.56.3 1.16.31 1.34l.03.3-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1-.08-.1-.23-.6-.32-1.03-.18-.86-.17-2.75.02-3.73a8.84 8.839 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1.06-.17.5-2.999.47-3.039-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38-.06.23-.46 2.42-.46 2.52 0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2 8.38 8.379 0 0 1 2.16 3.449 6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.37 9.369 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38-.38.32-1.54 1.1-1.7 1.14-.1.03-.1.06-.07.26.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/></svg>
                          ) : (
                            <svg className="h-3.5 w-3.5 shrink-0 text-[#f16436]" viewBox="0 0 24 24" fill="currentColor"><path d="M18.326 9.2145S23.2261 8.4418 24 6.1882h-7.5066V4.4H0l2.0318 2.3576V9.173s5.1267-.2665 7.1098 1.2372c2.7146 2.516-3.053 5.917-3.053 5.917L5.0995 19.6c1.5465-1.4726 4.494-3.3775 9.8983-3.2857-2.0565.65-4.1245 1.6651-5.7344 3.2857h10.9248l-1.0288-3.2726s-7.918-4.6688-.8336-7.1127z"/></svg>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{formatDownloads(project.downloadCount)}</span>
                          {type === "mods" && project.categories?.slice(0, 3).map(cat => (
                            <span key={cat} className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] capitalize">{cat}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openProjectModal(project)}
                          className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80"
                        >
                          <IconInfoCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {t("builds.details")}
                        </button>
                        {installed ? (
                          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary">
                            <IconCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                            {t("builds.installed")}
                          </span>
                        ) : (
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
                            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {type === "mods" && installingModSlug === project.slug ? "..." : <><IconPlus className="h-3.5 w-3.5" strokeWidth={1.75} />{t("builds.add")}</>}
                          </button>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
              ) : modLoading ? (
                <Spinner />
              ) : (modSearch || (modCategories?.length ?? 0) > 0) ? (
                <div className="flex h-full flex-col items-center justify-center">
                  <IconSearch className="mb-2 h-6 w-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{notFoundText}</p>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
                  <IconSearch className="mb-2 h-6 w-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Начни поиск, чтобы добавить новый контент в сборку</p>
                </div>
              )}
            </div>
            <Pagination
              currentPage={modPage - 1}
              totalPages={modTotalPages ?? 1}
              onPageChange={(p) => setModPage(p + 1)}
              className="mt-2"
            />
          </div>
        </div>
      </div>

      {versionPickerItem !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => { setVersionPickerItem(null); setSelectedPickerVersion(null) }}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground">Обновить {versionPickerItem?.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">Текущая версия: {versionPickerItem?.version}</p>
                </div>
                <button
                  onClick={() => { setVersionPickerItem(null); setSelectedPickerVersion(null) }}
                  className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {versionPickerLoading ? (
                <div className="flex items-center justify-center py-12">
                  <IconRefresh className="h-5 w-5 animate-spin text-muted-foreground" strokeWidth={1.75} />
                </div>
              ) : versionPickerVersions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Нет доступных версий</p>
              ) : (
                <div className="space-y-2">
                  {versionPickerVersions.map((ver) => {
                    const isCurrent = versionPickerItem && (ver.name === versionPickerItem.version || ver.id === versionPickerItem.version)
                    const isSelected = selectedPickerVersion?.id === ver.id
                    const isOlder = versionPickerItem?.version && ver.name < versionPickerItem.version

                    return (
                      <button
                        key={ver.id}
                        type="button"
                        disabled={!!isCurrent && !isSelected}
                        onClick={() => setSelectedPickerVersion(isSelected ? null : ver)}
                        className={cn(
                          "w-full text-left p-4 rounded-xl border transition-colors disabled:cursor-not-allowed",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : isCurrent
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-muted/20 hover:bg-muted/30"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{ver.name}</span>
                              {isCurrent && (
                                <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                  <IconCheck className="w-3 h-3" />
                                  Текущая
                                </span>
                              )}
                              {isOlder && !isCurrent && (
                                <span className="text-xs text-muted-foreground">Старая</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xs text-muted-foreground">{ver.gameVersion ?? ""}</span>
                              {ver.loaders && (
                                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                  {Array.isArray(ver.loaders) ? ver.loaders.join(", ") : ""}
                                </span>
                              )}
                              {ver.datePublished && (
                                <span className="text-xs text-muted-foreground">
                                  {new Date(ver.datePublished).toLocaleDateString()}
                                </span>
                              )}
                              {ver.versionType && (
                                <span className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                                  ver.versionType === "release" ? "bg-green-500/10 text-green-500"
                                    : ver.versionType === "beta" ? "bg-yellow-500/10 text-yellow-500"
                                      : "bg-red-500/10 text-red-500"
                                )}>
                                  {ver.versionType}
                                </span>
                              )}
                            </div>
                          </div>
                          <IconArrowRight className={cn(
                            "w-4 h-4 transition-transform",
                            isSelected ? "rotate-90 text-primary" : "text-muted-foreground"
                          )} />
                        </div>

                        {isSelected && (
                          <div className="mt-4 pt-4 border-t border-border">
                            {ver.changelog ? (
                              <div className="text-sm text-muted-foreground">
                                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Что изменилось</div>
                                <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{ver.changelog}</ReactMarkdown>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">Нет описания изменений</p>
                            )}

                            <div className="flex items-center gap-3 mt-4">
                              {ver.files && ver.files.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  Файлов: {ver.files.length}
                                </span>
                              )}
                              {ver.downloadCount !== undefined && (
                                <span className="text-xs text-muted-foreground">
                                  Загрузок: {ver.downloadCount.toLocaleString()}
                                </span>
                              )}
                            </div>

                            {!isCurrent && (
                              <button
                                type="button"
                                disabled={updatingSlug === versionPickerItem?.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const item = versionPickerItem
                                  if (!item) return
                                  setUpdatingSlug(item.id)
                                  void updateItemVersion(activeBuild.id, type, item.id, ver).finally(() => {
                                    setUpdatingSlug(null)
                                    setSelectedPickerVersion(null)
                                    setVersionPickerItem(null)
                                  })
                                }}
                                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                                Обновить до этой версии
                              </button>
                            )}

                            {updatingSlug === versionPickerItem?.id && downloadProgress && downloadProgress.total > 0 && (
                              <div className="mt-4">
                                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                  <span className="truncate">{downloadProgress.fileName}</span>
                                  <span className="shrink-0 ml-2">{Math.round((downloadProgress.current / downloadProgress.total) * 100)}%</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                                    style={{ width: `${Math.min(100, (downloadProgress.current / downloadProgress.total) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
