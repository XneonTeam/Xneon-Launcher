import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { openAgent } from "./agent/store"
import { openProjectPage, projectPageUrl, type ProjectKind } from "@/lib/project-links"
import {
  IconX,
  IconRobot,
  IconFileText,
  IconPhoto,
  IconHistory,
  IconDownload,
  IconCheck,
  IconAlertTriangle,
  IconPackage,
  IconLoader2,
  IconExternalLink,
  IconBrandGithub,
  IconBug,
  IconBook,
  IconBrandDiscord,
} from "@tabler/icons-react"
import { Spinner } from "./instance/spinner"
import { LoaderIcon } from "./instance/loader-icon"
import { ChangelogContent } from "./instance/changelog-content"
import { MOD_LOADERS } from "./instance/constants"
import { isInstalledVersion, matchesBuildLoader } from "./instance/utils"
import { GameVersionChips, LoaderBadges } from "./instance/version-chips"
import { VersionInstallProgress, type InstallState } from "./instance/version-install-progress"
import type { Build, ModDetails, ModalTab, ModVersion } from "./instance/types"

function loaderLabel(loaderId: string): string {
  return MOD_LOADERS.find(item => item.id === loaderId)?.name ?? loaderId
}

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 data-ui="addon-detail-modal-h1-1" className="text-2xl font-bold text-foreground mt-6 mb-3 pb-2 border-b border-border">{children}</h1>,
  h2: ({ children }) => <h2 data-ui="addon-detail-modal-h2-1" className="text-xl font-bold text-foreground mt-5 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 data-ui="addon-detail-modal-h3-1" className="text-lg font-semibold text-foreground mt-4 mb-2">{children}</h3>,
  p: ({ children }) => <p data-ui="addon-detail-modal-p-1" className="text-muted-foreground mb-3 leading-relaxed">{children}</p>,
  li: ({ children }) => <li data-ui="addon-detail-modal-li-1" className="text-muted-foreground ml-4 mb-1">{children}</li>,
  ul: ({ children }) => <ul data-ui="addon-detail-modal-ul-1" className="list-disc mb-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol data-ui="addon-detail-modal-ol-1" className="list-decimal mb-4 space-y-1">{children}</ol>,
  code: ({ children }) => <code data-ui="addon-detail-modal-code-1" className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground">{children}</code>,
  pre: ({ children }) => <pre data-ui="addon-detail-modal-pre-1" className="bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4">{children}</pre>,
  a: ({ href, children }) => <a data-ui="addon-detail-modal-a-1" href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  strong: ({ children }) => <strong data-ui="addon-detail-modal-strong-1" className="text-foreground font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote data-ui="addon-detail-modal-blockquote-1" className="border-l-4 border-primary/50 pl-4 my-4 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr data-ui="addon-detail-modal-hr-1" className="border-border my-6" />,
  img: ({ src, alt }) => <img data-ui="addon-detail-modal-img-1" src={src} alt={alt || ""} className="rounded-lg max-w-full my-4" />,
  table: ({ children }) => (
    <div data-ui="addon-detail-modal-div-1" className="my-4 overflow-x-auto rounded-xl border border-border">
      <table data-ui="addon-detail-modal-table-1" className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead data-ui="addon-detail-modal-thead-1" className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => <tbody data-ui="addon-detail-modal-tbody-1">{children}</tbody>,
  tr: ({ children }) => <tr data-ui="addon-detail-modal-tr-1" className="border-b border-border last:border-0">{children}</tr>,
  th: ({ children }) => (
    <th data-ui="addon-detail-modal-th-1" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td data-ui="addon-detail-modal-td-1" className="px-4 py-2.5 align-top text-muted-foreground">{children}</td>,
}

export interface AddonDetailModalProps {
  /** Детали мода/плагина; null — окно закрыто. */
  selectedDetails: ModDetails | null
  modalTab: ModalTab
  setModalTab: (tab: ModalTab) => void
  loadingModal: boolean
  /** Версии, отобранные вызывающей стороной (сборка или сервер). */
  displayedModalVersions: ModVersion[]
  /** Установка версии. Вернуть false, если установка отложена (например, ждём подтверждения зависимостей). */
  onInstallVersion?: (version: ModVersion) => Promise<boolean | void> | void
  loadError?: string
  onClose: () => void
  /** Сборка, для которой открыт мод. Нужна только для подсказок по загрузчику (инстансы). */
  activeBuild?: Build
  /** Версия этого мода, уже стоящая в сборке: помечаем её в списке версий. */
  installedVersion?: string
  /** Обновление до выбранной версии. Вернуть false, если установка отложена. */
  onUpdateModpack?: (version: ModVersion) => Promise<boolean | void> | void
  /** Какие версии показаны: точное совпадение, другой MC, другой загрузчик и т.д. */
  versionsFallback?: "none" | "otherMc" | "otherLoader" | "empty"
  /** Учитывался ли при фильтрации загрузчик сборки (только для вкладки «Моды»). */
  versionsLoaderFiltered?: boolean
  onShowAllVersions?: () => void
  allVersionsCount?: number
  /** Цель установки — для текста пустого состояния: «для вашей сборки» / «для вашего сервера». */
  targetLabel?: string
  /** Тип проекта — для ссылки на страницу площадки. */
  projectKind?: ProjectKind
}

/**
 * Универсальное окно мода/плагина (описание, галерея, changelog, версии).
 * Используется и в сборках, и на серверах: вся специфика (фильтр версий,
 * показ всех версий, обновление модпака) передаётся через опциональные пропсы.
 */
export function AddonDetailModal({
  selectedDetails,
  modalTab,
  setModalTab,
  loadingModal,
  displayedModalVersions,
  onInstallVersion,
  loadError,
  onClose,
  activeBuild,
  installedVersion,
  onUpdateModpack,
  versionsFallback = "none",
  versionsLoaderFiltered = false,
  onShowAllVersions,
  allVersionsCount = 0,
  targetLabel,
  projectKind = "mod",
}: AddonDetailModalProps) {
  const { t } = useTranslation()
  const siteUrl = selectedDetails ? projectPageUrl(selectedDetails, projectKind) : null
  const resolvedTargetLabel = targetLabel ?? t("addon.target.build")
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

  // Автоматическая загрузка ченджлогов для версий: ни CurseForge, ни FTB не кладут
  // их в список версий — у обеих площадок для этого отдельный запрос.
  useEffect(() => {
    const source = selectedDetails?.source
    if (!selectedDetails || (source !== "curseforge" && source !== "ftb")) return

    const projectId = source === "curseforge"
      ? selectedDetails.modId
      : Number(selectedDetails.projectId ?? selectedDetails.id)
    if (!projectId || Number.isNaN(projectId)) return

    const targetVersions = modalTab === "changelog"
      ? displayedModalVersions.slice(0, 5)
      : selectedUpdateVersion
        ? [selectedUpdateVersion]
        : []

    const versionsToFetch = targetVersions.filter(v => !v.changelog && !cfChangelogs[v.id])
    if (versionsToFetch.length === 0) return

    let cancelled = false
    setLoadingChangelog(true)

    Promise.all(
      versionsToFetch.map(async (v) => {
        try {
          let text: string | undefined
          if (source === "curseforge") {
            const fileId = Number(v.id)
            if (!fileId || isNaN(fileId)) return null
            text = await window.electronAPI?.modsCurseforgeChangelog(projectId, fileId)
          } else {
            // Версии FTB приходят с id вида `ftb-<versionId>`.
            const versionId = Number(String(v.id).replace(/^ftb-/, ""))
            if (!versionId || isNaN(versionId)) return null
            text = await window.electronAPI?.modsFtbChangelog(projectId, versionId)
          }
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
  }, [modalTab, selectedDetails?.id, selectedDetails?.modId, selectedDetails?.projectId, selectedDetails?.source, displayedModalVersions, selectedUpdateVersion])

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
        error: e instanceof Error ? e.message : t("addon.install.failed"),
      })
      return
    }

    installVersionRef.current = null

    if (!completed) {
      setInstall(null)
      return
    }

    setInstall({ versionId: version.id, phase: "done", percent: 100 })
    doneTimerRef.current = window.setTimeout(() => {
      setInstall(prev => (prev?.versionId === version.id && prev.phase === "done" ? null : prev))
      doneTimerRef.current = null
    }, 2200)
  }, [])

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

  return (
    <div data-ui="addon-detail-modal-div-2" data-component="addon-detail-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div data-ui="addon-detail-modal-div-3"
        className="w-full max-w-5xl max-h-[85vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div data-ui="addon-detail-modal-div-4" className="p-5 border-b border-border flex-shrink-0">
          <div data-ui="addon-detail-modal-div-5" className="flex items-start gap-4">
            {iconUrl ? (
              <img data-ui="addon-detail-modal-img-2" src={iconUrl} alt="" className="w-16 h-16 rounded-xl flex-shrink-0" />
            ) : (
              <div data-ui="addon-detail-modal-div-6" className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <span data-ui="addon-detail-modal-span-1" className="text-2xl font-bold">{title[0]}</span>
              </div>
            )}
            <div data-ui="addon-detail-modal-div-7" className="flex-1 min-w-0">
              <div data-ui="addon-detail-modal-div-8" className="flex items-start justify-between gap-4">
                <div data-ui="addon-detail-modal-div-9">
                  <h2 data-ui="addon-detail-modal-h2-2" className="text-xl font-bold text-foreground">{title}</h2>
                  <p data-ui="addon-detail-modal-p-2" className="text-sm text-muted-foreground mt-1 line-clamp-2">{description}</p>
                  {selectedDetails.links && (
                    <div data-ui="addon-detail-modal-div-10" className="flex flex-wrap items-center gap-2 mt-2.5">
                      {selectedDetails.links.sourceUrl && (
                        <a data-ui="addon-detail-modal-a-2"
                          href={selectedDetails.links.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBrandGithub className="w-3.5 h-3.5" />
                          <span data-ui="addon-detail-modal-span-2">{t("addon.links.source")}</span>
                        </a>
                      )}
                      {selectedDetails.links.wikiUrl && (
                        <a data-ui="addon-detail-modal-a-3"
                          href={selectedDetails.links.wikiUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBook className="w-3.5 h-3.5" />
                          <span data-ui="addon-detail-modal-span-3">{t("addon.links.wiki")}</span>
                        </a>
                      )}
                      {selectedDetails.links.issuesUrl && (
                        <a data-ui="addon-detail-modal-a-4"
                          href={selectedDetails.links.issuesUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBug className="w-3.5 h-3.5" />
                          <span data-ui="addon-detail-modal-span-4">{t("addon.links.issues")}</span>
                        </a>
                      )}
                      {selectedDetails.links.discordUrl && (
                        <a data-ui="addon-detail-modal-a-5"
                          href={selectedDetails.links.discordUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconBrandDiscord className="w-3.5 h-3.5" />
                          <span data-ui="addon-detail-modal-span-5">{t("addon.links.discord")}</span>
                        </a>
                      )}
                      {selectedDetails.links.websiteUrl && (
                        <a data-ui="addon-detail-modal-a-6"
                          href={selectedDetails.links.websiteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconExternalLink className="w-3.5 h-3.5" />
                          <span data-ui="addon-detail-modal-span-6">{t("addon.links.website")}</span>
                        </a>
                      )}
                      {/* Страница проекта на площадке (Modrinth/CurseForge/FTB). */}
                      {siteUrl && (
                        <button data-ui="addon-detail-modal-button-1"
                          type="button"
                          onClick={() => openProjectPage(selectedDetails, projectKind)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border/60"
                        >
                          <IconExternalLink className="w-3.5 h-3.5" />
                          <span data-ui="addon-detail-modal-span-7">{t("common.openOnSite")}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div data-ui="addon-detail-modal-div-11" className="flex items-center gap-2">
                  {(selectedDetails.source === "modrinth" || selectedDetails.source === "curseforge") && <button type="button" title={t("agent.askAboutProject")} aria-label={t("agent.askAboutProject")} className="p-2 rounded-lg border border-primary/25 bg-primary/10 text-primary hover:bg-primary/20" onClick={() => {
                    const projectId = selectedDetails.source === "curseforge" ? String(selectedDetails.modId || selectedDetails.id) : selectedDetails.projectId || selectedDetails.id
                    void openAgent([{ id: `${selectedDetails.source}:${projectId}`, kind: "project", name: title, source: selectedDetails.source as "modrinth" | "curseforge", projectId, iconUrl, content: JSON.stringify({ source: selectedDetails.source, projectId, name: title, summary: description, description: selectedDetails.description?.slice(0, 18000) }) }])
                    onClose()
                  }}><IconRobot className="w-5 h-5" /></button>}
                  <button data-ui="addon-detail-modal-button-2" onClick={onClose} className="p-2 rounded-lg border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <IconX className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div data-ui="addon-detail-modal-div-12" className="flex border-b border-border px-2 flex-shrink-0">
          {([
            { id: "description" as ModalTab, icon: IconFileText },
            { id: "gallery" as ModalTab, icon: IconPhoto },
            { id: "changelog" as ModalTab, icon: IconHistory },
            { id: "versions" as ModalTab, icon: IconDownload },
          ]).map(({ id, icon: Icon }) => (
            <button data-ui="addon-detail-modal-button-3"
              key={id}
              onClick={() => setModalTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors relative capitalize rounded-t-lg",
                modalTab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {t(`addon.tab.${id}`)}
              {modalTab === id && <span data-ui="addon-detail-modal-span-8" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
            </button>
          ))}
        </div>

        <div data-ui="addon-detail-modal-div-13" className="flex-1 overflow-y-auto p-6">
          {loadError && <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{loadError}</p>}
          {loadingModal && <Spinner />}
          {!loadingModal && modalTab === "description" && (
            <div data-ui="addon-detail-modal-div-14">
              {body ? (
                <ChangelogContent content={body} components={mdComponents} />
              ) : description ? (
                <ChangelogContent content={description} components={mdComponents} />
              ) : (
                <p data-ui="addon-detail-modal-p-3" className="text-muted-foreground">{description}</p>
              )}
            </div>
          )}
          {!loadingModal && modalTab === "gallery" && (
            <div data-ui="addon-detail-modal-div-15">
              {gallery && gallery.length > 0 ? (
                <div data-ui="addon-detail-modal-div-16" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {gallery.map((img, i) => (
                    <div data-ui="addon-detail-modal-div-17" key={i} className="group relative overflow-hidden rounded-xl border border-border bg-muted/20">
                      <img data-ui="addon-detail-modal-img-3" src={img.url} alt={img.title || ""} className="w-full h-56 object-cover group-hover:scale-105 transition-transform duration-300" />
                      {img.title && (
                        <div data-ui="addon-detail-modal-div-18" className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
                          <span data-ui="addon-detail-modal-span-9" className="max-w-full truncate rounded-full bg-black/50 backdrop-blur-sm px-3 py-1 text-xs font-medium text-foreground shadow-sm">
                            {img.title}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p data-ui="addon-detail-modal-p-4" className="col-span-2 text-center text-muted-foreground py-12">{t("addon.noScreenshots")}</p>
              )}
            </div>
          )}
          {!loadingModal && modalTab === "changelog" && (
            <div data-ui="addon-detail-modal-div-19" className="space-y-4">
              {displayedModalVersions.length > 0 ? (
                displayedModalVersions.slice(0, 5).map((ver) => (
                  <div data-ui="addon-detail-modal-div-20" key={ver.id} className="p-4 rounded-xl bg-muted/20 border border-border">
                    <div data-ui="addon-detail-modal-div-21" className="flex items-center justify-between mb-2">
                      <h4 data-ui="addon-detail-modal-h4-1" className="font-semibold text-foreground">{ver.name}</h4>
                      <span data-ui="addon-detail-modal-span-10" className="text-xs text-muted-foreground">{ver.datePublished ? new Date(ver.datePublished).toLocaleDateString() : ""}</span>
                    </div>
                    {(() => {
                      const changelogText = ver.changelog || cfChangelogs[ver.id]
                      if (changelogText) {
                        return (
                          <div data-ui="addon-detail-modal-div-22" className="text-sm text-muted-foreground">
                            <ChangelogContent content={changelogText} components={mdComponents} />
                          </div>
                        )
                      }
                      if (loadingChangelog) {
                        return (
                          <div data-ui="addon-detail-modal-div-23" className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                            <IconLoader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            <span data-ui="addon-detail-modal-span-11">{t("addon.changelog.loading")}</span>
                          </div>
                        )
                      }
                      return <p data-ui="addon-detail-modal-p-5" className="text-sm text-muted-foreground">{t("addon.changelog.empty")}</p>
                    })()}
                  </div>
                ))
              ) : (
                <p data-ui="addon-detail-modal-p-6" className="text-center text-muted-foreground py-12">{t("addon.changelog.empty")}</p>
              )}
            </div>
          )}
          {!loadingModal && modalTab === "versions" && (
            <div data-ui="addon-detail-modal-div-24" className="space-y-2">
              {/* Предупреждение показывается только если пользователь сам нажал «Показать все версии» */}
              {showAllVersionsActive && activeBuild && (
                <div data-ui="addon-detail-modal-div-25" className="flex items-center gap-2 rounded-xl border border-warning/20 bg-warning/5 px-3.5 py-2.5 text-xs text-warning/90">
                  <IconAlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                  <span data-ui="addon-detail-modal-span-12">
                    {t("addon.versions.allNoteBefore")}{" "}
                    <span data-ui="addon-detail-modal-span-13" className="font-medium">{t("addon.versions.allNoteEmphasis")}</span>{" "}
                    {t("addon.versions.allNoteAfter")}
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
                  const isCurrent = isInstalledVersion(ver, installedVersion, activeBuild?.version)
                  return (
                  <div data-ui="addon-detail-modal-div-26"
                    key={ver.id}
                    className={cn(
                      "p-4 rounded-xl border transition-colors",
                      mismatch
                        ? "border-destructive/20 bg-destructive/5"
                        : installState?.phase === "error"
                          ? "border-destructive/25 bg-destructive/5"
                          : installState?.phase === "done"
                            ? "border-success/25 bg-success/5"
                            : installState
                              ? "border-primary/40 bg-primary/5"
                              : isCurrent
                                ? "border-primary/40 bg-primary/5"
                                : "bg-muted/20 border-border hover:bg-muted/30"
                    )}
                  >
                    <div data-ui="addon-detail-modal-div-27" className="flex items-center justify-between">
                      <div data-ui="addon-detail-modal-div-28" className="flex-1 min-w-0">
                        <div data-ui="addon-detail-modal-div-29" className="flex items-center gap-2">
                          <p data-ui="addon-detail-modal-p-7" className="font-medium text-foreground truncate">{ver.name}</p>
                          {isCurrent && (
                            <span data-ui="addon-detail-modal-span-14" className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              <IconCheck className="w-3 h-3" />
                              {t("addon.versions.current")}
                            </span>
                          )}
                        </div>
                        <div data-ui="addon-detail-modal-div-30" className="flex flex-wrap items-center gap-2 mt-1">
                          <GameVersionChips gameVersion={ver.gameVersion} />
                          <LoaderBadges loaders={ver.loaders} />
                          {mismatch && (
                            <span data-ui="addon-detail-modal-span-15" className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive font-medium">
                              {t("addon.otherLoader")}
                            </span>
                          )}
                          {ver.versionType && (
                            <span data-ui="addon-detail-modal-span-16" className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                              ver.versionType === "release" ? "bg-success/10 text-success"
                                : ver.versionType === "beta" ? "bg-warning/10 text-warning"
                                  : "bg-destructive/10 text-destructive",
                            )}>
                              {ver.versionType}
                            </span>
                          )}
                        </div>
                      </div>
                      {onInstallVersion && <button data-ui="addon-detail-modal-button-4"
                        onClick={() => void runVersionInstall(ver, () => onInstallVersion(ver))}
                        disabled={busy || isCurrent}
                        className={cn(
                          "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ml-3",
                          busy || isCurrent
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        )}
                      >
                        {installState?.phase === "running" ? (
                          <>
                            <IconLoader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                            {t("common.installing")}
                          </>
                        ) : isCurrent ? (
                          <>
                            <IconCheck className="w-4 h-4" strokeWidth={2} />
                            {t("addon.installed")}
                          </>
                        ) : (
                          <>
                            <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                            {t("addon.download")}
                          </>
                        )}
                      </button>}
                    </div>

                    {installState && <VersionInstallProgress state={installState} />}
                  </div>
                  )
                })
              ) : (
                <div data-ui="addon-detail-modal-div-31" className="flex flex-col items-center justify-center py-14 text-center">
                  <IconPackage className="h-8 w-8 text-muted-foreground/60 mb-3" strokeWidth={1.5} />
                  <p data-ui="addon-detail-modal-p-8" className="text-sm font-medium text-foreground">{t("addon.versions.noneFor", { target: resolvedTargetLabel })}</p>
                  <div data-ui="addon-detail-modal-div-32" className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                    {activeBuild ? (
                      <>
                        <span data-ui="addon-detail-modal-span-17">{t("addon.versions.notFoundFor")}</span>
                        <LoaderIcon loaderId={activeBuild.modLoader} className="w-3.5 h-3.5" />
                        <span data-ui="addon-detail-modal-span-18">{loaderLabel(activeBuild.modLoader)} {activeBuild.version}</span>
                      </>
                    ) : (
                      <span data-ui="addon-detail-modal-span-19">{t("addon.versions.noMatching")}</span>
                    )}
                  </div>
                  {onShowAllVersions && allVersionsCount > 0 && (
                    <button data-ui="addon-detail-modal-button-5"
                      onClick={onShowAllVersions}
                      className="mt-4 flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border bg-muted/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <IconAlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {t("addon.versions.showAll", { count: allVersionsCount })}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
