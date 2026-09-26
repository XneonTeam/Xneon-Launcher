import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { SkinViewer3D } from "@/components/ui/skin-viewer-3d"
import { SkinAccountPicker } from "@/components/launcher/skins/account-picker"
import { useViewerSize } from "@/components/launcher/skins/use-viewer-size"
import { SkinRender } from "./skin-render"
import { labySkinPageUrl } from "@xnlc/skins"
import type { LabySkin } from "@xnlc/types"
import {
  IconBookmarkMinus,
  IconBookmarkPlus,
  IconExternalLink,
  IconHandClick,
  IconLoader2,
  IconShirt,
  IconUsers,
} from "@tabler/icons-react"

interface LabyPanelProps {
  skin: LabySkin | null
  inFavorites: boolean
  /** Надеть скин можно только с аккаунтом Microsoft. */
  canApply: boolean
  busy: "save" | "apply" | "remove" | null
  similar: LabySkin[]
  similarLoading: boolean
  onSave: () => void
  onRemove: () => void
  onApply: () => void
  onSelectSimilar: (skin: LabySkin) => void
}

/**
 * Левая панель каталога Laby: аккаунт, превью выбранного скина, действия и
 * похожие скины.
 *
 * Раскладка повторяет панель «Избранного», чтобы переход между вкладками не
 * выглядел как другое приложение. Превью крутит настоящую текстуру прямо с CDN
 * Laby — она отдаётся с `access-control-allow-origin: *`, поэтому ни IPC, ни
 * base64 здесь не нужны.
 */
export function LabyPanel({
  skin,
  inFavorites,
  canApply,
  busy,
  similar,
  similarLoading,
  onSave,
  onRemove,
  onApply,
  onSelectSimilar,
}: LabyPanelProps) {
  const { t } = useTranslation()
  const { ref, size } = useViewerSize()

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <SkinAccountPicker />

      {/* Превью: текстура грузится напрямую с CDN Laby */}
      <div className="relative h-[clamp(200px,30vh,300px)] shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-muted/30 to-muted/10 shadow-inner">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.65_0.22_40/0.05)_0%,transparent_70%)]" />
        <div ref={ref} className="relative z-10 grid h-full w-full place-items-center">
          {!skin ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-muted-foreground/40">
              <IconHandClick className="h-10 w-10 opacity-30" strokeWidth={1} />
              <p className="text-[12px] font-medium">{t("laby.pickSkin", "Выберите скин в каталоге")}</p>
            </div>
          ) : (
            <SkinViewer3D skinUrl={skin.textureUrl} slim={skin.slim} width={size.width} height={size.height} />
          )}
        </div>
      </div>

      {/* Действия */}
      {skin && (
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply || busy !== null}
            title={canApply ? undefined : t("laby.noAccount", "Нужен аккаунт Microsoft")}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
          >
            {busy === "apply" ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconShirt className="h-4 w-4" />}
            {t("laby.applyNow", "Надеть сейчас")}
          </button>

          {/* Избранное — переключатель: если скин уже сохранён, кнопка снимает его. */}
          <button
            type="button"
            onClick={inFavorites ? onRemove : onSave}
            disabled={busy !== null}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors duration-200 disabled:opacity-50",
              inFavorites
                ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "border-border bg-card text-foreground hover:bg-muted/60",
            )}
          >
            {busy === "save" || busy === "remove" ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : inFavorites ? (
              <IconBookmarkMinus className="h-4 w-4" />
            ) : (
              <IconBookmarkPlus className="h-4 w-4" />
            )}
            {inFavorites ? t("laby.removeFromFavorites", "Убрать из избранного") : t("laby.addToFavorites", "В избранное")}
          </button>

          <button
            type="button"
            onClick={() => void window.electronAPI?.openExternal(labySkinPageUrl(skin.hash))}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
            {t("laby.openOnLaby", "Открыть на Laby")}
          </button>
        </div>
      )}

      {/* Похожие скины: считаются в main по тегам, модели и популярности */}
      {skin && (similarLoading || similar.length > 0) && (
        <div className="shrink-0 rounded-2xl border border-border bg-card p-3 shadow-sm">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <IconUsers className="h-3 w-3" strokeWidth={2} />
            {t("laby.similar", "Похожие скины")}
            {similarLoading && <IconLoader2 className="h-3 w-3 animate-spin" />}
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {similar.map((item) => (
              <button
                key={item.hash}
                type="button"
                onClick={() => onSelectSimilar(item)}
                title={item.tags.slice(0, 5).join(" · ") || item.name}
                className="aspect-square overflow-hidden rounded-lg border border-border/50 bg-muted/20 transition-colors hover:border-primary/50"
              >
                <SkinRender skin={item} className="p-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}