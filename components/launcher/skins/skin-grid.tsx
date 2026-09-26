import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/launcher/instance/spinner"
import { SkinCard, type SkinCardData } from "./skin-card"
import type { McProfile } from "@xnlc/types"

interface SkinGridProps {
  skins: SkinCardData[]
  selectedId: string | null
  equippedId: string | null
  loading: boolean
  dragOver: boolean
  capes: McProfile["capes"]
  onSelect: (id: string) => void
  onEdit: (skin?: SkinCardData) => void
  onDelete: (id: string) => void
  onAddNew: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}

/**
 * Сетка сохранённых скинов.
 *
 * Первым элементом всегда стоит слот добавления — та же плитка, что и раньше:
 * пунктирная рамка, силуэт скина с плюсом и приём PNG перетаскиванием. Это и
 * кнопка («Добавить скин» открывает модалку), и посадочное место для файла,
 * поэтому отдельная кнопка в тулбаре не нужна.
 *
 * Плотность считается по ширине контейнера (`@container`), а не окна. Потолок
 * здесь ниже, чем у каталога Laby: превью каждой карточки — отдельный
 * WebGL-контекст (`SkinViewer3D`), а браузер держит их около 16 и начинает
 * вытеснять старые. В каталоге карточки — готовые картинки, поэтому там до
 * шести колонок, а тут максимум четыре.
 */
export function SkinGrid({
  skins,
  selectedId,
  equippedId,
  loading,
  dragOver,
  capes,
  onSelect,
  onEdit,
  onDelete,
  onAddNew,
  onDragOver,
  onDragLeave,
  onDrop,
}: SkinGridProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        "grid w-full grid-cols-2 gap-2.5 @[400px]:grid-cols-3 @[620px]:grid-cols-4",
        dragOver && "rounded-2xl ring-2 ring-primary/50 ring-offset-2 ring-offset-background",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/*
        Пока скины грузятся — загрузка по центру области, без слотa добавления
        и скелетонов: пользователю в этот момент нечего делать, а прыгающие
        рамки только мешают.
      */}
      {loading ? (
        <div className="col-span-full">
          <Spinner />
        </div>
      ) : (
        <>
          {/* Слот добавления */}
          <button
            type="button"
            onClick={onAddNew}
            className={cn(
              "group flex h-full min-h-[240px] w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-all duration-300",
              dragOver
                ? "border-primary bg-primary/10 scale-[1.02] shadow-lg shadow-primary/10"
                : "border-border/50 bg-card/50 hover:border-primary/40 hover:bg-muted/20 hover:shadow-md",
            )}
          >
        <svg
          viewBox="0 0 60 80"
          fill="none"
          className={cn(
            "w-14 h-[72px] transition-all duration-300",
            dragOver ? "text-primary scale-110" : "text-muted-foreground group-hover:text-primary",
          )}
        >
          {/* Head */}
          <rect x="18" y="2" width="24" height="24" rx="2"
            className="stroke-current opacity-30 group-hover:opacity-50 transition-opacity" strokeWidth="1.5" />
          {/* Eyes */}
          <rect x="23" y="12" width="4" height="3" rx="0.5" className="fill-current opacity-10" />
          <rect x="33" y="12" width="4" height="3" rx="0.5" className="fill-current opacity-10" />
          {/* Body */}
          <rect x="18" y="28" width="24" height="24" rx="2"
            className="stroke-current opacity-20 group-hover:opacity-40 transition-opacity" strokeWidth="1.5" />
          {/* Left Arm */}
          <rect x="6" y="28" width="10" height="24" rx="2"
            className="stroke-current opacity-15 group-hover:opacity-30 transition-opacity" strokeWidth="1.5" />
          {/* Right Arm */}
          <rect x="44" y="28" width="10" height="24" rx="2"
            className="stroke-current opacity-15 group-hover:opacity-30 transition-opacity" strokeWidth="1.5" />
          {/* Left Leg */}
          <rect x="18" y="54" width="11" height="24" rx="2"
            className="stroke-current opacity-20 group-hover:opacity-35 transition-opacity" strokeWidth="1.5" />
          {/* Right Leg */}
          <rect x="31" y="54" width="11" height="24" rx="2"
            className="stroke-current opacity-20 group-hover:opacity-35 transition-opacity" strokeWidth="1.5" />
          {/* Plus badge */}
          <circle cx="48" cy="52" r="9" className="fill-primary opacity-80" />
          <path d="M48 47v10M43 52h10" className="stroke-primary-foreground opacity-90" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="text-[11px] font-semibold text-foreground">
            {t("skins.addSkin", "Добавить скин")}
          </span>
          <span className="text-[10px] font-medium text-primary/70">
            {dragOver ? t("skins.dropHere", "Отпустите PNG") : t("skins.dragDrop", "Перетащить PNG")}
          </span>
        </button>

        {skins.map((skin) => (
          <SkinCard
            key={skin.id}
            skin={skin}
            isSelected={skin.id === selectedId}
            isEquipped={skin.id === equippedId}
            capes={capes}
            onSelect={() => onSelect(skin.id)}
            onEdit={() => onEdit(skin)}
            onDelete={() => onDelete(skin.id)}
          />
        ))}
        </>
      )}
    </div>
  )
}