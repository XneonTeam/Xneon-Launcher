import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { LoaderIcon } from "./loader-icon"

interface CategoryIconMaps {
  modrinth: Record<string, string>
  curseforge: Record<string, string>
}

const EMPTY_MAPS: CategoryIconMaps = { modrinth: {}, curseforge: {} }

let iconsPromise: Promise<CategoryIconMaps> | null = null

/**
 * Иконки категорий приходят из официальных API:
 * Modrinth — /tag/category (SVG), CurseForge — /categories (iconUrl).
 * Загружаем один раз на процесс рендерера.
 */
function loadCategoryIcons(): Promise<CategoryIconMaps> {
  if (!iconsPromise) {
    iconsPromise = Promise.all([
      window.electronAPI?.modsModrinthCategories?.() ?? Promise.resolve([]),
      window.electronAPI?.modsCurseforgeCategories?.() ?? Promise.resolve([]),
    ])
      .then(([mr, cf]) => {
        const modrinth: Record<string, string> = {}
        for (const c of (mr ?? []) as Array<{ name?: string; icon?: string }>) {
          if (c?.name && c.icon) modrinth[c.name.toLowerCase()] = c.icon
        }
        const curseforge: Record<string, string> = {}
        for (const c of (cf ?? []) as Array<{ name?: string; icon?: string }>) {
          if (c?.name && c.icon) curseforge[c.name.toLowerCase()] = c.icon
        }
        return { modrinth, curseforge }
      })
      .catch(() => EMPTY_MAPS)
  }
  return iconsPromise
}

const KNOWN_LOADERS = new Set(["fabric", "forge", "neoforge", "quilt", "liteloader", "rift", "vanilla"])

export interface CategoryBadgeProps {
  name: string
  /** Источник проекта — от него зависит набор иконок */
  source?: "modrinth" | "curseforge" | "ftb" | "local"
  className?: string
}

/**
 * Плашка категории: иконка категории с её официального источника
 * (или иконка загрузчика, если в категориях пришёл f.e. «fabric»).
 * Оформление — под цвет темы, одинаковое во всех вкладках.
 */
export function CategoryBadge({ name, source, className }: CategoryBadgeProps) {
  const [icons, setIcons] = useState<CategoryIconMaps>(EMPTY_MAPS)

  useEffect(() => {
    let alive = true
    void loadCategoryIcons().then((value) => {
      if (alive) setIcons(value)
    })
    return () => { alive = false }
  }, [])

  const key = name.toLowerCase()
  const icon = (source === "curseforge" ? icons.curseforge[key] : icons.modrinth[key])
    ?? icons.modrinth[key]
    ?? icons.curseforge[key]
    ?? ""

  const hasSvg = icon.trimStart().startsWith("<svg")
  const hasImg = !hasSvg && icon.startsWith("http")
  const isLoader = !hasSvg && !hasImg && KNOWN_LOADERS.has(key)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs capitalize text-primary",
        className
      )}
    >
      {hasSvg && (
        <span
          className="h-3.5 w-3.5 shrink-0 [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      )}
      {hasImg && <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />}
      {isLoader && <LoaderIcon loaderId={key} className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{name}</span>
    </span>
  )
}
