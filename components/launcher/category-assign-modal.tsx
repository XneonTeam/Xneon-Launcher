import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  IconCategory, IconCategoryPlus, IconCheck, IconLayoutGrid, IconLayoutList,
  IconPackage, IconPencil, IconPhoto, IconServer, IconTrash, IconX,
} from "@tabler/icons-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { IconPickerModal } from "./instance/icon-picker-modal"
import { EntityIcon } from "./instance/entity-icon"
import type { CategoryIconMap } from "@/src/hooks/use-category-icons"

/** Выбор вида списка категорий запоминаем между запусками. */
const VIEW_SETTING_KEY = "category_assign_view"

type CategoryView = "cards" | "list"

export interface CategoryAssignModalProps {
  open: boolean
  /** Имя вещи, которую перемещаем — попадает в описание модала. */
  itemName: string
  /** Раздел: от него зависит только иконка счётчика (сервер или сборка). */
  scope: "servers" | "builds"
  /** Существующие категории раздела. */
  groups: string[]
  /** Текущая категория вещи — подсвечивается галочкой. */
  current?: string
  /** Иконки категорий: имя → src. Без своей иконки показывается общая. */
  icons?: CategoryIconMap
  /** Сколько вещей лежит в каждой категории. */
  counts?: Record<string, number>
  /** Перемещение вещи в категорию (пустая строка — убрать из категории). */
  onAssign: (group: string) => void
  /** Создание категории. Вещь при этом не перемещается — выбор остаётся за пользователем. */
  onCreate: (group: string) => void
  onSetIcon: (group: string, icon: string) => void
  onRename: (oldName: string, newName: string) => void
  onDelete: (group: string) => void
  onClose: () => void
}

/**
 * Модальное окно категорий: вместо всплывающего меню — список категорий, где
 * категорию можно выбрать, а тут же задать ей иконку, переименовать или удалить.
 * Собран по стилю остальных модалов лаунчера: шапка с иконкой и описанием,
 * панель вида, прокручиваемое тело с плитками и футер с созданием категории.
 * Общее для серверов и сборок, чтобы разделы не расходились.
 */
export function CategoryAssignModal({
  open, itemName, scope, groups, current = "", icons, counts, onAssign, onCreate, onSetIcon, onRename, onDelete, onClose,
}: CategoryAssignModalProps) {
  const { t } = useTranslation()
  // Карточки — вид по умолчанию: в узкой колонке категории выглядели сжато.
  const [view, setView] = useState<CategoryView>("cards")
  // Имя новой категории в поле снизу.
  const [draft, setDraft] = useState("")
  // Категория, которую сейчас переименовываем прямо в списке.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  // Категория, для которой выбираем иконку (пикер открывается поверх этого модала).
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.electronAPI?.getSetting(VIEW_SETTING_KEY).then((stored) => {
      if (alive && (stored === "cards" || stored === "list")) setView(stored)
    })
    return () => { alive = false }
  }, [])

  const changeView = (mode: CategoryView) => {
    setView(mode)
    void window.electronAPI?.setSetting(VIEW_SETTING_KEY, mode)
  }

  const commitRename = () => {
    const name = renameDraft.trim()
    if (renaming && name && name !== renaming) onRename(renaming, name)
    setRenaming(null)
  }

  /** «Создать» делает ровно одно действие — создаёт категорию. Окно остаётся
   *  открытым, вещь никуда не переносится: категорию пользователь выберет сам. */
  const createCategory = () => {
    const name = draft.trim()
    if (!name) return
    onCreate(name)
    setDraft("")
  }

  const assign = (group: string) => { onAssign(group); onClose() }

  const scopeIcon = (size: string) => scope === "servers"
    ? <IconServer className={size} strokeWidth={2} />
    : <IconPackage className={size} strokeWidth={2} />
  const count = (group: string) => counts?.[group] ?? 0

  const actionClass = "shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
  const chipClass = "inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"

  /** Иконка категории: своя картинка или пресет-логотип, иначе общая иконка категории. */
  const renderIcon = (group: string, box: string, image: string, fallback: string) => (
    <div className={cn("flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/60", box)}>
      {icons?.[group]
        ? <EntityIcon src={icons[group]} className={cn("p-1 text-primary", image)} imgClassName={cn("object-contain", image)} />
        : <IconCategory className={cn("text-muted-foreground/50", fallback)} strokeWidth={1.75} />}
    </div>
  )

  /** Кружок выбора — как у версий модпака в остальных модалах лаунчера. */
  const selectionDot = (group: string) => (
    <div className={cn(
      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
      group === current ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
    )}>
      {group === current && <IconCheck className="h-3 w-3" strokeWidth={3} />}
    </div>
  )

  const actions = (group: string, className: string, iconClass = "w-4 h-4") => (
    <>
      <button type="button" title={t("categoryMenu.icon")}
        onClick={() => setIconPickerFor(group)} className={className}>
        <IconPhoto className={iconClass} />
      </button>
      <button type="button" title={t("categoryMenu.rename")}
        onClick={() => { setRenaming(group); setRenameDraft(group) }} className={className}>
        <IconPencil className={iconClass} />
      </button>
      <button type="button" title={t("categoryMenu.delete")}
        onClick={() => onDelete(group)}
        className={cn(className, "hover:bg-destructive/15 hover:text-destructive")}>
        <IconTrash className={iconClass} />
      </button>
    </>
  )

  /** Переименование идёт прямо в списке: без второго диалога поверх модала. */
  const renameRow = (group: string) => (
    <div key={group}
      className="col-span-full flex items-center gap-2 rounded-xl border border-primary/40 bg-muted/40 p-3">
      <input
        autoFocus
        value={renameDraft}
        onChange={e => setRenameDraft(e.target.value)}
        onKeyDown={e => {
          // Гасим всплытие: Escape отменяет переименование, а не закрывает модал.
          e.stopPropagation()
          if (e.key === "Enter") commitRename()
          if (e.key === "Escape") setRenaming(null)
        }}
        className="min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
      />
      <button type="button" onClick={commitRename}
        className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90">
        {t("common.save")}
      </button>
      <button type="button" onClick={() => setRenaming(null)} title={t("common.cancel")}
        className={actionClass}>
        <IconX className="w-4 h-4" />
      </button>
    </div>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
        <DialogContent
          className={cn(
            "flex max-h-[85vh] flex-col gap-0 overflow-hidden border-border bg-card p-0 shadow-2xl",
            view === "cards" ? "max-w-2xl" : "max-w-xl",
          )}>

          {/* Шапка: иконка, заголовок, для какой вещи выбираем категорию */}
          <DialogHeader className="flex-shrink-0 border-b border-border p-5">
            {/* pr-8 — чтобы текст не заезжал под встроенную кнопку закрытия */}
            <div className="flex items-center gap-2.5 pr-8">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <IconCategoryPlus className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold text-foreground">
                  {t("categoryMenu.title")}
                </DialogTitle>
                <DialogDescription className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t("categoryMenu.pickFor", { name: itemName })}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Панель вида: карточками/списком и снятие категории */}
          <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-muted/20 p-3.5">
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
              <button type="button" onClick={() => changeView("cards")} title={t("categoryMenu.viewCards")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  view === "cards" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                )}>
                <IconLayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
              <button type="button" onClick={() => changeView("list")} title={t("categoryMenu.viewList")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  view === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                )}>
                <IconLayoutList className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>

            {current && (
              <button type="button" onClick={() => assign("")}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive">
                <IconX className="h-3.5 w-3.5" />
                {t("categoryMenu.remove")}
              </button>
            )}
          </div>

          {/* Тело: плитки категорий или компактный список */}
          <div className="min-h-[240px] flex-1 overflow-y-auto p-4">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                <div className="rounded-2xl bg-muted/40 p-3">
                  <IconCategory className="h-7 w-7 text-muted-foreground/40" strokeWidth={1.5} />
                </div>
                <p className="text-sm text-muted-foreground">{t("categoryMenu.empty")}</p>
              </div>
            ) : view === "cards" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] items-start gap-2.5">
                {groups.map(group => renaming === group ? renameRow(group) : (
                  /* Плитка категории — та же карточка, что у сервера, только мельче:
                     категории не нужен размер превью игры. */
                  <div key={group}
                    onClick={() => assign(group)}
                    className={cn(
                      "group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-colors",
                      group === current
                        ? "border-primary shadow-[0_0_14px_var(--glow-primary)]"
                        : "border-border hover:border-primary/50 hover:shadow-[0_0_14px_var(--glow-primary)]",
                    )}>
                    <div className="relative w-full" style={{ paddingBottom: "100%" }}>
                      <div className="absolute inset-0">
                        {icons?.[group] ? (
                          /* Пресет-логотип рисуем инлайн (окрашивается темой), свою картинку — как у сервера. */
                          <EntityIcon
                            src={icons[group]}
                            className="h-full w-full p-2.5 text-primary"
                            imgClassName={cn(
                              "h-full w-full",
                              icons[group].startsWith("./launcher-icons/") ? "object-contain p-2.5" : "object-cover",
                            )}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10">
                            <IconCategory className="h-7 w-7 text-primary/40" strokeWidth={1.5} />
                          </div>
                        )}
                      </div>

                      {/* Выбранная категория — вместо бейджа источника у сервера */}
                      {group === current && (
                        <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                          <IconCheck className="h-3 w-3" strokeWidth={3} />
                        </div>
                      )}

                      {/* Действия — там же, где у плитки сервера кнопка запуска */}
                      <div
                        className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}>
                        {actions(
                          group,
                          "rounded-md border border-border bg-card/90 p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-card hover:text-foreground",
                          "w-3.5 h-3.5",
                        )}
                      </div>
                    </div>

                    <div className="border-t border-border/50 bg-card px-2.5 py-2">
                      <p className="truncate text-xs font-semibold leading-tight text-foreground">{group}</p>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="shrink-0 text-muted-foreground">{scopeIcon("w-3.5 h-3.5")}</span>
                        <span className="truncate text-[10px] text-muted-foreground">{count(group)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {groups.map(group => renaming === group ? renameRow(group) : (
                  <div key={group}
                    className={cn(
                      "group/row flex items-center gap-3 rounded-xl border p-3 transition-all",
                      group === current
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border/60 bg-muted/30 hover:border-border hover:bg-muted/60",
                    )}>
                    <button type="button" onClick={() => assign(group)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      {selectionDot(group)}
                      {renderIcon(group, "h-9 w-9", "h-6 w-6", "h-4 w-4")}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{group}</span>
                        <span className={cn(chipClass, "mt-1")}>{scopeIcon("w-3 h-3")}{count(group)}</span>
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
                      {actions(group, actionClass)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Футер: только создание категории, без перемещения вещи */}
          <div className="flex flex-shrink-0 items-center gap-2 border-t border-border p-4">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") createCategory() }}
              placeholder={t("categoryMenu.placeholder")}
              className="min-w-0 flex-1 rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button type="button"
              disabled={!draft.trim()}
              onClick={createCategory}
              className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-[0_0_15px_var(--glow-primary)] transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none">
              {t("categoryMenu.create")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Пикер иконки открывается поверх списка: контекст категории не теряется. */}
      <IconPickerModal
        open={iconPickerFor !== null}
        onOpenChange={(value) => { if (!value) setIconPickerFor(null) }}
        value={iconPickerFor ? (icons?.[iconPickerFor] ?? "") : ""}
        onChange={(icon) => { if (iconPickerFor) onSetIcon(iconPickerFor, icon) }}
        title={t("categoryMenu.icon")}
        description={t("categoryMenu.iconDesc")}
        removeLabel={t("categoryMenu.iconRemove")}
      />
    </>
  )
}
