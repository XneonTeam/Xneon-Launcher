import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { IconX, IconFileText, IconPhoto, IconHistory, IconDownload, IconRefresh, IconCheck, IconArrowRight } from "@tabler/icons-react"
import { Spinner } from "./spinner"
import type { Build, ModDetails, ModalTab, ModVersion } from "./types"

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
  onInstallVersion: (version: ModVersion) => void
  onClose: () => void
  activeBuild?: Build
  onUpdateModpack?: (version: ModVersion) => void
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
}: InstanceModalProps) {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [selectedUpdateVersion, setSelectedUpdateVersion] = useState<ModVersion | null>(null)

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
            <div className="grid grid-cols-2 gap-4">
              {gallery && gallery.length > 0 ? (
                gallery.map((img, i) => (
                  <img key={i} src={img.url} alt={img.title || ""} className="rounded-xl w-full hover:scale-[1.02] transition-transform" />
                ))
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
                    {ver.changelog ? (
                      <div className="text-sm text-muted-foreground">
                        <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{ver.changelog}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Нет changelog</p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-12">Нет changelog</p>
              )}
            </div>
          )}
          {!loadingModal && modalTab === "versions" && (
            <div className="space-y-2">
              {displayedModalVersions.length > 0 ? (
                displayedModalVersions.slice(0, 50).map((ver) => (
                  <div key={ver.id} className="p-4 rounded-xl bg-muted/20 border border-border flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{ver.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {ver.gameVersion ?? ""}
                        </span>
                        {ver.loaders && (
                          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                            {Array.isArray(ver.loaders) ? ver.loaders.join(", ") : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => onInstallVersion(ver)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                      Скачать
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-12">Нет версий</p>
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

                  return (
                    <button
                      key={ver.id}
                      type="button"
                      onClick={() => setSelectedUpdateVersion(isSelected ? null : ver)}
                      className={cn(
                        "w-full text-left p-4 rounded-xl border transition-colors",
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
                              onClick={(e) => {
                                e.stopPropagation()
                                onUpdateModpack?.(ver)
                                setShowUpdateDialog(false)
                                setSelectedUpdateVersion(null)
                              }}
                              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                            >
                              <IconDownload className="w-4 h-4" strokeWidth={1.75} />
                              Обновить до этой версии
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
