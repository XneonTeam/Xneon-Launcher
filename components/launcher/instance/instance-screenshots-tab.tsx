import { useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  IconCamera,
  IconChevronLeft,
  IconChevronRight,
  IconFolderOpen,
  IconLoader2,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconX,
  IconPencil,
} from "@tabler/icons-react"
import type { Build, ScreenshotInfo } from "./types"

interface InstanceScreenshotsTabProps {
  build: Build
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function InstanceScreenshotsTab({ build }: InstanceScreenshotsTabProps) {
  const [shots, setShots] = useState<ScreenshotInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const [fullImage, setFullImage] = useState<string | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [renameFor, setRenameFor] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")

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

  // Keyboard navigation in the lightbox: Esc / ← / →
  useEffect(() => {
    if (viewIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewIndex(null)
      else if (e.key === "ArrowLeft" && viewIndex > 0) setViewIndex(viewIndex - 1)
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
      alert(result?.error ?? "Не удалось удалить скриншот")
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
      alert(result?.error ?? "Не удалось переименовать скриншот")
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {shots === null ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <IconLoader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : shots.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/50">
            <IconCamera className="h-9 w-9 text-muted-foreground/50" strokeWidth={1.5} />
          </div>
          <div className="text-lg font-semibold text-foreground">Скриншотов пока нет</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Нажми F2 в игре, чтобы сделать скриншот. Все снимки экрана Minecraft из этой сборки будут появляться здесь.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">Скриншоты · {shots.length}</div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconRefresh className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={1.75} />
              Обновить
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shots.map((shot, index) => (
              <div
                key={shot.name}
                className="group overflow-hidden rounded-2xl border border-border bg-card/60 transition-colors hover:border-primary/40"
              >
                <button
                  type="button"
                  onClick={() => setViewIndex(index)}
                  className="relative block w-full overflow-hidden"
                >
                  <img
                    src={shot.thumbDataUrl}
                    alt={shot.name}
                    loading="lazy"
                    className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                    <IconPhoto className="h-7 w-7 text-white/90" strokeWidth={1.5} />
                  </div>
                </button>
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground" title={shot.name}>{shot.name}</div>
                    <div className="text-[11px] text-muted-foreground">{formatDate(shot.lastModified)} · {formatBytes(shot.sizeBytes)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setRenameDraft(shot.name.replace(/\.[a-zA-Z0-9]+$/, "")); setRenameFor(shot.name) }}
                    title="Переименовать скриншот"
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <IconPencil className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(index)}
                    title="Удалить скриншот"
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
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm animate-in fade-in-0">
          <div className="flex items-center justify-between px-5 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{shots[viewIndex]?.name}</div>
              <div className="text-xs text-muted-foreground">
                {viewIndex + 1} / {shots.length} · {formatDate(shots[viewIndex]?.lastModified ?? 0)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDelete(viewIndex)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
                title="Удалить скриншот"
              >
                <IconTrash className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => window.electronAPI?.openPath(shots[viewIndex]?.path ?? "")}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Открыть папку со скриншотами"
              >
                <IconFolderOpen className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setViewIndex(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Закрыть (Esc)"
              >
                <IconX className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-4">
            {shots[viewIndex - 1] && (
              <button
                type="button"
                onClick={() => setViewIndex(viewIndex - 1)}
                className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-muted/70 text-foreground shadow-lg transition-colors hover:bg-muted"
              >
                <IconChevronLeft className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
            <div className="flex h-full max-w-full items-center justify-center">
              {loadingFull || !fullImage ? (
                <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : (
                <img
                  src={fullImage}
                  alt={shots[viewIndex]?.name ?? ""}
                  className="max-h-full max-w-full rounded-xl object-contain shadow-2xl animate-in zoom-in-95"
                />
              )}
            </div>
            {shots[viewIndex + 1] && (
              <button
                type="button"
                onClick={() => setViewIndex(viewIndex + 1)}
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-muted/70 text-foreground shadow-lg transition-colors hover:bg-muted"
              >
                <IconChevronRight className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {renameFor && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm animate-in fade-in-0"
          onClick={() => setRenameFor(null)}
        >
          <div className="w-80 rounded-2xl border border-border bg-card p-4 shadow-2xl animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-foreground mb-3">Переименовать скриншот</p>
            <input
              autoFocus
              value={renameDraft}
              onChange={e => setRenameDraft(e.target.value)}
              placeholder="Новое имя"
              onKeyDown={e => {
                if (e.key === "Enter") void handleRename(renameFor)
                if (e.key === "Escape") setRenameFor(null)
              }}
              className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary mb-3"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenameFor(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-muted text-muted-foreground">Отмена</button>
              <button
                type="button"
                onClick={() => void handleRename(renameFor)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground"
              >
                Переименовать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
