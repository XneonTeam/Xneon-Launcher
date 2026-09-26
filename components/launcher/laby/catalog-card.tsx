import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { SkinRender } from "./skin-render"
import type { LabySkin } from "@xnlc/types"
import { IconBookmarkMinus, IconBookmarkPlus, IconLoader2, IconShirt } from "@tabler/icons-react"

interface CatalogCardProps {
  skin: LabySkin
  selected: boolean
  inFavorites: boolean
  /** Надеть скин можно только с аккаунтом Microsoft. */
  canApply: boolean
  /** Какое действие сейчас идёт именно по этой карточке. */
  busy: "save" | "apply" | "remove" | null
  onSelect: () => void
  onSave: () => void
  onRemove: () => void
  onApply: () => void
}

/**
 * Карточка скина каталога Laby.
 *
 * Отличие от карточки «Избранного» принципиальное: там живой 3D-вьюер на
 * локальной текстуре, здесь — готовый рендер с CDN. В каталоге десятки скинов,
 * и поднимать на каждый WebGL-контекст нельзя (браузерный держит их ~16).
 *
 * Подписей под карточкой нет намеренно: у Laby нет имён скинов, и вместо
 * названия выводился первый тег — то есть подпись не сообщала ничего сверх
 * того, что и так видно на рендере.
 */
export function CatalogCard({
  skin,
  selected,
  inFavorites,
  canApply,
  busy,
  onSelect,
  onSave,
  onRemove,
  onApply,
}: CatalogCardProps) {
  const { t } = useTranslation()

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "group relative aspect-[31/40] w-full min-w-0 cursor-pointer overflow-hidden rounded-xl border-2 bg-card/50 transition-all duration-200 outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/60",
        selected
          ? "border-primary/60 shadow-[0_0_16px_var(--glow-primary)]"
          : "border-border/40 hover:border-border/80 hover:shadow-lg hover:shadow-black/20",
      )}
    >
      <div className="h-full w-full overflow-hidden bg-gradient-to-b from-muted/10 to-muted/20">
        <SkinRender skin={skin} className="p-1" />
      </div>

      {inFavorites && (
        <span
          title={t("laby.inFavorites", "Уже в избранном")}
          className="absolute right-1.5 top-1.5 z-20 grid size-6 place-items-center rounded-lg bg-primary/90 text-primary-foreground shadow-sm"
        >
          <IconBookmarkPlus className="h-3.5 w-3.5" />
        </span>
      )}

      {/* Действия: избранное — переключатель, вторая кнопка надевает скин. */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          disabled={busy !== null}
          title={inFavorites ? t("laby.removeFromFavorites", "Убрать из избранного") : t("laby.addToFavorites", "В избранное")}
          aria-label={inFavorites ? t("laby.removeFromFavorites", "Убрать из избранного") : t("laby.addToFavorites", "В избранное")}
          onClick={(event) => {
            event.stopPropagation()
            if (inFavorites) onRemove()
            else onSave()
          }}
          className={cn(
            "grid size-7 place-items-center rounded-lg backdrop-blur-sm transition-colors disabled:opacity-60",
            inFavorites
              ? "bg-primary/85 text-primary-foreground hover:bg-primary"
              : "bg-white/15 text-white hover:bg-white/25",
          )}
        >
          {busy === "save" || busy === "remove" ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : inFavorites ? (
            <IconBookmarkMinus className="h-3.5 w-3.5" />
          ) : (
            <IconBookmarkPlus className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          disabled={busy !== null || !canApply}
          title={canApply ? t("laby.applyNow", "Надеть сейчас") : t("laby.noAccount", "Нужен аккаунт Microsoft")}
          aria-label={t("laby.applyNow", "Надеть сейчас")}
          onClick={(event) => {
            event.stopPropagation()
            onApply()
          }}
          className="grid size-7 place-items-center rounded-lg bg-primary/85 text-primary-foreground backdrop-blur-sm transition-colors hover:bg-primary disabled:opacity-50"
        >
          {busy === "apply" ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconShirt className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}