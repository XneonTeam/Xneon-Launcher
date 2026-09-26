import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { labyPlayerPageUrl, type LabyPlayer } from "@xnlc/types"
import { IconExternalLink, IconShirt, IconUsers } from "@tabler/icons-react"

/**
 * Шапка найденного игрока: аватарка, ник и счётчики.
 *
 * Аватарку рендерит сам Laby по UUID (`/texture/profile/head/{uuid}.png`) —
 * это единственный публичный способ показать голову игрока: `/user/{uuid}/profile`
 * закрыт проверкой, а `/textures` даёт только хэши текстур.
 */
export function PlayerHeader({ player }: { player: LabyPlayer }) {
  const { t } = useTranslation()
  const active = player.skins.find((skin) => skin.active)

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted/30 ring-1 ring-inset ring-border/60">
        {player.headUrl ? (
          <img
            src={player.headUrl}
            alt={player.username}
            draggable={false}
            className="h-full w-full object-contain [image-rendering:pixelated]"
          />
        ) : (
          <IconUsers className="h-6 w-6 text-muted-foreground/30" strokeWidth={1.5} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => void window.electronAPI?.openExternal(labyPlayerPageUrl(player.username))}
          className="flex items-center gap-1.5 text-sm font-semibold text-foreground transition-colors hover:text-primary"
        >
          {player.username}
          <IconExternalLink className="h-3.5 w-3.5 opacity-60" />
        </button>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 tabular-nums">
            <IconShirt className="h-3 w-3" strokeWidth={2} />
            {player.skins.length} {t("laby.playerSkinsCount", "скинов в истории")}
          </span>
          {player.capesCount > 0 && (
            <span className="tabular-nums">
              {player.capesCount} {t("laby.playerCapesCount", "плащей")}
            </span>
          )}
          {active && (
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
              {t("laby.playerSkinActive", "Текущий скин — первый")}
            </span>
          )}
        </div>

        {player.badges.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {player.badges.slice(0, 6).map((badge) => (
              <span
                key={badge.name}
                title={badge.description ?? undefined}
                className={cn(
                  "rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground",
                )}
              >
                {badge.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}