import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { SkinViewer3D } from "@/components/ui/skin-viewer-3d"
import { resolveSkinCapeUrl } from "./cape-url"
import { IconTrash, IconPencil, IconUser } from "@tabler/icons-react"
import type { McProfile, LibrarySkin } from "@xnlc/types"

export interface SkinCardData {
  id: string
  name: string
  blobUrl: string
  variant: "classic" | "slim"
  isEquipped: boolean
  capeId: string | null
  librarySkin?: LibrarySkin
}

interface SkinCardProps {
  skin: SkinCardData
  isSelected: boolean
  isEquipped: boolean
  capes: McProfile["capes"]
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * Карточка скина в «Избранном».
 *
 * По раскладке повторяет карточку каталога Laby: сверху превью, снизу подпись
 * и модель. Превью здесь живое — крутится локальная текстура через
 * `SkinViewer3D`.
 */
export function SkinCard({
  skin,
  isSelected,
  isEquipped,
  capes,
  onSelect,
  onEdit,
  onDelete,
}: SkinCardProps) {
  const { t } = useTranslation()

  const capeUrl = useMemo(() => resolveSkinCapeUrl(skin.capeId, capes), [skin.capeId, capes])

  // WebGL-контекст создаётся только для видимых карточек. Раньше каждая карточка
  // библиотеки скинов поднимала свой SkinViewer с бесконечным rAF-циклом: на
  // библиотеке в сотни скинов это упиралось в браузерный лимит WebGL-контекстов
  // (~16) и жгло CPU. За пределами вьюпорта вьюер не монтируется вовсе.
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewVisible, setPreviewVisible] = useState(false)

  useEffect(() => {
    const node = previewRef.current
    if (!node || typeof IntersectionObserver === "undefined") {
      setPreviewVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setPreviewVisible(entry.isIntersecting)
      },
      // Небольшой запас, чтобы при прокрутке скин успевал отрисоваться.
      { rootMargin: "200px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
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
        isSelected
          ? "border-primary/60 shadow-[0_0_16px_var(--glow-primary)]"
          : "border-border/40 hover:border-border/80 hover:shadow-lg hover:shadow-black/20",
      )}
    >
      <div
        ref={previewRef}
        className="h-full w-full overflow-hidden bg-gradient-to-b from-muted/10 to-muted/20"
      >
        <div className="grid h-full w-full place-items-center p-1">
          {skin.blobUrl ? (
            previewVisible ? (
              <SkinViewer3D
                skinUrl={skin.blobUrl}
                capeUrl={capeUrl}
                slim={skin.variant === "slim"}
                width={180}
                height={240}
                // max-* вместо растягивания: canvas держит свои пропорции и
                // вписывается в область, а не деформирует персонажа.
                className="max-h-full max-w-full"
              />
            ) : (
              <IconUser className="h-10 w-10 text-muted-foreground/20" strokeWidth={1} />
            )
          ) : (
            <IconUser className="h-10 w-10 text-muted-foreground/20" strokeWidth={1} />
          )}
        </div>

        {/* Delete button */}
        {!isEquipped && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="absolute left-1.5 top-1.5 z-30 flex items-center justify-center size-6 rounded-lg bg-destructive/80 text-destructive-foreground cursor-pointer hover:bg-destructive transition-all duration-200 shadow-md opacity-0 group-hover:opacity-100"
          >
            <IconTrash className="w-3 h-3" />
          </span>
        )}

        {/* Equipped badge */}
        {isEquipped && (
          <span className="absolute inset-x-0 top-0 z-30 flex items-center justify-center py-1 bg-emerald-500/90 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
            {t("skins.equipped", "Активен")}
          </span>
        )}

        {/* Hover edit button */}
        <div className="absolute inset-x-0 bottom-0 z-30 flex justify-end p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <span
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            title={t("skins.edit", "Изменить")}
            aria-label={t("skins.edit", "Изменить")}
            className="grid size-7 place-items-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            <IconPencil className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      {/*
        Подписей под карточкой нет намеренно: имя скина у каталога — это его
        тег, у локального файла — имя файла, а модель и источник и так видны
        в панели слева.
      */}
    </div>
  )
}