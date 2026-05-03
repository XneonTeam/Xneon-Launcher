import { IconChevronLeft, IconChevronRight, IconLoader2 } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

export function VersionBadge({ type }: { type: string | undefined }) {
  if (type === "alpha") return <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">Alpha</span>
  if (type === "beta") return <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">Beta</span>
  return <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Release</span>
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <IconLoader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  )
}

export function Pagination({ currentPage, totalPages, onPageChange, className }: { currentPage: number; totalPages: number; onPageChange: (p: number) => void; className?: string }) {
  if (totalPages <= 1) return null
  const pages: (number | "...")[] = []
  if (totalPages <= 7) {
    for (let i = 0; i < totalPages; i++) pages.push(i)
  } else {
    pages.push(0)
    if (currentPage > 2) pages.push("...")
    const start = Math.max(1, currentPage - 1)
    const end = Math.min(totalPages - 2, currentPage + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (currentPage < totalPages - 3) pages.push("...")
    pages.push(totalPages - 1)
  }
  return (
    <div className={cn("flex items-center justify-center gap-1 py-2 border-t border-border flex-shrink-0 w-full", className)}>
      <button onClick={() => onPageChange(Math.max(0, currentPage - 1))} disabled={currentPage === 0} className={cn("w-9 h-9 rounded-lg text-sm font-medium transition-all", currentPage === 0 ? "text-muted-foreground cursor-not-allowed" : "hover:bg-muted")}>
        <IconChevronLeft className="w-4 h-4 mx-auto" />
      </button>
      {pages.map((p, i) => p === "..." ? (
        <span key={`e${i}`} className="text-muted-foreground px-1">…</span>
      ) : (
        <button key={p} onClick={() => onPageChange(p as number)} className={cn("w-9 h-9 rounded-lg text-sm font-medium transition-all hover:bg-muted", currentPage === p ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
          {(p as number) + 1}
        </button>
      ))}
      <button onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage === totalPages - 1} className={cn("w-9 h-9 rounded-lg text-sm font-medium transition-all", currentPage === totalPages - 1 ? "text-muted-foreground cursor-not-allowed" : "hover:bg-muted")}>
        <IconChevronRight className="w-4 h-4 mx-auto" />
      </button>
    </div>
  )
}
