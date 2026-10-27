import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconChevronLeft, IconChevronRight, IconMaximize, IconX } from "@tabler/icons-react"
import { ModalLayer } from "@/components/ui/modal-layer"
import { ZoomableImage } from "./zoomable-image"

interface AddonGalleryProps {
  images: { url: string; title?: string }[]
  projectName: string
}

/** Сетка галереи проекта с полноэкранным просмотром и навигацией клавишами. */
export function AddonGallery({ images, projectName }: AddonGalleryProps) {
  const { t } = useTranslation()
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const current = viewIndex === null ? null : images[viewIndex]

  useEffect(() => { setViewIndex(null) }, [images])

  useEffect(() => {
    if (viewIndex === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && viewIndex > 0) setViewIndex(viewIndex - 1)
      else if (event.key === "ArrowRight" && viewIndex < images.length - 1) setViewIndex(viewIndex + 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [viewIndex, images.length])

  if (!images.length) return <p data-ui="addon-detail-modal-p-4" className="col-span-2 py-12 text-center text-muted-foreground">{t("addon.noScreenshots")}</p>

  return (
    <>
      <div data-ui="addon-detail-modal-div-16" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {images.map((image, index) => (
          <button data-ui="addon-detail-modal-div-17" key={`${image.url}-${index}`} type="button"
            onClick={() => setViewIndex(index)}
            aria-label={image.title || `${t("addon.tab.gallery")} ${index + 1}`}
            className="group relative overflow-hidden rounded-xl border border-border bg-muted/20 text-left outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
            <img data-ui="addon-detail-modal-img-3" src={image.url} alt={image.title || ""}
              className="h-56 w-full object-cover transition-transform duration-300 group-hover:scale-105" />
            <span className="pointer-events-none absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <IconMaximize className="h-4 w-4" strokeWidth={1.75} />
            </span>
            {image.title && (
              <div data-ui="addon-detail-modal-div-18" className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
                <span data-ui="addon-detail-modal-span-9" className="max-w-full truncate rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-sm">
                  {image.title}
                </span>
              </div>
            )}
          </button>
        ))}
      </div>

      {viewIndex !== null && current && (
        <ModalLayer windowId="addon-gallery-lightbox"
          onClose={() => setViewIndex(null)}
          className="z-[70] flex-col items-stretch justify-start bg-background/95 backdrop-blur-md animate-in fade-in-0">
          <div className="flex shrink-0 items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{current.title || projectName}</div>
              <div className="text-xs text-muted-foreground">{viewIndex + 1} / {images.length}</div>
            </div>
            <button type="button" onClick={() => setViewIndex(null)} title={t("screenshots.close")} aria-label={t("screenshots.close")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <IconX className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-4">
            {viewIndex > 0 && (
              <button type="button" onClick={() => setViewIndex(viewIndex - 1)} aria-label={t("addon.gallery.previous")}
                className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-muted/70 text-foreground shadow-lg transition-colors hover:bg-muted">
                <IconChevronLeft className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
            <ZoomableImage key={`${viewIndex}-${current.url}`} src={current.url} alt={current.title || projectName} />
            {viewIndex < images.length - 1 && (
              <button type="button" onClick={() => setViewIndex(viewIndex + 1)} aria-label={t("addon.gallery.next")}
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-muted/70 text-foreground shadow-lg transition-colors hover:bg-muted">
                <IconChevronRight className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </ModalLayer>
      )}
    </>
  )
}
