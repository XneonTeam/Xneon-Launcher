import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { SkinViewer3D } from "@/components/ui/skin-viewer-3d"
import { IconTrash, IconCheck, IconPencil, IconUser } from "@tabler/icons-react"
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

  const capeUrl = useMemo(() => {
    if (skin.capeId) {
      const cape = capes?.find((c) => c.id === skin.capeId)
      if (cape?.url) return cape.url
    }
    return undefined
  }, [skin.capeId, capes])

  return (
    <div
      className={cn(
        "group relative aspect-[31/40] w-full min-w-0 rounded-2xl overflow-hidden border-2 transition-all duration-300 cursor-pointer",
        isSelected
          ? "border-primary/60 shadow-[0_0_20px_var(--glow-primary)] scale-[1.02]"
          : "border-border/40 hover:border-border/80 hover:shadow-lg hover:shadow-black/20 hover:scale-[1.01]"
      )}
      onClick={onSelect}
    >
      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute inset-0 bg-gradient-to-b from-primary/8 to-transparent pointer-events-none z-10" />
      )}

      {/* Delete button */}
      {!isEquipped && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute left-2.5 top-2.5 z-30 flex items-center justify-center size-7 rounded-xl bg-destructive/80 text-destructive-foreground cursor-pointer hover:bg-destructive transition-all duration-200 shadow-md opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
        >
          <IconTrash className="w-3.5 h-3.5" />
        </span>
      )}

      {/* Equipped badge */}
      {isEquipped && (
        <span className="absolute inset-x-0 top-0 z-30 flex items-center justify-center py-1.5 bg-emerald-500/90 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
          {t("skins.equipped", "Активен")}
        </span>
      )}

      {/* Skin 3D preview */}
      <div className="relative z-0 w-full h-full grid place-items-center p-2 bg-gradient-to-b from-muted/5 to-muted/15">
        {skin.blobUrl ? (
          <SkinViewer3D
            skinUrl={skin.blobUrl}
            capeUrl={capeUrl}
            slim={skin.variant === "slim"}
            width={180}
            height={240}
            className="w-full h-full"
          />
        ) : (
          <div className="flex items-center justify-center">
            <IconUser className="w-10 h-10 text-muted-foreground/20" strokeWidth={1} />
          </div>
        )}
      </div>

      {/* Bottom gradient */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 via-black/20 to-transparent z-20 pointer-events-none" />

      {/* Hover edit button */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-3 pb-3">
        <div className="flex translate-y-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <span
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="flex items-center justify-center gap-1 w-full px-2.5 py-1.5 rounded-lg bg-white/15 backdrop-blur-sm text-white text-[11px] font-medium cursor-pointer hover:bg-white/25 transition-colors"
          >
            <IconPencil className="w-3 h-3" />
            {t("skins.edit", "Изменить")}
          </span>
        </div>
      </div>
    </div>
  )
}
