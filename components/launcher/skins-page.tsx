import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { FavoritesTab } from "./skins"
import { LabyLibraryTab } from "./laby"
import { IconShirt, IconLayoutGrid, IconBookmarkFilled } from "@tabler/icons-react"

type SkinsTab = "favorites" | "library"

/**
 * Страница «Скины» — одна вкладка в сайдбаре с двумя разделами внутри.
 *
 * Переключатель сделан как в карточке сборки (`instance-detail`): пилюля с
 * иконкой и подписью, активная залита основным цветом. Раньше «Избранное» и
 * «Библиотека» были двумя пунктами меню, хотя это одна тема — свои скины и
 * каталог, из которого их берут. По умолчанию открывается «Избранное»:
 * это то, что пользователь надевает.
 */
export function SkinsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SkinsTab>("favorites")

  const tabs = [
    { id: "favorites" as const, icon: IconBookmarkFilled, label: t("skins.tab.favorites", "Избранное") },
    { id: "library" as const, icon: IconLayoutGrid, label: t("skins.tab.library", "Библиотека") },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Заголовок страницы и переключатель разделов */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/20">
          <IconShirt className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-foreground">{t("skins.title", "Скины")}</h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {t("skins.subtitle", "Ваши скины и открытый каталог Laby")}
          </p>
        </div>

        <div className="flex shrink-0 gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1">
          {tabs.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200",
                tab === id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {tab === "favorites" ? <FavoritesTab /> : <LabyLibraryTab />}
      </div>
    </div>
  )
}