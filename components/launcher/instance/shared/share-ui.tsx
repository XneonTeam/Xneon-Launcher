import type { ButtonHTMLAttributes, ReactNode } from "react"
import { useLayoutEffect, useState } from "react"
import { IconLoader2, IconShare } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ModalTitleIcon } from "@/components/ui/modal-title-icon"
import { cn } from "@/lib/utils"

export const shareInput = "h-10 w-full rounded-xl border border-border bg-muted/40 px-3.5 text-sm text-foreground outline-none transition-colors focus:border-primary disabled:opacity-50"
export const shareTextarea = cn(shareInput, "h-auto py-3 leading-relaxed placeholder:text-muted-foreground")
export const bytesLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`

export function ShareButton({ secondary = false, busy = false, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        secondary
          ? "border border-border bg-muted/40 text-foreground hover:bg-muted"
          : "bg-primary text-primary-foreground hover:bg-primary/90",
        className,
      )}
      {...props}
    >
      {busy && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  )
}

export function ShareModal({ open, onClose, title, description, children, footer, titleIcon, wide = false, fixedHeight = false, expanded = false }: {
  open: boolean
  onClose(): void
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  titleIcon?: ReactNode
  wide?: boolean
  fixedHeight?: boolean
  expanded?: boolean
}) {
  const [area, setArea] = useState<{ x: number; y: number; width: number; height: number }>()
  useLayoutEffect(() => {
    if (!open) return
    const content = document.getElementById("launcher-content")
    const update = () => {
      const rect = content?.getBoundingClientRect()
      setArea(rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
    }
    update()
    const observer = new ResizeObserver(update)
    if (content) observer.observe(content)
    window.addEventListener("resize", update)
    return () => { observer.disconnect(); window.removeEventListener("resize", update) }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
      <DialogContent
        className={cn("flex max-w-lg flex-col gap-0 overflow-hidden rounded-3xl border-border bg-background p-0 shadow-2xl", wide && "max-w-4xl", expanded && "max-w-6xl", fixedHeight && "h-[min(660px,calc(100dvh-4rem))]")}
        style={area ? {
          left: area.x + area.width / 2,
          top: area.y + area.height / 2,
          width: Math.max(0, area.width - 32),
          maxHeight: Math.max(0, area.height - 32),
          ...(expanded ? { height: Math.max(0, area.height - 32) } : {}),
        } : undefined}
      >
        <DialogHeader className="shrink-0 gap-2 border-b border-border/50 px-6 py-5 text-left">
          <DialogTitle className="flex items-center gap-2.5 pr-5 text-base font-semibold">
            <ModalTitleIcon>{titleIcon ?? <IconShare className="h-4 w-4" strokeWidth={1.75} />}</ModalTitleIcon>
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{description}</DialogDescription>
        </DialogHeader>
        <div className={cn("min-h-0 overflow-y-auto p-6", expanded && "p-4", fixedHeight && "flex-1 overflow-hidden")}>{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-muted/20 px-6 py-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  )
}
