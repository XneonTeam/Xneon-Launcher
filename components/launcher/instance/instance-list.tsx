import { memo, useCallback, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconPackage, IconPlus, IconCopy, IconTrash, IconDownload, IconUpload, IconTag,
  IconRotateClockwise, IconX, IconChevronDown, IconChevronRight,
  IconPencil, IconTrashFilled, IconBox, IconPalette, IconWallpaper, IconWorldUpload,
  IconSettings, IconBug, IconFolder, IconCheck, IconLayoutGrid, IconLayoutList, IconArrowUpCircle,
} from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { MOD_LOADERS } from "./constants"
import { LoaderIcon } from "./loader-icon"
import { PlatformBadge } from "@/components/launcher/platform-icon"
import type { Build } from "./types"
import type { BuildExportCategory } from "@xnlc/types"

interface InstanceListProps {
  builds: Build[]
  totalBuilds: number
  onCreate: () => void
  onDelete: (id: string) => void
  onTrash: (id: string) => Promise<boolean>
  onUndoTrash: () => Promise<Build | null>
  onDuplicate: (id: string) => Promise<Build | null>
  onExportZip: (id: string, categories?: BuildExportCategory[]) => Promise<{ success: boolean; path?: string; error?: string }>
  onExportModlist: (id: string, format: "html" | "markdown" | "json" | "csv" | "plaintext") => Promise<{ success: boolean; path?: string; error?: string }>
  onSetGroup: (id: string, group: string) => void
  onRenameGroup: (oldName: string, newName: string) => void
  onDeleteGroup: (group: string) => void
  onOpen: (id: string) => void
  groups: string[]
  collapsedGroups: Set<string>
  onToggleGroupCollapse: (group: string) => void
  updatesCountByBuild?: Record<string, number>
}

const MODLIST_FORMATS: Array<{ id: "html" | "markdown" | "json" | "csv" | "plaintext"; label: string }> = [
  { id: "html", label: "HTML" },
  { id: "markdown", label: "MD" },
  { id: "json", label: "JSON" },
  { id: "csv", label: "CSV" },
  { id: "plaintext", label: "TXT" },
]

const EXPORT_CATEGORIES: Array<{ id: BuildExportCategory; label: string; description: string; icon: React.ReactNode }> = [
  { id: "mods", label: "Моды", description: "Папка mods", icon: <IconBox className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
  { id: "resourcepacks", label: "Ресурспаки", description: "Папка resourcepacks", icon: <IconPalette className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
  { id: "shaderpacks", label: "Шейдерпаки", description: "Папка shaderpacks", icon: <IconWallpaper className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
  { id: "saves", label: "Миры", description: "Папка saves (миры/сохранения)", icon: <IconWorldUpload className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
  { id: "data", label: "Данные и конфиги", description: "config, options.txt, servers.dat и прочие файлы", icon: <IconSettings className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
  { id: "logs", label: "Логи и кэш", description: "logs, crash-reports, .cache, .fabric, .quilt", icon: <IconBug className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> },
]

export const InstanceList = memo(function InstanceList({
  builds, totalBuilds, onCreate, onDelete, onTrash, onUndoTrash, onDuplicate,
  onExportZip, onExportModlist, onSetGroup, onRenameGroup,
  onDeleteGroup, onOpen, groups, collapsedGroups, onToggleGroupCollapse,
  updatesCountByBuild,
}: InstanceListProps) {
  const { t } = useTranslation()
  const [trashedName, setTrashedName] = useState<string | null>(null)
  const undoTimeoutRef = useRef<number | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportDialogFor, setExportDialogFor] = useState<string | null>(null)
  const [exportCategories, setExportCategories] = useState<Set<BuildExportCategory>>(() => new Set(["mods", "resourcepacks", "shaderpacks", "saves", "data"]))
  const [modlistMenuFor, setModlistMenuFor] = useState<string | null>(null)
  const [groupEditFor, setGroupEditFor] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState("")
  const [groupContextMenu, setGroupContextMenu] = useState<{ group: string; x: number; y: number } | null>(null)
  const [buildContextMenu, setBuildContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renameGroupFor, setRenameGroupFor] = useState<string | null>(null)
  const [renameGroupDraft, setRenameGroupDraft] = useState("")
  const [layoutMode, setLayoutMode] = useState<"grid" | "list">("grid")

  const groupedBuilds = useMemo(() => {
    const map = new Map<string, Build[]>()
    for (const b of builds) {
      const key = b.group ?? ""
      const list = map.get(key)
      if (list) list.push(b)
      else map.set(key, [b])
    }
    return map
  }, [builds])

  const sortedGroupKeys = useMemo(() => {
    const keys = Array.from(groupedBuilds.keys())
    keys.sort((a, b) => {
      if (a === "") return 1
      if (b === "") return -1
      return a.localeCompare(b)
    })
    return keys
  }, [groupedBuilds])

  const handleTrash = useCallback(async (id: string) => {
    const build = builds.find((b) => b.id === id)
    const ok = await onTrash(id)
    if (!ok) return
    setTrashedName(build?.name ?? "Сборка")
    if (undoTimeoutRef.current !== null) window.clearTimeout(undoTimeoutRef.current)
    undoTimeoutRef.current = window.setTimeout(() => setTrashedName(null), 8000)
  }, [builds, onTrash])

  const handleUndo = useCallback(async () => {
    if (undoTimeoutRef.current !== null) window.clearTimeout(undoTimeoutRef.current)
    await onUndoTrash()
    setTrashedName(null)
  }, [onUndoTrash])

  const handleExportZip = useCallback(async (id: string) => {
    setExportingId(id)
    try {
      const result = await onExportZip(id, Array.from(exportCategories))
      if (!result.success && result.error) console.warn("[Сборки] Экспорт zip не удался:", result.error)
    } finally { setExportingId(null) }
  }, [onExportZip, exportCategories])

  const handleExportModlist = useCallback(async (id: string, format: "html" | "markdown" | "json" | "csv" | "plaintext") => {
    setModlistMenuFor(null)
    const result = await onExportModlist(id, format)
    if (!result.success && result.error) console.warn("[Сборки] Экспорт модлиста не удался:", result.error)
  }, [onExportModlist])

  const handleGroupContextMenu = useCallback((e: React.MouseEvent, group: string) => {
    e.preventDefault()
    setGroupContextMenu({ group, x: e.clientX, y: e.clientY })
  }, [])

  const handleRenameGroup = useCallback(() => {
    if (!renameGroupFor) return
    const trimmed = renameGroupDraft.trim()
    if (trimmed && trimmed !== renameGroupFor) onRenameGroup(renameGroupFor, trimmed)
    setRenameGroupFor(null)
    setRenameGroupDraft("")
  }, [renameGroupFor, renameGroupDraft, onRenameGroup])

  return (
    <div className="flex-1 overflow-y-auto relative" onClick={() => { setGroupContextMenu(null); setBuildContextMenu(null) }}>
      {totalBuilds === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-5">
            <IconPackage className="w-10 h-10 text-muted-foreground/40" />
          </div>
          <p className="text-base font-medium text-foreground">{t("builds.noBuilds")}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-5">{t("builds.noBuildsDesc")}</p>
          <button type="button" onClick={onCreate} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90">
            <IconPlus className="w-4 h-4" strokeWidth={1.75} />
            {t("builds.createBuild")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {totalBuilds > 0 && (
            <div className="flex items-center justify-end px-3 pb-2">
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted border border-border">
                <button
                  type="button"
                  onClick={() => setLayoutMode("grid")}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    layoutMode === "grid" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
                  )}
                  title="Карточки"
                >
                  <IconLayoutGrid className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("list")}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    layoutMode === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
                  )}
                  title="Список"
                >
                  <IconLayoutList className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )}
          {sortedGroupKeys.map(groupKey => {
            const groupBuilds = groupedBuilds.get(groupKey) ?? []
            const isCollapsed = groupKey !== "" && collapsedGroups.has(groupKey)
            const displayName = groupKey || t("builds.ungrouped", "Без группы")

            return (
              <div key={groupKey || "__ungrouped__"}>
                <div
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
                    groupKey !== "" ? "cursor-pointer hover:bg-muted/50 select-none" : "cursor-default",
                  )}
                  onClick={() => { if (groupKey) onToggleGroupCollapse(groupKey) }}
                  onContextMenu={(e) => { if (groupKey) handleGroupContextMenu(e, groupKey) }}
                >
                  {groupKey !== "" ? (
                    isCollapsed
                      ? <IconChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      : <IconChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : <div className="w-4" />}
                  <span className={cn(
                    "text-sm font-semibold",
                    groupKey ? "text-foreground" : "text-muted-foreground italic",
                  )}>
                    {displayName}
                  </span>
                  <span className="text-xs text-muted-foreground">({groupBuilds.length})</span>
                  <div className="flex-1" />
                  {groupKey !== "" && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}>
                      <button type="button" title="Переименовать группу"
                        onClick={() => { setRenameGroupFor(groupKey); setRenameGroupDraft(groupKey) }}
                        className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground">
                        <IconPencil className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title="Удалить группу"
                        onClick={() => onDeleteGroup(groupKey)}
                        className="p-1 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive">
                        <IconTrashFilled className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {!isCollapsed && layoutMode === "grid" && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 px-3 pb-4">
                    {groupBuilds.map(build => {
                      const loader = MOD_LOADERS.find(item => item.id === build.modLoader) ?? MOD_LOADERS[0]
                      const hasImage = !!build.icon
                      const isLinkedModpack = (build.source === "modrinth" || build.source === "curseforge") && build.locked !== false
                      const updatesCount = isLinkedModpack ? 0 : (updatesCountByBuild?.[build.id] ?? 0)
                      return (
                        <div
                          key={build.id}
                          className="group relative rounded-2xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-[0_0_20px_var(--glow-primary)] transition-colors cursor-pointer flex flex-col"
                          onClick={() => onOpen(build.id)}
                          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setBuildContextMenu({ id: build.id, x: e.clientX, y: e.clientY }) }}
                        >
                          <div className="relative w-full" style={{ paddingBottom: "100%" }}>
                            <div className="absolute inset-0">
                              {hasImage ? (
                                <img src={build.icon} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 flex items-center justify-center">
                                  <IconPackage className="w-10 h-10 text-primary/40" />
                                </div>
                              )}
                            </div>
                            {updatesCount > 0 && (
                              <div
                                className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-lg"
                                title={t("updates.badgeTitle", { count: updatesCount })}
                              >
                                <IconArrowUpCircle className="w-3 h-3" strokeWidth={2} />
                                {updatesCount}
                              </div>
                            )}
                            {build.source === "modrinth" && (
                              <div className="absolute top-2 left-2 p-1 rounded-md bg-green-500/20">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
                                  <path fill="#26a269" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
                                </svg>
                              </div>
                            )}
                            {build.source === "curseforge" && (
                              <div className="absolute top-2 left-2 p-1 rounded-md bg-orange-500/20">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
                                  <path fill="#e66100" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
                                </svg>
                              </div>
                            )}
                            {build.source === "ftb" && (
                              <div className="absolute top-2 left-2 p-1 rounded-md bg-sky-500/20">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 1544.031 1112.211">
                                  <path fill="#0ea5e9" d="M456.147 246.012C470.315 163.992 483.696 81.758 499.344 0c30.976 9.746 63.159 15.542 95.61 16.596 77.388 2.528 154.771.841 232.157 1.316 65.324-.37 132.279 2.686 195.284-17.753 13.694 82.126 30.552 163.988 41.562 246.484-10.798 1.157-21.596 2.476-32.343 3.846-25.764-59.054-55.581-120.636-109.469-159.038-30.814-21.494-68.271-29.975-105.255-31.713-.686 238.267-.418 476.585-.896 714.853 22.809 3.057 45.728 5.269 68.589 8.112-.159 14.173-.159 28.392-.106 42.622-82.76-.318-165.518-.059-248.225-.165.16-13.797 0-27.601-.576-41.401 22.703-4.744 45.986-5.742 68.957-9.009.104-238.215-.051-476.482-.211-714.695-46.409.896-93.769 16.278-127.223 49.36-40.826 38.402-64.794 90.241-87.023 140.705-11.378-.895-22.757-2.158-34.029-4.108z"/>
                                  <path fill="#0ea5e9" d="M405.68 305.171c38.929-.316 77.861-5.479 115.103-17.121 18.756 86.236 38.46 172.261 56.157 258.706-13.381 1.95-26.763 3.794-40.143 5.69-34.875-78.598-89.766-156.404-173.944-186.327-56.893-22.598-118.847-16.856-178.636-15.961-2.108 108.729-.581 217.669-1.105 326.453 44.196-1.316 95.244 7.32 132.381-22.491 27.657-27.766 35.929-68.276 44.829-105.047a1685.8 1685.8 0 0 1 40.039-.157c.052 99.196-.16 198.338-.262 297.533-13.016-.107-26.026-.052-39.037.053-10.854-37.931-17.439-82.285-49.782-108.682-38.455-25.389-87.291-17.486-130.854-19.015-.051 114.577-.211 229.204-.051 343.833 22.806 3.106 45.883 4.794 68.586 8.746a1749.451 1749.451 0 0 0-.16 40.621-82.81.152-165.619-.319-248.435.205.211-13.905.268-27.813.159-41.67 22.548-3.9 46.988-2.367 68.271-9.848-.16-234.844.211-469.737-.946-704.529-22.707-1.95-45.25-4.85-67.851-7.641v-43.303c135.228-.1 270.455-.048 405.681-.048z"/>
                                  <path fill="#0ea5e9" d="M942.955 305.277c87.765-.055 175.523-.055 263.286-.055 67.537-.262 137.388.528 200.813 26.551 45.408 16.964 84.656 53.894 97.193 101.513 13.117 50.678 11.692 108.625-17.121 153.823-33.607 49.048-91.926 75.223-148.817 86.129 63.374 15.752 126.69 44.776 167.466 97.615 33.82 44.617 42.776 103.458 36.295 157.928-4.161 50.104-28.289 98.883-68.375 129.806-48.784 37.93-112.204 50.569-172.632 53.102-119.212.524-238.424-.318-357.636.422.262-13.859.313-27.76.211-41.619 23.021-2.787 46.195-4.054 68.956-8.693-1.632-235.208-.159-470.474-1.79-705.685-22.651-2.107-45.251-4.898-67.851-7.587.002-14.434.002-28.87.002-43.25m183.904 44.987c-1.797 100.828-.269 201.708-1.056 302.59 67.167-1.214 137.964 2.737 200.494-26.134 39.406-17.542 67.063-56.731 72.012-99.402 4.48-38.876 1.898-80.969-19.332-114.945-15.485-25.707-43.671-40.036-71.482-48.623-58.426-17.91-120.323-15.698-180.636-13.486m-3.586 347.996c.106 122.005-.211 244.011.056 366.017 58.997 10.164 120.21 9.431 178.42-5.166 39.298-10.375 78.653-32.233 97.563-69.748 22.019-42.821 24.971-92.976 19.597-140.071-5.583-49.094-34.242-94.978-77.28-119.737-65.115-39.67-145.028-37.829-218.356-31.295z"/>
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="px-3 py-2.5 bg-card border-t border-border/50">
                            <p className="text-sm font-semibold text-foreground truncate leading-tight">{build.name}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <LoaderIcon loaderId={build.modLoader} className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="text-[11px] text-muted-foreground truncate">{loader.name} · {build.version}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {!isCollapsed && layoutMode === "list" && (
                  <div className="flex flex-col gap-1 px-3 pb-4">
                    {groupBuilds.map(build => {
                      const loader = MOD_LOADERS.find(item => item.id === build.modLoader) ?? MOD_LOADERS[0]
                      const hasImage = !!build.icon
                      const isLinkedModpack = (build.source === "modrinth" || build.source === "curseforge") && build.locked !== false
                      const updatesCount = isLinkedModpack ? 0 : (updatesCountByBuild?.[build.id] ?? 0)
                      const sourceLabel = build.source === "modrinth" ? "Modrinth" : build.source === "curseforge" ? "CurseForge" : build.source === "ftb" ? "FTB" : null
                      return (
                        <div
                          key={build.id}
                          className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => onOpen(build.id)}
                          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setBuildContextMenu({ id: build.id, x: e.clientX, y: e.clientY }) }}
                        >
                          <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                            {hasImage ? (
                              <img src={build.icon} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 flex items-center justify-center">
                                <IconPackage className="w-5 h-5 text-primary/40" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{build.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <LoaderIcon loaderId={build.modLoader} className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-[11px] text-muted-foreground truncate">{loader.name} · {build.version}</span>
                            </div>
                          </div>
                          {build.source && (
                            <PlatformBadge source={build.source} showLabel className="shrink-0 text-[10px] py-0.5 px-2" iconSize={12} />
                          )}
                          {updatesCount > 0 && (
                            <span
                              className="shrink-0 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground"
                              title={t("updates.badgeTitle", { count: updatesCount })}
                            >
                              <IconArrowUpCircle className="w-3 h-3" strokeWidth={2} />
                              {updatesCount}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {exportDialogFor && !exportingId && (
        <div className="absolute inset-0 z-30 bg-background/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setExportDialogFor(null)}>
          <div className="w-[420px] rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-foreground">Экспорт в zip</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Выберите, что включить в архив сборки «{builds.find(b => b.id === exportDialogFor)?.name ?? ""}»
                </p>
              </div>
              <button type="button" onClick={() => setExportDialogFor(null)} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {EXPORT_CATEGORIES.map(cat => (
                <label key={cat.id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 cursor-pointer transition-colors hover:border-primary/40">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">{cat.icon}</span>
                  <Checkbox
                    checked={exportCategories.has(cat.id)}
                    onCheckedChange={(checked) => {
                      setExportCategories(prev => {
                        const next = new Set(prev)
                        if (checked) next.add(cat.id)
                        else next.delete(cat.id)
                        return next
                      })
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{cat.label}</span>
                    <span className="block text-xs text-muted-foreground">{cat.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" onClick={() => setExportCategories(new Set(EXPORT_CATEGORIES.map(c => c.id)))}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">
                Выбрать всё
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setExportDialogFor(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted text-muted-foreground">
                  Отмена
                </button>
                <button type="button" disabled={exportCategories.size === 0}
                  onClick={() => { void handleExportZip(exportDialogFor); setExportDialogFor(null) }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                  {exportingId ? <IconDownload className="w-4 h-4 animate-pulse" /> : <IconDownload className="w-4 h-4" />}
                  Экспортировать
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={!!groupEditFor} onOpenChange={(v) => { if (!v) setGroupEditFor(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconTag className="w-5 h-5 text-primary" />
              Категория сборки
            </DialogTitle>
            <DialogDescription>Выберите существующую группу или введите новую</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {groups.map(g => (
                  <button key={g} type="button"
                    onClick={() => setGroupDraft(g)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                      groupDraft === g
                        ? "bg-primary/15 border-primary text-primary"
                        : "bg-muted/50 border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                    )}>
                    {groupDraft === g && <IconCheck className="w-3 h-3" />}
                    {g}
                  </button>
                ))}
              </div>
            )}
            <input autoFocus value={groupDraft} onChange={e => setGroupDraft(e.target.value)}
              placeholder="Название группы (пусто — без группы)"
              onKeyDown={e => {
                if (e.key === "Enter" && groupEditFor) { onSetGroup(groupEditFor, groupDraft.trim()); setGroupEditFor(null) }
                if (e.key === "Escape") setGroupEditFor(null)
              }}
              className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setGroupEditFor(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-muted text-muted-foreground">
                Отмена
              </button>
              <button type="button" onClick={() => { if (groupEditFor) { onSetGroup(groupEditFor, groupDraft.trim()); setGroupEditFor(null) } }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground">
                Сохранить
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {groupContextMenu && (
        <div className="fixed z-50 min-w-[160px] rounded-xl border border-border bg-card shadow-2xl p-1"
          style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
          onClick={e => e.stopPropagation()}>
          <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
            onClick={() => { setRenameGroupFor(groupContextMenu.group); setRenameGroupDraft(groupContextMenu.group); setGroupContextMenu(null) }}>
            <IconPencil className="w-4 h-4 text-muted-foreground" />
            Переименовать
          </button>
          <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-destructive/15 text-destructive"
            onClick={() => { onDeleteGroup(groupContextMenu.group); setGroupContextMenu(null) }}>
            <IconTrashFilled className="w-4 h-4" />
            Удалить группу
          </button>
        </div>
      )}

      {buildContextMenu && (
        <div className="fixed z-50 min-w-[180px] rounded-xl border border-border bg-card shadow-2xl p-1"
          style={{ left: buildContextMenu.x, top: buildContextMenu.y }}
          onClick={e => e.stopPropagation()}>
          <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
            onClick={() => {
              const build = builds.find(b => b.id === buildContextMenu.id)
              if (build) void window.electronAPI?.getBuildIntentPath(build.name).then(p => { if (p) window.electronAPI?.openPath(p) })
              setBuildContextMenu(null)
            }}>
            <IconFolder className="w-4 h-4 text-muted-foreground" />
            Открыть папку сборки
          </button>
          <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
            onClick={() => { void onDuplicate(buildContextMenu.id); setBuildContextMenu(null) }}>
            <IconCopy className="w-4 h-4 text-muted-foreground" />
            Дублировать
          </button>
          <button type="button" disabled={exportingId === buildContextMenu.id} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground disabled:opacity-40"
            onClick={() => { setExportDialogFor(buildContextMenu.id); setExportCategories(new Set(["mods", "resourcepacks", "shaderpacks", "saves", "data"])); setBuildContextMenu(null) }}>
            <IconDownload className="w-4 h-4 text-muted-foreground" />
            Экспорт в zip
          </button>
          <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
            onClick={() => { setModlistMenuFor(buildContextMenu.id); setBuildContextMenu(null) }}>
            <IconUpload className="w-4 h-4 text-muted-foreground" />
            Экспорт модлиста
          </button>
          {buildContextMenu && modlistMenuFor === buildContextMenu.id && (
            <div className="mx-1 mb-1 rounded-lg bg-muted/50 border border-border p-1 grid grid-cols-3 gap-1">
              {MODLIST_FORMATS.map(format => (
                <button key={format.id} type="button"
                  onClick={e => { e.stopPropagation(); void handleExportModlist(buildContextMenu.id, format.id); setBuildContextMenu(null) }}
                  className="px-2 py-1 text-[11px] rounded-md hover:bg-primary/15 text-muted-foreground hover:text-primary">
                  {format.label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted text-foreground"
            onClick={() => { const build = builds.find(b => b.id === buildContextMenu.id); if (build) { setGroupEditFor(buildContextMenu.id); setGroupDraft(build.group ?? "") } setBuildContextMenu(null) }}>
            <IconTag className="w-4 h-4 text-muted-foreground" />
            Изменить категорию
          </button>
          <div className="mx-2 my-1 border-t border-border" />
          <button type="button" className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-destructive/15 text-destructive"
            onClick={() => { void handleTrash(buildContextMenu.id); setBuildContextMenu(null) }}>
            <IconTrash className="w-4 h-4" />
            В корзину
          </button>
        </div>
      )}

      {renameGroupFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          onClick={() => setRenameGroupFor(null)}>
          <div className="w-72 rounded-2xl border border-border bg-card p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold mb-3">Переименовать группу</p>
            <input autoFocus value={renameGroupDraft} onChange={e => setRenameGroupDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleRenameGroup()
                if (e.key === "Escape") setRenameGroupFor(null)
              }}
              className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary mb-3" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenameGroupFor(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-muted text-muted-foreground">Отмена</button>
              <button type="button" onClick={handleRenameGroup}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {trashedName && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 shadow-2xl">
          <p className="text-sm text-foreground"><span className="font-medium">{trashedName}</span> — в корзине</p>
          <button type="button" onClick={() => void handleUndo()} className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
            <IconRotateClockwise className="w-3.5 h-3.5" />
            Отменить
          </button>
        </div>
      )}
    </div>
  )
})
