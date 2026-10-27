import type { ElementType, ReactNode } from "react"
import { IconInbox, IconSearch, IconTrash } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

type EmptyStateProps = {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  /** search — ничего не нашлось по запросу; empty — раздел пуст; trash — корзина пуста. */
  variant?: "search" | "empty" | "trash"
  /** Компактный вариант: для узких блоков вроде колонки внутри вкладки. */
  compact?: boolean
  /** Своя иконка вместо иконки варианта (например, иконка типа контента). */
  icon?: ElementType
}

const EMPTY_STATE_ICONS = {
  search: IconSearch,
  empty: IconInbox,
  trash: IconTrash,
} as const

/** Пустое состояние: акцентная иконка на подложке и текст. */
export function EmptyState({
  title,
  description,
  action,
  className,
  variant = "search",
  compact = false,
  icon,
}: EmptyStateProps) {
  const Icon = icon ?? EMPTY_STATE_ICONS[variant]

  return (
    <div data-ui="ui-empty-state-div-1" className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-1" : "gap-1.5", className)}>
      <div className={cn("flex shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary", compact ? "mb-2 h-12 w-12 rounded-2xl" : "mb-2.5 h-20 w-20 rounded-3xl")}>
        <Icon aria-hidden="true" strokeWidth={1.75} className={compact ? "h-6 w-6" : "h-10 w-10"} />
      </div>
      <p data-ui="ui-empty-state-p-1" className={cn("font-medium text-muted-foreground", compact ? "text-xs" : "text-sm")}>{title}</p>
      {description ? (
        <p data-ui="ui-empty-state-p-2" className="max-w-[280px] text-xs leading-relaxed text-muted-foreground/70">{description}</p>
      ) : null}
      {action}
    </div>
  )
}
