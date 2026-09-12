import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import {
  IconX,
  IconFileText,
  IconPhoto,
  IconHistory,
  IconDownload,
  IconRefresh,
  IconCheck,
  IconArrowRight,
  IconAlertTriangle,
  IconPackage,
  IconLoader2,
  IconExternalLink,
  IconBrandGithub,
  IconBug,
  IconBook,
  IconBrandDiscord,
} from "@tabler/icons-react"
import { Spinner } from "./spinner"
import { LoaderIcon } from "./loader-icon"
import { MOD_LOADERS } from "./constants"
import { matchesBuildLoader } from "./utils"
import { VersionInstallProgress, type InstallState } from "./version-install-progress"
import type { Build, ModDetails, ModalTab, ModVersion } from "./types"

function loaderLabel(loaderId: string): string {
  return MOD_LOADERS.find(item => item.id === loaderId)?.name ?? loaderId
}

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

interface InstanceModalProps {
  selectedDetails: ModDetails | null
  modalTab: ModalTab
  setModalTab: (tab: ModalTab) => void
  loadingModal: boolean
  displayedModalVersions: ModVersion[]
  /** Установка версии. Вернуть false, если установка отложена (например, ждём подтверждения зависимостей) */
  onInstallVersion: (version: ModVersion) => Promise<boolean | void> | void
  onClose: () => void
  activeBuild?: Build
  /** Обновление до выбранной версии. Вернуть false, если установка отложена */
  onUpdateModpack?: (version: ModVersion) => Promise<boolean | void> | void
  /** Какие версии показаны: точное совпадение, другой MC, другой загрузчик и т.д. */
  versionsFallback?: "none" | "otherMc" | "otherLoader" | "empty"
  /** Учитывался ли при фильтрации загрузчик сборки (только для вкладки «Моды») */
  versionsLoaderFiltered?: boolean
  onShowAllVersions?: () => void
  allVersionsCount?: number
}

export function InstanceModal({
  selectedDetails,
  modalTab,
  setModalTab,
  loadingModal,
  displayedModalVersions,
  onInstallVersion,
  onClose,
  activeBuild,
  onUpdateModpack,
  versionsFallback = "none",
  versionsLoaderFiltered = false,
  onShowAllVersions,
  allVersionsCount = 0,
}: InstanceModalProps) {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [selectedUpdateVersion, setSelectedUpdateVersion] = useState<ModVersion | null>(null)
  const showAllVersionsActive = versionsFallback === "otherMc" || versionsFallback === "otherLoader"
  const [install, setInstall] = useState<InstallState | null>(null)
  const [cfChangelogs, setCfChangelogs] = useState<Record<string, string>>({})
  const [loadingChangelog, setLoadingChangelog] = useState(false)
  const installVersionRef = useRef<string | null>(null)
  const installStateRef = useRef<InstallState | null>(null)
  const doneTimerRef = useRef<number | null>(null)

  useEffect(() => { installStateRef.current = install }, [install])

  // Прогресс скачивания файлов приходит из main-процесса по имени файла.
  // Подписка одна на всё время жизни окна, чтобы не пропустить первые события.
  useEffect(() => {
    const off = window.electronAPI?.onContentDownloadProgress?.((progress) => {
      if (installStateRef.current?.phase !== "running") return
      setInstall(prev => {
        if (!prev || prev.phase !== "running") return prev
        const percent = progress.total > 0
          ? Math.min(100, Math.round((progress.current / progress.total) * 100))
          : null
        return { ...prev, percent, fileName: progress.fileName }
      })
    })
    return () => off?.()
  }, [])

  useEffect(() => () => {
    if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
  }, [])

  // Автоматическая загрузка ченджлогов для версий CurseForge
  useEffect(() => {
    if (modalTab !== "changelog") return
    if (selectedDetails?.source !== "curseforge" || !selectedDetails.modId) return

    const versionsToFetch = displayedModalVersions.slice(0, 5).filter(v => !v.changelog && !cfChangelogs[v.id])
    if (versionsToFetch.length === 0) return

    let cancelled = false
    setLoadingChangelog(true)

    Promise.all(
      versionsToFetch.map(async (v) => {
        const fileId = Number(v.id)
        if (!fileId || isNaN(fileId)) return null
        try {
          const text = await window.electronAPI?.modsCurseforgeChangelog(selectedDetails.modId!, fileId)
          return { id: v.id, text: text || "" }
        } catch {
          return null
        }
      })
    ).then((results) => {
      if (cancelled) return
      const updates: Record<string, string> = {}
      for (const res of results) {
        if (res) updates[res.id] = res.text
      }
      setCfChangelogs(prev => ({ ...prev, ...updates }))
      setLoadingChangelog(false)
    })

    return () => { cancelled = true }
  }, [modalTab, selectedDetails?.id, selectedDetails?.modId, displayedModalVersions])

  const runVersionInstall = useCallback(async (
    version: ModVersion,
    action: () => Promise<boolean | void> | void,
  ) => {
    if (installVersionRef.current) return
    if (doneTimerRef.current !== null) {
      window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
    installVersionRef.current = version.id
    setInstall({ versionId: version.id, phase: "running", percent: null })

    let completed = false
    try {
      const result = await action()
      completed = result !== false
    } catch (e) {
      installVersionRef.current = null
      setInstall({
        versionId: version.id,
        phase: "error",
        percent: null,
        error: e instanceof Error ? e.message : "Не удалось установить версию",
      })
      return
    }

    installVersionRef.current = null

    if (!completed) {
      // Установку перехватил другой диалог (например, подтверждение зависимостей)
      setInstall(null)
      return
    }

    setInstall({ versionId: version.id, phase: "done", percent: 100 })
    doneTimerRef.current = window.setTimeout(() => {
      setInstall(prev => (prev?.versionId === version.id && prev.phase === "done" ? null : prev))
      doneTimerRef.current = null
    }, 2200)
  }, [])

  // Сбрасываем состояние прогресса при смене мода
  useEffect(() => {
    setInstall(null)
    setSelectedUpdateVersion(null)
  }, [selectedDetails?.id, selectedDetails?.projectId])

  if (!selectedDetails) return null

  const title = selectedDetails.name
  const description = selectedDetails.summary
  const iconUrl = selectedDetails.iconUrl
  const body = selectedDetails.body
  const gallery = selectedDetails.gallery

  const isInstalled = activeBuild && (
    activeBuild.mods.some(m => m.projectId === selectedDetails.projectId || m.projectId === selectedDetails.id)
    || activeBuild.resourcepacks.some(m => m.projectId === selectedDetails.projectId || m.projectId === selectedDetails.id)
    || activeBuild.shaders.some(m => m.projectId === selectedDetails.projectId || m.projectId === selectedDetails.id)
  )

  const installedVersion = activeBuild && selectedDetails.projectId
    ? activeBuild.mods.find(m => m.projectId === selectedDetails.projectId)?.version
      ?? activeBuild.resourcepacks.find(m => m.projectId === selectedDetails.projectId)?.version
      ?? activeBuild.shaders.find(m => m.projectId === selectedDetails.projectId)?.version
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[85vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-4">
            {iconUrl ? (
              <img src={iconUrl} alt="" className="w-16 h-16 rounded-xl flex-shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <span className="text-2xl font-bold">{title[0]}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">{title}</h2>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{description}</p>
                  {selectedDetails.links && (
                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                      {selectedDetails.links.sourceUrl && (
                        <a
                          href={selectedDetails.links.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBrandGithub className="w-3.5 h-3.5" />
                          <span>Исходный код</span>
                        </a>
                      )}
                      {selectedDetails.links.wikiUrl && (
                        <a
                          href={selectedDetails.links.wikiUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBook className="w-3.5 h-3.5" />
                          <span>Вики / Документация</span>
                        </a>
                      )}
                      {selectedDetails.links.issuesUrl && (
                        <a
                          href={selectedDetails.links.issuesUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBug className="w-3.5 h-3.5" />
                          <span>Багтрекер</span>
                        </a>
                      )}
                      {selectedDetails.links.discordUrl && (
                        <a
                          href={selectedDetails.links.discordUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBrandDiscord className="w-3.5 h-3.5" />
                          <span>Discord</span>
                        </a>
                      )}
                      {selectedDetails.links.websiteUrl && (
                        <a
                          href={selectedDetails.links.websiteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconExternalLink className="w-3.5 h-3.5" />
                          <span>Страница проекта</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isInstalled && installedVersion && onUpdateModpack && (
                    <button
                      onClick={() => setShowUpdateDialog(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                    >
                      <IconRefresh className="w-4 h-4" strokeWidth={1.75} />
                      Обновить
                    </button>
                  )}
                  <button onClick={onClose} className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <IconX className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex border-b border-border px-2 flex-shrink-0">
          {([
            { id: "description" as ModalTab, icon: IconFileText },
            { id: "gallery" as ModalTab, icon: IconPhoto },
            { id: "changelog" as ModalTab, icon: IconHistory },
            { id: "versions" as ModalTab, icon: IconDownload },
          ]).map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setModalTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors relative capitalize rounded-t-lg",
                modalTab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {id}
              {modalTab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loadingModal && <Spinner />}
          {!loadingModal && modalTab === "description" && (
            <div>
              {body ? (
                <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{body}</ReactMarkdown>
              ) : (
                <p className="text-muted-foreground">{description}</p>
              )}
            </div>
          )}
          {!loadingModal && modalTab === "gallery" && (
            <div>
              {gallery && gallery.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {gallery.map((img, i) => (
                    <div key={i} className="group relative overflow-hidden rounded-xl border border-border bg-muted/20">
                      <img src={img.url} alt={img.title || ""} className="w-full h-56 object-cover group-hover:scale-105 transition-transform duration-300" />
                      {img.title && (
                        <div className="absolute inset-x-0 bottom-0 bg-background/80 backdrop-blur-sm px-3 py-2 text-xs text-foreground font-medium border-t border-border">
                          {img.title}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="col-span-2 text-center text-muted-foreground py-12">Нет скриншотов</p>
              )}
            </div>
          )}
          {!loadingModal && modalTab === "changelog" && (
            <div className="space-y-4">
              {displayedModalVersions.length > 0 ? (
                displayedModalVersions.slice(0, 5).map((ver) => (
                  <div key={ver.id} className="p-4 rounded-xl bg-muted/20 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-foreground">{ver.name}</h4>
                      <span className="text-xs text-muted-foreground">{ver.datePublished ? new Date(ver.datePublished).toLocaleDateString() : ""}</span>
                    </div>
                    {(() => {
                      const changelogText = ver.changelog || cfChangelogs[ver.id]
                      if (changelogText) {
                        return (
                          <div className="text-sm text-muted-foreground">
                            <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{changelogText}</ReactMarkdown>
                          </div>
                        )
                      }
                      if (loadingChangelog) {
                        return (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                            <IconLoader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            <span>Загрузка списка изменений...</span>
                          </div>
                        )
                      }
                      return <p className="text-sm text-muted-foreground">Нет changelog</p>
                    })()}
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-12">Нет changelog</p>
              )}
            </div>
          )}
          {!loadingModal && modalTab === "versions" && (
            <div className="space-y-2">
              {/* Предупреждение показывается только если пользователь сам нажал «Показать все версии» */}
              {showAllVersionsActive && activeBuild && (
                <div className="flex items-center gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3.5 py-2.5 text-xs text-yellow-500/90">
                  <IconAlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                  <span>
                    Показаны все версии проекта. Версии под другие сборки или загрузчики <span className="font-medium">не запустятся</span> в вашей сборке.
                  </span>
                </div>
              )}

              {displayedModalVersions.length > 0 ? (
                displayedModalVersions.slice(0, 50).map((ver) => {
                  const mismatch = versionsLoaderFiltered && activeBuild
                    ? !matchesBuildLoader(ver, activeBuild)
                    : false
                  const installState = install?.versionId === ver.id ? install : null
                  const busy = install?.phase === "running"
                  return (
                  <div
                    key={ver.id}
                    className={cn(
                      "p-4 rounded-xl border transition-colors",
                      mismatch
                        ? "border-red-500/20 bg-red-500/5"
                        : installState?.phase === "error"
                          ? "border-red-500/25 bg-red-500/5"
                          : installState?.phase === "done"
                            ? "border-green-500/25 bg-green-500/5"
                            : installState
                              ? "border-primary/40 bg-primary/5"
                              : "bg-muted/20 border-border hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{ver.name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {ver.gameVersion ?? ""}
                          </span>
                          {ver.loaders && ver.loaders.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {ver.loaders.map(l => (
                                <LoaderIcon key={l} loaderId={String(l).toLowerCase()} className="w-3.5 h-3.5" />
                              ))}
                              <span>{Array.isArray(ver.loaders) ? ver.loaders.join(", ") : ""}</span>
                            </span>
                          )}
                          {mismatch && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">
                              другой загрузчик
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => void runVersionInstall(ver, () => onInstallVersion(ver))}
                        disabled={busy}
                        className={cn(
                          "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ml-3",
                          busy
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        )}
                      >
                        {installState?.phase === "running" ? (
                          <>
                            <IconLoader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                            Установка...
                          </>
                        ) : (
                          <>
                            <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                            Скачать
                          </>
                        )}
                      </button>
                    </div>

                    {installState && <VersionInstallProgress state={installState} />}
                  </div>
                  )
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <IconPackage className="h-8 w-8 text-muted-foreground/60 mb-3" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-foreground">Нет версий для вашей сборки</p>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                    {activeBuild ? (
                      <>
                        <span>Не найдено версий для</span>
                        <LoaderIcon loaderId={activeBuild.modLoader} className="w-3.5 h-3.5" />
                        <span>{loaderLabel(activeBuild.modLoader)} {activeBuild.version}</span>
                      </>
                    ) : (
                      <span>Не найдено подходящих версий</span>
                    )}
                  </div>
                  {onShowAllVersions && allVersionsCount > 0 && (
                    <button
                      onClick={onShowAllVersions}
                      className="mt-4 flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border bg-muted/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <IconAlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />
                      Показать все версии ({allVersionsCount})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showUpdateDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => { setShowUpdateDialog(false); setSelectedUpdateVersion(null) }}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-foreground">Обновить модпак</h3>
                  <p className="text-sm text-muted-foreground mt-1">Текущая версия: {installedVersion}</p>
                </div>
                <button
                  onClick={() => { setShowUpdateDialog(false); setSelectedUpdateVersion(null) }}
                  className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-2">
                {displayedModalVersions.map((ver) => {
                  const isCurrent = installedVersion === ver.name || installedVersion === ver.id
                  const isSelected = selectedUpdateVersion?.id === ver.id
                  const isOlder = installedVersion && ver.name < installedVersion
                  const installState = install?.versionId === ver.id ? install : null
                  const busy = install?.phase === "running"

                  return (
                    <button
                      key={ver.id}
                      type="button"
                      onClick={() => setSelectedUpdateVersion(isSelected ? null : ver)}
                      className={cn(
                        "w-full text-left p-4 rounded-xl border transition-colors",
                        installState?.phase === "error"
                          ? "border-red-500/25 bg-red-500/5"
                          : installState?.phase === "done"
                            ? "border-green-500/25 bg-green-500/5"
                            : isSelected
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
                              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1.5">
                                {(Array.isArray(ver.loaders) ? ver.loaders : [ver.loaders]).map(l => (
                                  <LoaderIcon key={String(l)} loaderId={String(l).toLowerCase()} className="w-3.5 h-3.5" />
                                ))}
                                <span>{Array.isArray(ver.loaders) ? ver.loaders.join(", ") : ver.loaders}</span>
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

                      {installState && <VersionInstallProgress state={installState} />}

                      {isSelected && !installState && (
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
                              onClick={(e) => {
                                e.stopPropagation()
                                void runVersionInstall(ver, async () => {
                                  const result = await onUpdateModpack?.(ver)
                                  return result === false ? false : true
                                })
                              }}
                              disabled={busy}
                              className={cn(
                                "mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                busy
                                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                                  : "bg-primary text-primary-foreground hover:bg-primary/90"
                              )}
                            >
                              {busy ? (
                                <>
                                  <IconLoader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                                  Обновление...
                                </>
                              ) : (
                                <>
                                  <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                                  Обновить до этой версии
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
