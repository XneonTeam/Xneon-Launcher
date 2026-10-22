import { useContentEnter } from "../content-motion"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { formatBytes, formatDateTime } from "@/lib/format"
import { IconCamera, IconChevronLeft, IconChevronRight, IconFolderOpen, IconLoader2, IconPhoto, IconRefresh, IconTrash, IconX, IconPencil } from "@tabler/icons-react"
import type { Build, ScreenshotInfo } from "./types"
import { useAlertDialog } from "@/lib/use-alert-dialog"
import { ModalLayer } from "@/components/ui/modal-layer"

interface InstanceScreenshotsTabProps {
  build: Build
}

export function InstanceScreenshotsTab({ build }: InstanceScreenshotsTabProps) {
  const { t } = useTranslation()
  const [shots, setShots] = useState<ScreenshotInfo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const contentEnter = useContentEnter(!loading)
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const [fullImage, setFullImage] = useState<string | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [renameFor, setRenameFor] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const { showAlert, alertDialog } = useAlertDialog()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI?.listScreenshots(build.name)
      setShots(list ?? [])
    } finally {
      setLoading(false)
    }
  }, [build.name])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (viewIndex === null || !shots) {
      setFullImage(null)
      return
    }
    let cancelled = false
    setLoadingFull(true)
    setFullImage(null)
    window.electronAPI?.getScreenshot(build.name, shots[viewIndex]?.name ?? "").then(dataUrl => {
      if (!cancelled) setFullImage(dataUrl)
    }).finally(() => {
      if (!cancelled) setLoadingFull(false)
    })
    return () => { cancelled = true }
  }, [viewIndex, shots, build.name])

  // Keyboard navigation in the lightbox: ← / →
  useEffect(() => {
    if (viewIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && viewIndex > 0) setViewIndex(viewIndex - 1)
      else if (e.key === "ArrowRight" && shots && viewIndex < shots.length - 1) setViewIndex(viewIndex + 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [viewIndex, shots])

  const handleDelete = async (index: number) => {
    const shot = shots?.[index]
    if (!shot) return
    const result = await window.electronAPI?.deleteScreenshot(build.name, shot.name)
    if (result?.success) {
      if (viewIndex === index) setViewIndex(null)
      await refresh()
    } else {
      showAlert(result?.error ?? t("screenshots.deleteError"))
    }
  }

  const handleRename = async (oldName: string) => {
    const newName = renameDraft.trim()
    if (!newName || newName === oldName) {
      setRenameFor(null)
      return
    }
    const result = await window.electronAPI?.renameScreenshot(build.name, oldName, newName)
    setRenameFor(null)
    if (result?.success) {
      await refresh()
    } else {
      showAlert(result?.error ?? t("screenshots.renameError"))
    }
  }

  return (
    <div data-ui="instance-instance-screenshots-tab-div-1" data-component="instance-screenshots-tab" className={`flex flex-1 flex-col overflow-hidden ${contentEnter ?? ""}`}>
      {shots === null ? (
        <div data-ui="instance-instance-screenshots-tab-div-2" className="flex h-full items-center justify-center text-muted-foreground">
          <IconLoader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : shots.length === 0 ? (
        // Пустое состояние в том же оформлении, что вкладки «Миры» и «Серверы»:
        // крупная иконка в цветной плашке, жирный заголовок и действие.
        <div data-ui="instance-instance-screenshots-tab-div-3" className="flex h-full flex-col items-center justify-center gap-4 text-center max-w-md mx-auto py-12">
          <div data-ui="instance-instance-screenshots-tab-div-4" className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary border border-primary/20">
            <IconCamera className="h-10 w-10" strokeWidth={1.75} />
          </div>
          <div data-ui="instance-instance-screenshots-tab-div-5">
            <div data-ui="instance-instance-screenshots-tab-div-6" className="text-xl font-bold text-foreground">{t("screenshots.emptyTitle")}</div>
            <p data-ui="instance-instance-screenshots-tab-p-1" className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              {t("screenshots.emptyHint")}
            </p>
          </div>
          <div data-ui="instance-instance-screenshots-tab-div-7" className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
            <button data-ui="instance-instance-screenshots-tab-button-1"
              type="button"
              onClick={() => void refresh()}
              className="flex items-center gap-2 rounded-xl border border-border bg-muted/60 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {loading ? <IconLoader2 className="h-4 w-4 text-primary animate-spin" strokeWidth={1.75} /> : <IconRefresh className="h-4 w-4" strokeWidth={1.75} />}
              {t("common.refresh")}
            </button>
          </div>
        </div>
      ) : (
        <div data-ui="instance-instance-screenshots-tab-div-8" className="flex flex-1 flex-col overflow-hidden">
          <div data-ui="instance-instance-screenshots-tab-div-9" className="mb-3 flex items-center justify-between">
            <div data-ui="instance-instance-screenshots-tab-div-10" className="text-sm font-semibold text-foreground">{t("screenshots.title", { count: shots.length })}</div>
            <button data-ui="instance-instance-screenshots-tab-button-2"
              type="button"
              onClick={() => void refresh()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {loading ? <IconLoader2 className="h-3.5 w-3.5 text-primary animate-spin" strokeWidth={1.75} /> : <IconRefresh className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {t("common.refresh")}
            </button>
          </div>

          <div data-ui="instance-instance-screenshots-tab-div-11" className="flex-1 overflow-y-auto pr-1">
            <div data-ui="instance-instance-screenshots-tab-div-12" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shots.map((shot, index) => (
              <div data-ui="instance-instance-screenshots-tab-div-13"
                key={shot.name}
                className="group overflow-hidden rounded-2xl border border-border bg-card/60 transition-colors hover:border-primary/40"
              >
                <button data-ui="instance-instance-screenshots-tab-button-3"
                  type="button"
                  onClick={() => setViewIndex(index)}
                  className="relative block w-full overflow-hidden"
                >
                  <img data-ui="instance-instance-screenshots-tab-img-1"
                    src={shot.thumbDataUrl}
                    alt={shot.name}
                    loading="lazy"
                    className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div data-ui="instance-instance-screenshots-tab-div-14" className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                    <IconPhoto className="h-7 w-7 text-white/90" strokeWidth={1.5} />
                  </div>
                </button>
                <div data-ui="instance-instance-screenshots-tab-div-15" className="flex items-center gap-2 px-3 py-2">
                  <div data-ui="instance-instance-screenshots-tab-div-16" className="min-w-0 flex-1">
                    <div data-ui="instance-instance-screenshots-tab-div-17" className="truncate text-xs font-medium text-foreground" title={shot.name}>{shot.name}</div>
                    <div data-ui="instance-instance-screenshots-tab-div-18" className="text-[11px] text-muted-foreground">{formatDateTime(shot.lastModified)} · {formatBytes(shot.sizeBytes)}</div>
                  </div>
                  <button data-ui="instance-instance-screenshots-tab-button-4"
                    type="button"
                    onClick={() => { setRenameDraft(shot.name.replace(/\.[a-zA-Z0-9]+$/, "")); setRenameFor(shot.name) }}
                    title={t("screenshots.rename.tooltip")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <IconPencil className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button data-ui="instance-instance-screenshots-tab-button-5"
                    type="button"
                    onClick={() => void handleDelete(index)}
                    title={t("screenshots.delete.tooltip")}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <IconTrash className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            ))}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {viewIndex !== null && shots && (
        <ModalLayer windowId="instance-instance-screenshots-tab-window-1"
          onClose={() => { if (!renameFor) setViewIndex(null) }}
          className="flex-col items-stretch justify-start bg-background/95 backdrop-blur-sm animate-in fade-in-0"
        >
          <div data-ui="instance-instance-screenshots-tab-div-19" className="flex items-center justify-between px-5 py-3">
            <div data-ui="instance-instance-screenshots-tab-div-20" className="min-w-0">
              <div data-ui="instance-instance-screenshots-tab-div-21" className="truncate text-sm font-medium text-foreground">{shots[viewIndex]?.name}</div>
              <div data-ui="instance-instance-screenshots-tab-div-22" className="text-xs text-muted-foreground">
                {viewIndex + 1} / {shots.length} · {formatDateTime(shots[viewIndex]?.lastModified ?? 0)}
              </div>
            </div>
            <div data-ui="instance-instance-screenshots-tab-div-23" className="flex items-center gap-2">
              <button data-ui="instance-instance-screenshots-tab-button-6"
                type="button"
                onClick={() => void handleDelete(viewIndex)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
                title={t("screenshots.delete.tooltip")}
              >
                <IconTrash className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button data-ui="instance-instance-screenshots-tab-button-7"
                type="button"
                onClick={() => window.electronAPI?.openPath(shots[viewIndex]?.path ?? "")}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("screenshots.openFolder")}
              >
                <IconFolderOpen className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button data-ui="instance-instance-screenshots-tab-button-8"
                type="button"
                onClick={() => setViewIndex(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("screenshots.close")}
              >
                <IconX className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div data-ui="instance-instance-screenshots-tab-div-24" className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-4">
            {shots[viewIndex - 1] && (
              <button data-ui="instance-instance-screenshots-tab-button-9"
                type="button"
                onClick={() => setViewIndex(viewIndex - 1)}
                className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-muted/70 text-foreground shadow-lg transition-colors hover:bg-muted"
              >
                <IconChevronLeft className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
            <div data-ui="instance-instance-screenshots-tab-div-25" className="flex h-full max-w-full items-center justify-center">
              {loadingFull || !fullImage ? (
                <IconLoader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <img data-ui="instance-instance-screenshots-tab-img-2"
                  src={fullImage}
                  alt={shots[viewIndex]?.name ?? ""}
                  className="max-h-full max-w-full rounded-xl object-contain shadow-2xl animate-in zoom-in-95"
                />
              )}
            </div>
            {shots[viewIndex + 1] && (
              <button data-ui="instance-instance-screenshots-tab-button-10"
                type="button"
                onClick={() => setViewIndex(viewIndex + 1)}
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-muted/70 text-foreground shadow-lg transition-colors hover:bg-muted"
              >
                <IconChevronRight className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </ModalLayer>
      )}

      {/* Rename dialog */}
      {renameFor && (
        <ModalLayer windowId="instance-instance-screenshots-tab-window-2"
          onClose={() => setRenameFor(null)}
          className="z-[60] animate-in fade-in-0"
        >
          <div data-ui="instance-instance-screenshots-tab-div-26" className="w-80 rounded-2xl border border-border bg-card p-4 shadow-2xl animate-in zoom-in-95">
            <p data-ui="instance-instance-screenshots-tab-p-2" className="text-sm font-semibold text-foreground mb-3">{t("screenshots.rename.title")}</p>
            <input data-ui="instance-instance-screenshots-tab-input-1"
              autoFocus
              value={renameDraft}
              onChange={e => setRenameDraft(e.target.value)}
              placeholder={t("screenshots.rename.placeholder")}
              onKeyDown={e => {
                if (e.key === "Enter") void handleRename(renameFor)
                if (e.key === "Escape") setRenameFor(null)
              }}
              className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary mb-3"
            />
            <div data-ui="instance-instance-screenshots-tab-div-27" className="flex justify-end gap-2">
              <button data-ui="instance-instance-screenshots-tab-button-11" type="button" onClick={() => setRenameFor(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-muted text-muted-foreground">{t("common.cancel")}</button>
              <button data-ui="instance-instance-screenshots-tab-button-12"
                type="button"
                onClick={() => void handleRename(renameFor)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground"
              >
                {t("screenshots.rename.action")}
              </button>
            </div>
          </div>
        </ModalLayer>
      )}

      {alertDialog}
    </div>
  )
}
