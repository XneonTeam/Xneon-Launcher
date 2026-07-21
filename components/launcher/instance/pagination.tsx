import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (p: number) => void
  className?: string
}

export function Pagination({ currentPage, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null
  const pages: (number | "...")[] = []
  const maxVisible = 5
  if (totalPages <= maxVisible + 2) {
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
    <div className={cn("flex items-center justify-center gap-1 py-4 flex-shrink-0", className)}>
      <button onClick={() => onPageChange(Math.max(0, currentPage - 1))} disabled={currentPage === 0} className={cn("w-8 h-8 rounded-lg text-sm font-medium transition-all", currentPage === 0 ? "text-muted-foreground cursor-not-allowed" : "hover:bg-muted")}>
        <IconChevronLeft className="w-4 h-4 mx-auto" />
      </button>
      {pages.map((p, i) => p === "..." ? (
        <span key={`e${i}`} className="text-muted-foreground px-1">…</span>
      ) : (
        <button key={p} onClick={() => onPageChange(p as number)} className={cn("w-8 h-8 rounded-lg text-xs font-medium transition-all hover:bg-muted text-muted-foreground", currentPage === p && "bg-primary text-primary-foreground hover:bg-primary/90")}>
          {(p as number) + 1}
        </button>
      ))}
      <button onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage === totalPages - 1} className={cn("w-8 h-8 rounded-lg text-sm font-medium transition-all", currentPage === totalPages - 1 ? "text-muted-foreground cursor-not-allowed" : "hover:bg-muted")}>
        <IconChevronRight className="w-4 h-4 mx-auto" />
      </button>
    </div>
  )
}
