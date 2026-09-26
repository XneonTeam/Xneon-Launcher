import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { SkinViewer3D } from "@/components/ui/skin-viewer-3d"
import { ElytraIcon } from "@/components/ui/elytra-icon"
import { SkinAccountPicker } from "./account-picker"
import { useViewerSize } from "./use-viewer-size"
import type { SkinCardData } from "./skin-card"
import type { McProfile } from "@xnlc/types"
import {
  IconLoader2, IconUser, IconCheck,
  IconPencil, IconRefresh,
} from "@tabler/icons-react"

interface SkinPreviewPanelProps {
  selectedSkin: SkinCardData | undefined
  selectedCapeUrl: string | undefined
  hasPendingChange: boolean
  isApplying: boolean
  loading: boolean
  profile: McProfile | null
  skinVersion?: number
  onApply: () => void
  onReset: () => void
  onEdit: () => void
  onCancelSelection: () => void
}

/**
 * Левая панель вкладки «Избранное»: аккаунт, превью выбранного скина и
 * действия — «Экипировать», «Изменить», «Сбросить».
 *
 * Раскладка повторяет панель каталога Laby (`LabyPanel`): компактный
 * блок аккаунта, превью под высоту окна и кнопки, а сама панель скроллится.
 * Раньше здесь был широкий блок на 1.1fr с превью на 380 px — в окне
 * 1280×800 до кнопок было не добраться.
 */
export function SkinPreviewPanel({
  selectedSkin,
  selectedCapeUrl,
  hasPendingChange,
  isApplying,
  loading,
  profile,
  skinVersion,
  onApply,
  onReset,
  onEdit,
  onCancelSelection,
}: SkinPreviewPanelProps) {
  const { t } = useTranslation()
  /** Показ элитры: разворачивает персонажа спиной (плащ/элитра висят сзади). */
  const [showElytra, setShowElytra] = useState(false)
  const { ref, size } = useViewerSize()

  /** Иконки аккаунтов не кэшируем между сменами скина: персонаж уже другой. */
  const skinVersionKey = skinVersion ?? 0

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <SkinAccountPicker avatarVersion={skinVersionKey} />

      {/* Превью: высота подстраивается под окно */}
      <div className="relative h-[clamp(200px,30vh,300px)] shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-muted/30 to-muted/10 shadow-inner">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.65_0.22_40/0.04)_0%,transparent_70%)]" />

        {/*
          Кнопка «Элитра»: разворачивает персонажа спиной и показывает элитру —
          плащ и элитра висят за спиной, анфас их не видно. Повторный клик
          возвращает обычный вид. Элитра рендерится из той же текстуры, что и
          плащ, поэтому без выбранного плаща кнопка заблокирована.
        */}
        <div className="absolute right-2 top-2 z-20">
          <button
            type="button"
            disabled={!selectedCapeUrl}
            aria-pressed={showElytra && Boolean(selectedCapeUrl)}
            onClick={() => setShowElytra((value) => !value)}
            title={selectedCapeUrl
              ? t("skins.elytraHint", "Показать плащ как элитру")
              : t("skins.elytraNoCape", "Сначала выберите плащ")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
              showElytra && selectedCapeUrl
                ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/25"
                : "border-border bg-card/85 text-muted-foreground hover:bg-muted hover:text-foreground",
              !selectedCapeUrl && "cursor-not-allowed opacity-50 hover:bg-card/85 hover:text-muted-foreground",
            )}
          >
            <ElytraIcon className={cn("h-3.5 w-3.5", !(showElytra && selectedCapeUrl) && "opacity-70")} />
            {t("skins.elytra", "Элитра")}
          </button>
        </div>

        <div ref={ref} className="relative z-10 grid h-full w-full place-items-center">
          {loading ? (
            <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
          ) : selectedSkin?.blobUrl ? (
            <SkinViewer3D
              skinUrl={selectedSkin.blobUrl}
              capeUrl={selectedCapeUrl}
              slim={selectedSkin.variant === "slim"}
              backEquipment={showElytra && selectedCapeUrl ? "elytra" : "cape"}
              faceBack={showElytra && Boolean(selectedCapeUrl)}
              width={size.width}
              height={size.height}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
              <IconUser className="h-12 w-12 opacity-30" strokeWidth={1} />
              <p className="text-[12px] font-medium">{t("skins.noSkin", "Скин не установлен")}</p>
            </div>
          )}
        </div>
      </div>

      {/*
        Действия. Главная кнопка — «Экипировать»: она надевает выбранный скин.
        Когда выбран уже надетый скин, кнопка неактивна и говорит «Надет», чтобы
        не казалось, будто действие доступно. Редактирование вынесено в
        отдельную иконку: раньше эта кнопка называлась «Изменить» и открывала
        модалку, из-за чего надеть скин из панели было нельзя.
      */}
      <div className="flex shrink-0 gap-2">
        <button
          onClick={onApply}
          disabled={!hasPendingChange || !selectedSkin || loading || isApplying}
          title={hasPendingChange
            ? t("skins.equipHint", "Надеть выбранный скин")
            : t("skins.alreadyEquipped", "Этот скин уже надет")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200",
            hasPendingChange && selectedSkin
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/30 active:scale-[0.98]"
              : // Уже надетый скин: кнопка остаётся основным цветом, но не
                // нажимается — серый цвет читался как «сломано», а не «нечего
                // делать».
                "bg-primary/45 text-primary-foreground",
            (loading || isApplying) && "opacity-50",
          )}
        >
          {isApplying ? (
            <IconLoader2 className="w-4 h-4 animate-spin" />
          ) : (
            <IconCheck className="w-4 h-4" />
          )}
          {hasPendingChange ? t("skins.equip", "Экипировать") : t("skins.equippedState", "Надет")}
        </button>

        {hasPendingChange ? (
          <button
            onClick={onCancelSelection}
            disabled={loading}
            className="flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2.5 text-muted-foreground transition-all duration-200 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            title={t("skins.cancel", "Отмена")}
          >
            <IconRefresh className="w-4 h-4" />
          </button>
        ) : (
          <>
            <button
              onClick={onEdit}
              disabled={!selectedSkin || loading}
              className="flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2.5 text-muted-foreground transition-all duration-200 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
              title={t("skins.editSkin", "Изменить скин")}
            >
              <IconPencil className="w-4 h-4" />
            </button>
            <button
              onClick={onReset}
              disabled={loading}
              className="flex items-center justify-center rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-primary transition-all duration-200 hover:bg-primary/10 disabled:opacity-50"
              title={t("skins.reset", "Сбросить")}
            >
              <IconRefresh className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </aside>
  )
}