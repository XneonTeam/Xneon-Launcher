import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCheck, IconFolder, IconX } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

export interface CategoryAssignMenuProps {
  /** Точка открытия меню в координатах окна. */
  position: { x: number; y: number }
  /** Существующие категории. */
  groups: string[]
  /** Текущая категория элемента — подсвечивается галочкой. */
  current?: string
  /** Выбор категории; пустая строка — убрать из категории. */
  onAssign: (group: string) => void
  onClose: () => void
}

/**
 * Всплывающее меню «Переместить в категорию»: список существующих категорий,
 * снятие категории и инлайн-создание новой. Общее для серверов и сборок,
 * чтобы оба раздела выглядели и работали одинаково.
 */
export function CategoryAssignMenu({ position, groups, current = "", onAssign, onClose }: CategoryAssignMenuProps) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState("")
  const [anchor, setAnchor] = useState(position)

  // Держим меню внутри окна: у края экрана оно иначе обрезается.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))
    const y = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))
    setAnchor(prev => (prev.x === x && prev.y === y ? prev : { x, y }))
  }, [position.x, position.y, groups.length])

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    const onScroll = () => onClose()
    document.addEventListener("mousedown", outside)
    document.addEventListener("contextmenu", outside)
    document.addEventListener("keydown", onKey)
    // Позиция меню привязана к окну, поэтому при скролле его нужно закрыть.
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mousedown", outside)
      document.removeEventListener("contextmenu", outside)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [onClose])

  const submitDraft = () => {
    const trimmed = draft.trim()
    if (trimmed) onAssign(trimmed)
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] max-w-[260px] rounded-xl border border-border bg-popover p-1 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150"
      style={{ left: anchor.x, top: anchor.y }}
      // Внешние контейнеры закрывают меню по клику — не даём событию всплыть.
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("categoryMenu.title")}
      </div>

      {groups.length > 0 ? (
        <div className="max-h-[240px] overflow-y-auto">
          {groups.map(group => (
            <button key={group} type="button"
              onClick={() => onAssign(group)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                group === current ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted",
              )}>
              <IconFolder className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{group}</span>
              {group === current && <IconCheck className="ml-auto w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-2.5 pb-1.5 text-xs text-muted-foreground">{t("categoryMenu.empty")}</div>
      )}

      <button type="button"
        onClick={() => onAssign("")}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted">
        <IconX className="w-4 h-4" />
        {t("categoryMenu.remove")}
      </button>

      <div className="mt-1 flex items-center gap-1 border-t border-border px-1.5 pt-1.5">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); submitDraft() }
            // Гасим всплытие, иначе внешние обработчики закроют меню при вводе.
            e.stopPropagation()
          }}
          placeholder={t("categoryMenu.placeholder")}
          className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <button type="button"
          disabled={!draft.trim()}
          onClick={submitDraft}
          className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
          {t("categoryMenu.create")}
        </button>
      </div>
    </div>
  )
}