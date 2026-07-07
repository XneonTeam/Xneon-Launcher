import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconCamera, IconCheck, IconDownload, IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { MOD_LOADERS } from "./constants"
import { useHomeVersions } from "@/src/hooks/use-home-versions"
import { useLoaderVersionOptions } from "@/src/hooks/use-loader-version-options"

interface InstanceCreateDialogProps {
  open: boolean
  setOpen: (v: boolean) => void
  onCreate: (params: { name: string; description: string; version: string; modLoader: string; loaderVersion?: string; icon: string }) => Promise<void>
  onImported: () => Promise<void>
  onImportFile: () => Promise<void>
}

type ImportSource = "gdlauncher" | "prism" | "multimc" | "polymc" | "astralrinth" | "xlauncher" | "modrinthapp"

const SOURCE_ICON_SRC: Record<ImportSource, string> = {
  gdlauncher: "/launcher-icons/gdlauncher.png",
  prism: "/launcher-icons/prism.png",
  multimc: "/launcher-icons/multimc.svg",
  polymc: "/launcher-icons/polymc.svg",
  astralrinth: "/launcher-icons/astralrinth.webp",
  xlauncher: "/launcher-icons/xlauncher.svg",
  modrinthapp: "/launcher-icons/modrinthapp.png",
}

export function InstanceCreateDialog({ open, setOpen, onCreate, onImported, onImportFile }: InstanceCreateDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<"create" | "import">("create")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [modLoader, setModLoader] = useState(MOD_LOADERS[0].id)
  const [loaderVersion, setLoaderVersion] = useState("")
  const [icon, setIcon] = useState("")
  const [importableInstances, setImportableInstances] = useState<ImportableLauncherInstance[]>([])
  const [selectedImportSource, setSelectedImportSource] = useState<ImportSource | null>(null)
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const { versions, versionsLoaded, selectedVersion: version, setSelectedVersion: setVersion } = useHomeVersions(modLoader)
  const { loaderVersions, loaderVersionsLoaded, recommendedLoaderVersion } = useLoaderVersionOptions(modLoader, version)
  const formFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setMode("create")
      setSelectedImportSource(null)
      setModLoader(MOD_LOADERS[0].id)
      setLoaderVersion("")
      void window.electronAPI?.discoverImportableInstances?.().then((instances) => {
        const next = instances ?? []
      setImportableInstances(next)
      setSelectedImportIds([])
      })
    }
  }, [open])

  const reset = () => {
    setName("")
    setDescription("")
    setIcon("")
    setLoaderVersion("")
  }

  useEffect(() => {
    if (modLoader === "vanilla" || modLoader === "instance") {
      if (loaderVersion !== "") setLoaderVersion("")
      return
    }

    if (!loaderVersionsLoaded) return
    if (loaderVersions.some(option => option.value === loaderVersion)) return
    setLoaderVersion(recommendedLoaderVersion ?? "")
  }, [loaderVersion, loaderVersions, loaderVersionsLoaded, modLoader, recommendedLoaderVersion])

  const handleCreate = async () => {
    await onCreate({ name, description, version, modLoader, loaderVersion: loaderVersion || undefined, icon })
    reset()
    setOpen(false)
  }

  const iconHasImage = icon && (icon.startsWith("data:") || icon.startsWith("http"))
  const requiresLoaderVersion = modLoader !== "vanilla" && modLoader !== "instance"
  const createDisabled = !name.trim() || (requiresLoaderVersion && (!loaderVersionsLoaded || !loaderVersion))
  const groupedSources = useMemo(() => {
    const counts = new Map<ImportSource, number>()
    for (const item of importableInstances) {
      counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
    }
    return Array.from(counts.entries())
  }, [importableInstances])

  const sourceNames: Record<ImportSource, string> = {
    gdlauncher: "GDLauncher",
    prism: "Prism Launcher",
    multimc: "MultiMC",
    polymc: "PolyMC",
    astralrinth: "AstralRinth",
    xlauncher: "X Launcher",
    modrinthapp: "Modrinth App",
  }

  const filteredImportableInstances = useMemo(() => {
    if (!selectedImportSource) return []
    return importableInstances.filter((item) => item.source === selectedImportSource)
  }, [importableInstances, selectedImportSource])

  const toggleImportSelection = (instanceId: string) => {
    setSelectedImportIds((current) =>
      current.includes(instanceId) ? current.filter((id) => id !== instanceId) : [...current, instanceId]
    )
  }

  const handleImport = async () => {
    if (!selectedImportIds.length) return
    setImporting(true)
    try {
      await window.electronAPI?.importLauncherInstances(selectedImportIds)
      await onImported()
      setOpen(false)
      reset()
    } finally {
      setImporting(false)
    }
  }

  const handleImportModpackFile = async () => {
    await onImportFile()
    await onImported()
    setOpen(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <button type="button" onClick={() => { setOpen(true); reset() }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90">
          <IconPlus className="w-4 h-4" strokeWidth={1.75} />
          {t("builds.createBuild")}
        </button>
      </DialogTrigger>
      <DialogContent className="!w-[580px] !max-w-[90vw] sm:!max-w-[580px] max-h-[82vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("builds.creatingBuild")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-3">
          <div className="inline-flex rounded-xl bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setMode("create")}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                mode === "create" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("builds.createBuild")}
            </button>
            <button
              type="button"
              onClick={() => setMode("import")}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                mode === "import" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("builds.import")}
            </button>
          </div>

          {mode === "create" ? (
            <div className="grid gap-4 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-center gap-4">
                <div
                  className="w-16 h-16 rounded-xl bg-muted/70 overflow-hidden border border-border cursor-pointer hover:border-primary/50 transition-colors flex-shrink-0 flex items-center justify-center"
                  onClick={() => formFileInputRef.current?.click()}
                >
                  {iconHasImage ? <img src={icon} alt="" className="w-full h-full object-cover" /> : <IconCamera className="w-6 h-6 text-muted-foreground" />}
                  <input
                    ref={formFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
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
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t("builds.name")} className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder={t("builds.description")} className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              <div className={cn("grid gap-3", requiresLoaderVersion ? "grid-cols-3" : "grid-cols-2")}>
                <Select value={version} onValueChange={setVersion}>
                  <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border-border text-foreground">
                    <SelectValue placeholder="Minecraft" />
                  </SelectTrigger>
                  <SelectContent>
                    {!versionsLoaded ? <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
                      : versions.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">Failed to load versions</div>
                      : versions.map((item) => <SelectItem key={item} value={item}>Minecraft {item}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={modLoader} onValueChange={setModLoader}>
                  <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border-border text-foreground">
                    <SelectValue placeholder={t("builds.modLoader")} />
                  </SelectTrigger>
                  <SelectContent>
                    {MOD_LOADERS.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {requiresLoaderVersion && (
                  <Select value={loaderVersion} onValueChange={setLoaderVersion} disabled={!loaderVersionsLoaded || loaderVersions.length === 0}>
                    <SelectTrigger className="w-full h-[42px] rounded-xl bg-muted/50 border-border text-foreground">
                      <SelectValue placeholder={loaderVersionsLoaded ? "Loader Version" : "Loading..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {!loaderVersionsLoaded ? <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
                        : loaderVersions.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">No versions available</div>
                        : loaderVersions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {requiresLoaderVersion && (
                <p className="text-xs text-muted-foreground">
                  {!loaderVersionsLoaded ? "Loading available loader versions..." : loaderVersion ? `Selected loader version: ${loaderVersion}` : "Choose an exact loader version for this instance"}
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 rounded-2xl border border-border bg-card p-4">
              {selectedImportSource ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedImportSource(null)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/20 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                      >
                        <IconArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <div>
                        <div className="text-sm font-medium text-foreground">{sourceNames[selectedImportSource]}</div>
                        <div className="text-xs text-muted-foreground">Выбери сборки для импорта</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleImport}
                      disabled={!selectedImportIds.some((id) => filteredImportableInstances.some((item) => item.id === id)) || importing}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {importing ? <IconLoader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> : <IconDownload className="w-4 h-4" strokeWidth={1.75} />}
                      {t("builds.import")}
                    </button>
                  </div>

                  <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                    {filteredImportableInstances.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-center text-muted-foreground">
                        Для этого лаунчера ничего не найдено
                      </div>
                    )}

                    {filteredImportableInstances.map((instance) => (
                      <button
                        key={instance.id}
                        type="button"
                        onClick={() => toggleImportSelection(instance.id)}
                        className={cn(
                          "w-full rounded-xl border p-3 text-left transition-colors",
                          selectedImportIds.includes(instance.id)
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted/20 hover:border-primary/40"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-background border border-border shrink-0">
                            {instance.icon ? (
                              <img src={instance.icon} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <img src={SOURCE_ICON_SRC[instance.source]} alt="" className="h-5 w-5 object-contain" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium text-foreground">{instance.name}</span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {instance.version} • {instance.loaderVersion ? `${instance.modLoader} ${instance.loaderVersion}` : instance.modLoader}
                            </div>
                          </div>
                          <div className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full border shrink-0",
                            selectedImportIds.includes(instance.id)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-transparent"
                          )}>
                            <IconCheck className="w-4 h-4" strokeWidth={2} />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-border bg-muted/10 p-4">
                    <div className="text-sm font-medium text-foreground">Локальный импорт</div>
                    <div className="mt-1 text-xs text-muted-foreground">Выбери `.mrpack`, `.zip` или импортируй сборку из другого лаунчера</div>

                    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => void handleImportModpackFile()}
                        className="flex min-h-[112px] items-center justify-center rounded-2xl border border-border bg-muted/20 p-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/30"
                      >
                        <div className="flex flex-col items-center justify-center gap-2.5">
                          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-green-500/20 bg-background text-green-500">
                            <svg className="h-8 w-8" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                              <path fill="currentColor" d="M12.252.004a11.78 11.768 0 0 0-8.92 3.73a11 11 0 0 0-2.17 3.11a11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77c.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02c.2-.04.22.1-.26-1.7l-.36-1.37l-1.01-.06a8.5 8.489 0 0 1-5.18-1.8a5.3 5.3 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97l2.07-.43l2.06-.43l1.47-1.47c.8-.8 1.48-1.5 1.48-1.52c0-.09-.42-1.63-.46-1.7c-.04-.06-.2-.03-1.02.18c-.53.13-1.2.3-1.45.4l-.48.15l-.53.53l-.53.53l-.93.1l-.93.07l-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6l.43-.57c.68-.9.68-.9 1.46-1.1c.4-.1.65-.2.83-.33c.13-.099.65-.579 1.14-1.069l.9-.9l-.7-.7l-.7-.7l-1.95.54c-1.07.3-1.96.53-1.97.53c-.03 0-2.23 2.48-2.63 2.97l-.29.35l.28 1.03c.16.56.3 1.16.31 1.34l.03.3l-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1c-.08-.1-.23-.6-.32-1.03c-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1c.06-.17.5-2.999.47-3.039c-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38c-.06.23-.46 2.42-.46 2.52c0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2a8.38 8.379 0 0 1 2.16 3.449a6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.4 9.4 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38c-.38.32-1.54 1.1-1.7 1.14c-.1.03-.1.06-.07.26c.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z"/>
                            </svg>
                          </div>
                          <div className="text-sm font-medium leading-tight text-foreground">Импорт .mrpack</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleImportModpackFile()}
                        className="flex min-h-[112px] items-center justify-center rounded-2xl border border-border bg-muted/20 p-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/30"
                      >
                        <div className="flex flex-col items-center justify-center gap-2.5">
                          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-orange-500/20 bg-background text-orange-500">
                            <svg className="h-8 w-8" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                              <path fill="currentColor" d="M18.326 9.215s4.9-.773 5.674-3.027h-7.507V4.4H0l2.032 2.358v2.415s5.127-.266 7.11 1.237c2.714 2.516-3.053 5.917-3.053 5.917l-.99 3.273c1.547-1.473 4.494-3.377 9.899-3.286c-2.057.65-4.125 1.665-5.735 3.286h10.925l-1.029-3.273s-7.918-4.668-.833-7.112"/>
                            </svg>
                          </div>
                          <div className="text-sm font-medium leading-tight text-foreground">Импорт .zip</div>
                        </div>
                      </button>

                      {groupedSources.map(([source]) => (
                        <button
                          key={source}
                          type="button"
                          onClick={() => setSelectedImportSource(source)}
                          className="flex min-h-[112px] items-center justify-center rounded-2xl border border-border bg-muted/20 p-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/30"
                        >
                          <div className="flex flex-col items-center justify-center gap-2.5">
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-background">
                              <img src={SOURCE_ICON_SRC[source]} alt="" className="h-8 w-8 object-contain" />
                            </div>
                            <div className="text-sm font-medium leading-tight text-foreground">{sourceNames[source]}</div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {groupedSources.length === 0 && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        Другие локальные лаунчеры не найдены
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            {t("settings.cancel")}
          </DialogClose>
          {mode === "create" && (
            <button type="button" onClick={handleCreate} disabled={createDisabled} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
              <IconPlus className="w-4 h-4" strokeWidth={1.75} />
              {t("builds.createBuild")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
