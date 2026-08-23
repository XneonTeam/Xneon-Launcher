import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { SkinCard, type SkinCardData } from "./skin-card"
import { IconShirt } from "@tabler/icons-react"
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

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        // Dispatch a custom event so the parent can handle the file
        const event = new CustomEvent("skin-file-selected", { detail: file })
        window.dispatchEvent(event)
      }
      e.target.value = ""
    },
    []
  )

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/10 flex items-center justify-center">
            <IconShirt className="w-4 h-4 text-primary/70" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("skins.library", "Библиотека")}
            </h3>
            <p className="text-[11px] text-muted-foreground/50">
              {skins.length} {t("skins.skinsCount", "скинов")}
            </p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div
        className={cn(
          "grid w-full grid-cols-3 gap-2.5 min-[1300px]:grid-cols-4 min-[1750px]:grid-cols-5 min-[2050px]:grid-cols-6 transition-all duration-300",
          dragOver && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background rounded-3xl"
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Add skin button */}
        <button
          type="button"
          onClick={onAddNew}
          className={cn(
            "group aspect-[31/40] w-full min-w-0 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all duration-300",
            dragOver
              ? "border-primary bg-primary/10 scale-[1.02] shadow-lg shadow-primary/10"
              : "border-border/50 bg-card/50 hover:border-primary/40 hover:bg-muted/20 hover:shadow-md"
          )}
        >
          <svg
            viewBox="0 0 60 80"
            fill="none"
            className={cn(
              "w-14 h-[72px] transition-all duration-300",
              dragOver
                ? "text-primary scale-110"
                : "text-muted-foreground group-hover:text-primary"
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
              className="stroke-current opacity-18 group-hover:opacity-35 transition-opacity" strokeWidth="1.5" />
            {/* Right Leg */}
            <rect x="31" y="54" width="11" height="24" rx="2"
              className="stroke-current opacity-18 group-hover:opacity-35 transition-opacity" strokeWidth="1.5" />
            {/* Plus badge */}
            <circle cx="48" cy="52" r="9" className="fill-primary opacity-80" />
            <path d="M48 47v10M43 52h10" className="stroke-primary-foreground opacity-90" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] font-semibold text-foreground">
            {t("skins.addSkin", "Добавить скин")}
          </span>
          <span className="text-[10px] text-primary/70 font-medium">
            {t("skins.dragDrop", "Перетащить PNG")}
          </span>
        </button>

        {/* Loading skeleton */}
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`skeleton-${i}`}
              className="aspect-[31/40] w-full min-w-0 rounded-2xl bg-card/60 border border-border/30 overflow-hidden animate-pulse"
            >
              <div className="h-full bg-gradient-to-b from-muted/30 to-muted/10" />
            </div>
          ))}

        {/* Skin cards */}
        {!loading &&
          skins.map((skin) => (
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
      </div>


    </div>
  )
}
