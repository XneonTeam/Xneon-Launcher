import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import {
  IconArchive,
  IconCopy,
  IconDownload,
  IconFolderOpen,
  IconInfoCircle,
  IconLoader2,
  IconMap,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react"
import { InstanceModal } from "./instance-modal"
import type { Build, DatapackInfo, ModalTab, ModDetails, ModSearchResult, ModVersion, Source, WorldInfo } from "./types"

interface InstanceWorldsTabProps {
  build: Build
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

function formatDate(ms: number): string {
  if (!ms) return "—"
  return new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function formatPlaytime(seconds: number): string {
  if (!seconds) return "—"
  if (seconds < 60) return `${seconds} сек`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч ${minutes % 60} мин`
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function copyToClipboard(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {})
}

export function InstanceWorldsTab({ build }: InstanceWorldsTabProps) {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [datapacks, setDatapacks] = useState<DatapackInfo[]>([])
  const [loading, setLoading] = useState(false)

  // inline rename draft
  const [nameDraft, setNameDraft] = useState("")
  const [renaming, setRenaming] = useState(false)

  // copy / import name prompt
  const [namePrompt, setNamePrompt] = useState<{ mode: "copy" | "import"; initial: string; pendingFile?: string } | null>(null)
  const [promptValue, setPromptValue] = useState("")
  const [promptBusy, setPromptBusy] = useState(false)

  // delete confirm modal
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // datapack search
  const [search, setSearch] = useState("")
  const [source, setSource] = useState<Source>("modrinth")
  const [results, setResults] = useState<ModSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  // datapack details modal
  const [selectedDetails, setSelectedDetails] = useState<ModDetails | null>(null)
  const [modalTab, setModalTab] = useState<ModalTab>("description")
  const [loadingModal, setLoadingModal] = useState(false)
  const [displayedModalVersions, setDisplayedModalVersions] = useState<ModVersion[]>([])

  const iconInputRef = useRef<HTMLInputElement>(null)
  const datapackInputRef = useRef<HTMLInputElement>(null)
  const worldZipInputRef = useRef<HTMLInputElement>(null)

  const selectedWorld = worlds?.find(w => w.folder === selectedFolder) ?? null

  const refreshWorlds = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI?.listWorlds(build.name)
      setWorlds(list ?? [])
      setSelectedFolder(prev => {
        if (prev && list?.some(w => w.folder === prev)) return prev
        return list?.[0]?.folder ?? null
      })
    } finally {
      setLoading(false)
    }
  }, [build.name])

  useEffect(() => {
    void refreshWorlds()
  }, [refreshWorlds])

  const refreshDatapacks = useCallback(async (folder: string) => {
    try {
      const list = await window.electronAPI?.listWorldDatapacks(build.name, folder)
      setDatapacks(list ?? [])
    } catch {
      setDatapacks([])
    }
  }, [build.name])

  useEffect(() => {
    if (selectedFolder) void refreshDatapacks(selectedFolder)
    else setDatapacks([])
  }, [selectedFolder, refreshDatapacks])

  useEffect(() => {
    setNameDraft(selectedWorld?.name ?? "")
  }, [selectedWorld?.folder])

  const runSearch = useCallback(async (query: string, src: Source) => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      // `as never` keeps this compiling against old @xnlc/types where
      // ModContentType has no "datapack" member yet.
      const response = src === "modrinth"
        ? await window.electronAPI?.modsModrinthSearch(query.trim(), "datapack" as never, undefined, undefined, "downloads", 0)
        : await window.electronAPI?.modsCurseforgeSearch(query.trim(), "datapack" as never, undefined, undefined, "downloads", 0)
      setResults(response?.results ?? [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(search, source), 400)
    return () => window.clearTimeout(timer)
  }, [search, source, runSearch])

  const handleRenameInline = async (next: string) => {
    if (!selectedWorld) { setNameDraft(""); return }
    const newName = next.trim()
    if (!newName || newName === selectedWorld.name) {
      setNameDraft(selectedWorld.name)
      return
    }
    setRenaming(true)
    try {
      const result = await window.electronAPI?.renameWorld(build.name, selectedWorld.folder, newName)
      if (result?.success) {
        const newFolder = newName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").slice(0, 64).replace(/\s+/g, "_")
        await refreshWorlds()
        setSelectedFolder(newFolder)
        setNameDraft(newName)
      } else {
        setNameDraft(selectedWorld.name)
        alert(result?.error ?? "Не удалось переименовать мир")
      }
    } finally {
      setRenaming(false)
    }
  }

  const submitNamePrompt = async () => {
    if (!namePrompt) return
    const name = promptValue.trim()
    setPromptBusy(true)
    try {
      if (namePrompt.mode === "copy") {
        if (!selectedWorld) return
        const result = await window.electronAPI?.copyWorld(build.name, selectedWorld.folder, name)
        if (result?.success) {
          setNamePrompt(null)
          await refreshWorlds()
          if (result.folder) setSelectedFolder(result.folder)
        } else {
          alert(result?.error ?? "Не удалось скопировать мир")
        }
      } else {
        const result = await window.electronAPI?.importWorldZip(build.name, namePrompt.pendingFile ?? "", name || undefined)
        if (result?.success) {
          setNamePrompt(null)
          await refreshWorlds()
          if (result.folder) setSelectedFolder(result.folder)
        } else {
          alert(result?.error ?? "Не удалось импортировать мир")
        }
      }
    } finally {
      setPromptBusy(false)
    }
  }

  const handleResetIcon = async () => {
    if (!selectedWorld) return
    const result = await window.electronAPI?.resetWorldIcon(build.name, selectedWorld.folder)
    if (result?.success) await refreshWorlds()
    else alert(result?.error ?? "Не удалось сбросить иконку")
  }

  const handleDelete = async () => {
    if (!selectedWorld) return
    setDeleting(true)
    try {
      const result = await window.electronAPI?.deleteWorld(build.name, selectedWorld.folder)
      if (result?.success) {
        setDeleteOpen(false)
        await refreshWorlds()
      } else {
        alert(result?.error ?? "Не удалось удалить мир")
      }
    } finally {
      setDeleting(false)
    }
  }

  const handleSetIcon = async (file: File) => {
    if (!selectedWorld) return
    const dataUrl = await readFileAsDataUrl(file)
    const result = await window.electronAPI?.setWorldIcon(build.name, selectedWorld.folder, dataUrl)
    if (result?.success) await refreshWorlds()
    else alert(result?.error ?? "Не удалось изменить иконку")
  }

  const handleImportFile = (file: File) => {
    const localPath = (file as File & { path?: string }).path
    if (!localPath) {
      alert("Не удалось получить путь к файлу")
      return
    }
    const initial = file.name.replace(/\.zip$/i, "")
    setPromptValue(initial)
    setNamePrompt({ mode: "import", initial, pendingFile: localPath })
  }

  const handleInstallDatapackLocal = async (file: File) => {
    if (!selectedWorld) return
    const localPath = (file as File & { path?: string }).path
    if (!localPath) {
      alert("Не удалось получить путь к файлу")
      return
    }
    const result = await window.electronAPI?.installDatapackLocal(build.name, selectedWorld.folder, localPath)
    if (!result?.success) {
      alert(result?.error ?? "Не удалось установить датапак")
      return
    }
    await refreshDatapacks(selectedWorld.folder)
  }

  const handleInstallDatapackRemote = async (mod: ModSearchResult) => {
    if (!selectedWorld) return
    setInstalling(mod.id)
    try {
      if (mod.source === "modrinth") {
        const versions = await window.electronAPI?.modsModrinthVersions(mod.slug)
        const version = versions?.find(v => v.files?.[0]?.url)
        if (!version?.files?.[0]) {
          alert("Не найдена подходящая версия датапака")
          return
        }
        const file = version.files[0]
        const result = await window.electronAPI?.installDatapackRemote(build.name, selectedWorld.folder, file.url, file.filename || `${mod.slug}.zip`)
        if (!result?.success) alert(result?.error ?? "Не удалось скачать датапак")
      } else if (mod.modId) {
        const details = await window.electronAPI?.modsCurseforgeDetails(mod.modId)
        const version = details?.versions?.find(v => Number(v.id) === mod.primaryFileId) ?? details?.versions?.[0]
        if (!version) {
          alert("Не найдена подходящая версия датапака")
          return
        }
        const url = await window.electronAPI?.modsCurseforgeDownloadUrl(Number(version.id), mod.modId)
        if (!url) {
          alert("Не удалось получить ссылку на скачивание")
          return
        }
        const fileName = version.fileName || url.split("/").pop()?.split("?")[0] || `${mod.slug}.zip`
        const result = await window.electronAPI?.installDatapackRemote(build.name, selectedWorld.folder, url, fileName)
        if (!result?.success) alert(result?.error ?? "Не удалось скачать датапак")
      }
      await refreshDatapacks(selectedWorld.folder)
    } finally {
      setInstalling(null)
    }
  }

  const handleDeleteDatapack = async (name: string) => {
    if (!selectedWorld) return
    const result = await window.electronAPI?.deleteWorldDatapack(build.name, selectedWorld.folder, name)
    if (!result?.success) {
      alert(result?.error ?? "Не удалось удалить датапак")
      return
    }
    await refreshDatapacks(selectedWorld.folder)
  }

  const openDatapackDetails = async (mod: ModSearchResult) => {
    setLoadingModal(true)
    try {
      const details = mod.source === "modrinth"
        ? await window.electronAPI?.modsModrinthDetails(mod.slug)
        : mod.modId
          ? await window.electronAPI?.modsCurseforgeDetails(mod.modId)
          : null
      if (details) {
        setSelectedDetails(details)
        setDisplayedModalVersions(details.versions ?? [])
        setModalTab("description")
      } else {
        alert("Не удалось загрузить информацию о датапаке")
      }
    } catch {
      alert("Не удалось загрузить информацию о датапаке")
    } finally {
      setLoadingModal(false)
    }
  }

  const handleInstallDatapackVersion = async (version: ModVersion) => {
    if (!selectedWorld) return
    const url = version.downloadUrl || version.files?.[0]?.url
    if (!url) {
      alert("Нет ссылки на скачивание")
      return
    }
    const fileName = version.fileName || url.split("/").pop()?.split("?")[0] || "datapack.zip"
    const result = await window.electronAPI?.installDatapackRemote(build.name, selectedWorld.folder, url, fileName)
    if (!result?.success) {
      alert(result?.error ?? "Не удалось скачать датапак")
      return
    }
    await refreshDatapacks(selectedWorld.folder)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {worlds === null ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <IconLoader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : worlds.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/50">
            <IconMap className="h-9 w-9 text-muted-foreground/50" strokeWidth={1.5} />
          </div>
          <div className="text-lg font-semibold text-foreground">Миров пока нет</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Миры появятся здесь после первого запуска сборки. Зайди в игру и создай новый мир — он сразу будет виден в этой вкладке.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* World list */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">Миры · {worlds.length}</div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => worldZipInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <IconUpload className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Загрузить ZIP
                </button>
                <button
                  type="button"
                  onClick={() => void refreshWorlds()}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <IconRefresh className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
                  Обновить
                </button>
              </div>
              <input
                ref={worldZipInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleImportFile(file)
                  e.target.value = ""
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {worlds.map(world => (
                <button
                  key={world.folder}
                  type="button"
                  onClick={() => setSelectedFolder(world.folder)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                    selectedFolder === world.folder
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/40"
                  )}
                >
                  <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-muted/50">
                    {world.iconDataUrl ? (
                      <img src={world.iconDataUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <IconMap className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{world.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {world.gameMode}
                      {world.hardcore ? " · Хардкор" : ""}
                      {world.mcVersion ? ` · ${world.mcVersion}` : ""}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                      <span>Играл: {formatDate(world.lastPlayed)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Selected world detail */}
          {selectedWorld && (
            <div className="rounded-3xl border border-border bg-card/40 p-5">
              <div className="flex items-start gap-4">
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-2xl border border-border bg-muted/50">
                  {selectedWorld.iconDataUrl ? (
                    <img src={selectedWorld.iconDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <IconMap className="h-8 w-8 text-muted-foreground/40" strokeWidth={1.5} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleResetIcon()}
                    title="Сбросить иконку мира"
                    className="absolute bottom-1 right-9 flex h-7 w-7 items-center justify-center rounded-lg bg-background/85 text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                  >
                    <IconX className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => iconInputRef.current?.click()}
                    title="Сменить иконку мира"
                    className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-lg bg-background/85 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                  >
                    <IconPhoto className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) void handleSetIcon(file)
                      e.target.value = ""
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    value={nameDraft}
                    onChange={e => setNameDraft(e.target.value)}
                    onBlur={() => void handleRenameInline(nameDraft)}
                    onKeyDown={e => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                      else if (e.key === "Escape") {
                        setNameDraft(selectedWorld.name)
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    disabled={renaming}
                    maxLength={64}
                    placeholder="Название мира"
                    title="Название мира (Enter — сохранить)"
                    className={cn(
                      "h-10 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary",
                      renaming && "opacity-60"
                    )}
                  />
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {selectedWorld.gameMode}
                    {selectedWorld.hardcore ? " · Хардкор" : ""}
                    {selectedWorld.mcVersion ? ` · MC ${selectedWorld.mcVersion}` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => window.electronAPI?.openPath(selectedWorld.path)}
                      className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <IconFolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Папка мира
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPromptValue(`${selectedWorld.name} (копия)`); setNamePrompt({ mode: "copy", initial: `${selectedWorld.name} (копия)` }) }}
                      className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <IconCopy className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Копировать
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteOpen(true)}
                      className="flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
                    >
                      <IconTrash className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Удалить
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 sm:grid-cols-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Сид</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="max-w-[120px] truncate text-sm font-medium text-foreground" title={selectedWorld.seed || "Сид неизвестен"}>
                      {selectedWorld.seed || "—"}
                    </span>
                    {selectedWorld.seed && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedWorld.seed)}
                        title="Копировать сид"
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <IconCopy className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Наиграно</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{formatPlaytime(selectedWorld.playedTime)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Размер</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{formatBytes(selectedWorld.sizeBytes)}</div>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Последний вход</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{formatDate(selectedWorld.lastPlayed)}</div>
                </div>
              </div>

              {/* Datapacks */}
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <IconArchive className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                    Датапаки · {datapacks.length}
                  </div>
                  <button
                    type="button"
                    onClick={() => datapackInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <IconUpload className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Загрузить файл
                  </button>
                  <input
                    ref={datapackInputRef}
                    type="file"
                    accept=".zip,.mcpack,.datapack"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) void handleInstallDatapackLocal(file)
                      e.target.value = ""
                    }}
                  />
                </div>

                {datapacks.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {datapacks.map(dp => (
                      <div key={dp.name} className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
                        <IconArchive className="h-4 w-4 flex-shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">{dp.name}</div>
                          <div className="text-[11px] text-muted-foreground">{formatBytes(dp.sizeBytes)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteDatapack(dp.name)}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="Удалить датапак"
                        >
                          <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Search datapacks on Modrinth / CurseForge */}
                <div className="mt-4 rounded-2xl border border-border/70 bg-muted/15 p-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" strokeWidth={1.75} />
                      <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Найти датапак на Modrinth или CurseForge..."
                        className="h-10 w-full rounded-xl border border-border bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex rounded-xl bg-muted/50 p-1">
                      {(["modrinth", "curseforge"] as Source[]).map(src => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => setSource(src)}
                          className={cn(
                            "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors border",
                            source === src ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                        >
                          {src === "modrinth" ? "Modrinth" : "CurseForge"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {searching && (
                    <div className="mt-3 flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                      <IconLoader2 className="h-4 w-4 animate-spin" /> Поиск...
                    </div>
                  )}

                  {!searching && results && results.length === 0 && (
                    <div className="mt-3 py-4 text-center text-sm text-muted-foreground">Ничего не найдено</div>
                  )}

                  {!searching && results && results.length > 0 && (
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                      {results.map(mod => (
                        <div key={mod.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-2.5">
                          {mod.iconUrl ? (
                            <img src={mod.iconUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-lg object-cover" />
                          ) : (
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted/50">
                              <IconArchive className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.75} />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">{mod.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {mod.downloadCount.toLocaleString("ru-RU")} скачиваний
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void openDatapackDetails(mod)}
                            className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <IconInfoCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                            Подробнее
                          </button>
                          <button
                            type="button"
                            disabled={installing === mod.id}
                            onClick={() => void handleInstallDatapackRemote(mod)}
                            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {installing === mod.id ? (
                              <IconLoader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            ) : (
                              <IconDownload className="h-3.5 w-3.5" strokeWidth={2} />
                            )}
                            Установить
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Copy / import name prompt modal */}
      {namePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl border border-border animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                {namePrompt.mode === "copy" ? "Копировать мир" : "Импортировать мир из ZIP"}
              </h3>
              <button
                type="button"
                onClick={() => setNamePrompt(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <IconX className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {namePrompt.mode === "copy"
                ? `Будет создана копия мира «${selectedWorld?.name ?? ""}». Введи название для копии.`
                : "Введи название для мира. Если оставить поле пустым — имя возьмётся из архива."}
            </p>
            <input
              type="text"
              value={promptValue}
              onChange={e => setPromptValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void submitNamePrompt() }}
              autoFocus
              maxLength={64}
              placeholder="Название мира"
              className="mt-4 h-12 w-full rounded-2xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setNamePrompt(null)}
                className="flex-1 rounded-2xl border border-border bg-muted/30 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={promptBusy}
                onClick={() => void submitNamePrompt()}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {promptBusy && <IconLoader2 className="h-4 w-4 animate-spin" />}
                {namePrompt.mode === "copy" ? "Копировать" : "Импортировать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteOpen && selectedWorld && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl border border-border animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Удалить мир?</h3>
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <IconX className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Мир «{selectedWorld.name}» будет удалён навсегда вместе со всеми постройками, инвентарём и датапаками. Это действие нельзя отменить.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                className="flex-1 rounded-2xl border border-border bg-muted/30 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {deleting && <IconLoader2 className="h-4 w-4 animate-spin" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Datapack details modal */}
      <InstanceModal
        selectedDetails={selectedDetails}
        modalTab={modalTab}
        setModalTab={setModalTab}
        loadingModal={loadingModal}
        displayedModalVersions={displayedModalVersions}
        onInstallVersion={(version) => void handleInstallDatapackVersion(version)}
        onClose={() => setSelectedDetails(null)}
      />
    </div>
  )
}
