import { createPortal } from "react-dom"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { cn } from "@/lib/utils"
import { IconX, IconFileText, IconPhoto, IconHistory, IconDownload } from "@tabler/icons-react"
import { Spinner, VersionBadge } from "./mods-ui"
import { formatDownloads, formatFileSize } from "./utils"
import type { ModDetails, ModVersion, ModalTab } from "./types"

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

const TABS: { id: ModalTab; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: "description", icon: IconFileText },
  { id: "gallery", icon: IconPhoto },
  { id: "changelog", icon: IconHistory },
  { id: "versions", icon: IconDownload },
]

// ── Modrinth Modal ──────────────────────────────────────────

interface ModrinthModalProps {
  details: ModDetails
  versions: ModVersion[]
  loading: boolean
  modalTab: ModalTab
  setModalTab: (t: ModalTab) => void
  onClose: () => void
}

export function ModrinthModal({ details, versions, loading, modalTab, setModalTab, onClose }: ModrinthModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[85vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-4">
            {details.iconUrl ? <img src={details.iconUrl} alt="" className="w-16 h-16 rounded-xl flex-shrink-0" /> : <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center flex-shrink-0"><span className="text-2xl font-bold">{details.name[0]}</span></div>}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">{details.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{details.summary}</p>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors"><IconX className="w-5 h-5" /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex border-b border-border px-2 flex-shrink-0">
          {TABS.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setModalTab(id)} className={cn("flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors relative capitalize", modalTab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {id}
              {modalTab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <Spinner /> : (
            <>
              {modalTab === "description" && (details.body ? <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{details.body}</ReactMarkdown> : <p className="text-muted-foreground">{details.summary}</p>)}
              {modalTab === "gallery" && (
                <div className="grid grid-cols-2 gap-4">
                  {details.gallery?.length ? details.gallery.map((img, i) => <img key={i} src={img.url} alt={img.title || ""} className="rounded-xl w-full hover:scale-[1.02] transition-transform" />) : <p className="col-span-2 text-center text-muted-foreground py-12">No screenshots available</p>}
                </div>
              )}
              {modalTab === "changelog" && (
                <div className="space-y-4">
                  {versions.length > 0 ? versions.slice(0, 5).map(ver => (
                    <div key={ver.id} className="p-4 rounded-xl bg-muted/20 border border-border">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2"><h4 className="font-semibold text-foreground">{ver.name}</h4><VersionBadge type={ver.versionType} /></div>
                        <span className="text-xs text-muted-foreground">{ver.datePublished ? new Date(ver.datePublished).toLocaleDateString() : ""}</span>
                      </div>
                      {ver.changelog ? <div className="text-sm text-muted-foreground"><ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{ver.changelog}</ReactMarkdown></div> : <p className="text-sm text-muted-foreground">No changelog provided</p>}
                    </div>
                  )) : <p className="text-center text-muted-foreground py-12">No changelog available</p>}
                </div>
              )}
              {modalTab === "versions" && (
                <div className="space-y-2">
                  {versions.length > 0 ? versions.slice(0, 50).map(ver => (
                    <div key={ver.id} className="p-4 rounded-xl bg-muted/20 border border-border flex items-center justify-between hover:bg-muted/30 transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1"><p className="font-medium text-foreground">{ver.name}</p><VersionBadge type={ver.versionType} /></div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{ver.gameVersion}</span>
                          {ver.loaders && <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{ver.loaders.join(", ")}</span>}
                          <span className="text-xs text-muted-foreground">{formatFileSize(ver.files?.[0]?.size || ver.fileSize || 0)}</span>
                        </div>
                      </div>
                      <button onClick={() => { if (ver.files?.[0]?.url) window.open(ver.files[0].url, "_blank") }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"><IconDownload className="w-4 h-4" strokeWidth={1.75} />Download</button>
                    </div>
                  )) : <p className="text-center text-muted-foreground py-12">No versions available</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── CurseForge Modal ────────────────────────────────────────

interface CFModalProps {
  details: ModDetails
  loading: boolean
  modalTab: ModalTab
  setModalTab: (t: ModalTab) => void
  onClose: () => void
  onInstall: (fileId: number, modId: number) => void
}

export function CFModal({ details, loading, modalTab, setModalTab, onClose, onInstall }: CFModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[85vh] mx-4 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-4">
            {details.iconUrl ? <img src={details.iconUrl} alt="" className="w-16 h-16 rounded-xl flex-shrink-0" /> : <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center flex-shrink-0"><span className="text-2xl font-bold">{details.name[0]}</span></div>}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">{details.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{details.summary}</p>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors"><IconX className="w-5 h-5" /></button>
              </div>
              <div className="flex items-center gap-4 mt-3">
                <span className="text-sm text-muted-foreground">{formatDownloads(details.downloadCount)} downloads</span>
                {details.categories?.slice(0, 3).map(cat => <span key={cat} className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground capitalize">{cat.replace(/-/g, " ")}</span>)}
              </div>
            </div>
          </div>
        </div>
        <div className="flex border-b border-border px-2 flex-shrink-0">
          {TABS.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setModalTab(id)} className={cn("flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors relative capitalize", modalTab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {id}
              {modalTab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t-full" />}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <Spinner /> : (
            <>
              {modalTab === "description" && (details.description && details.description !== details.summary ? <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]} components={mdComponents}>{details.description}</ReactMarkdown> : <p className="text-muted-foreground leading-relaxed">{details.summary}</p>)}
              {modalTab === "gallery" && (
                <div className="grid grid-cols-2 gap-4">
                  {details.gallery?.length ? details.gallery.map((img, i) => <img key={i} src={img.url} alt={img.title || ""} className="rounded-xl w-full hover:scale-[1.02] transition-transform" />) : <p className="col-span-2 text-center text-muted-foreground py-12">No screenshots available</p>}
                </div>
              )}
              {modalTab === "changelog" && <p className="text-center text-muted-foreground py-12">No changelog available</p>}
              {modalTab === "versions" && (
                <div className="space-y-2">
                  {details.versions.length > 0 ? details.versions.map(ver => (
                    <div key={ver.id} className="p-4 rounded-xl bg-muted/20 border border-border flex items-center justify-between hover:bg-muted/30 transition-colors">
                      <div className="flex-1">
                        <p className="font-medium text-foreground mb-1">{ver.name}</p>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{ver.gameVersion}</span>
                          <span className="text-xs text-muted-foreground">{formatFileSize(ver.fileSize)}</span>
                        </div>
                      </div>
                      {details.modId && <button onClick={() => onInstall(Number(ver.id), details.modId!)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition-colors"><IconDownload className="w-4 h-4" strokeWidth={1.75} />Install</button>}
                    </div>
                  )) : <p className="text-center text-muted-foreground py-12">No versions available</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
