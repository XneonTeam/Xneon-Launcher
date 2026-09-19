import type { ElementType, ReactNode } from "react"
import { IconInbox, IconSearchOff, IconTrashOff } from "@tabler/icons-react"
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
  search: IconSearchOff,
  empty: IconInbox,
  trash: IconTrashOff,
} as const

/** Пустое состояние: иконка Tabler в круге + текст. */
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
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-1" : "gap-1.5", className)}>
      <Icon
        aria-hidden="true"
        strokeWidth={1.5}
        className={cn("shrink-0 text-muted-foreground/60", compact ? "h-7 w-7" : "h-12 w-12")}
      />
      <p className={cn("font-medium text-muted-foreground", compact ? "text-xs" : "text-sm")}>{title}</p>
      {description ? (
        <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground/70">{description}</p>
      ) : null}
      {action}
    </div>
  )
}
