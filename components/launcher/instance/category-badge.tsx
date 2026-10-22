import { useEffect, useState, type ReactNode } from "react"
import { cn, inheritSvgColor } from "@/lib/utils"
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
  name: string | string[]
  /** Источник проекта — от него зависит набор иконок */
  source?: "modrinth" | "curseforge" | "ftb" | "local"
  className?: string
  iconOnly?: boolean
  /** Запасная пиктограмма, если источник не отдал категорию или её значок. */
  fallbackIcon?: ReactNode
}

/**
 * Плашка категории: иконка категории с её официального источника
 * (или иконка загрузчика, если в категориях пришёл f.e. «fabric»).
 * Оформление — под цвет темы, одинаковое во всех вкладках.
 */
export function CategoryBadge({ name, source, className, iconOnly = false, fallbackIcon }: CategoryBadgeProps) {
  const [icons, setIcons] = useState<CategoryIconMaps>(EMPTY_MAPS)

  useEffect(() => {
    let alive = true
    void loadCategoryIcons().then((value) => {
      if (alive) setIcons(value)
    })
    return () => { alive = false }
  }, [])

  const names = (Array.isArray(name) ? name : [name]).filter(Boolean)
  const keys = names.map(value => value.toLocaleLowerCase())
  const preferred = source === "curseforge" ? icons.curseforge : icons.modrinth
  const secondary = source === "curseforge" ? icons.modrinth : icons.curseforge
  const key = keys.find(candidate => preferred[candidate] || secondary[candidate]) ?? keys[0] ?? ""
  const icon = preferred[key] ?? secondary[key] ?? ""

  const hasSvg = icon.trimStart().startsWith("<svg")
  const hasImg = !hasSvg && icon.startsWith("http")
  const isLoader = !hasSvg && !hasImg && KNOWN_LOADERS.has(key)

  return (
    <span data-ui="instance-category-badge-span-1" data-component="category-badge"
      title={iconOnly ? names.join(" / ") : undefined}
      className={cn(
        iconOnly ? "inline-flex h-5 w-5 shrink-0 items-center justify-center" : "inline-flex min-w-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs capitalize text-primary",
        className
      )}
    >
      {hasSvg && (
        <span data-ui="instance-category-badge-span-2"
          className={cn("shrink-0 [&_svg]:h-full [&_svg]:w-full", iconOnly ? "h-5 w-5 text-primary" : "h-3.5 w-3.5")}
          dangerouslySetInnerHTML={{ __html: iconOnly
            ? inheritSvgColor(icon.replace(/\b(fill|stroke)=(['"])(?!none|currentColor)[^'"]*\2/gi, "$1=\"currentColor\""))
            : icon }}
        />
      )}
      {hasImg && (iconOnly
        ? <span data-ui="instance-category-badge-img-1" className="h-5 w-5 shrink-0 bg-primary" style={{ maskImage: `url(${JSON.stringify(icon)})`, WebkitMaskImage: `url(${JSON.stringify(icon)})`, maskPosition: "center", WebkitMaskPosition: "center", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskSize: "contain", WebkitMaskSize: "contain" }} />
        : <img data-ui="instance-category-badge-img-1" src={icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />)}
      {isLoader && <LoaderIcon loaderId={key} className={cn("shrink-0", iconOnly ? "h-5 w-5" : "h-3.5 w-3.5")} />}
      {iconOnly && !icon && !isLoader && fallbackIcon && <span className="inline-flex h-5 w-5 items-center justify-center text-primary">{fallbackIcon}</span>}
      {!iconOnly && <span data-ui="instance-category-badge-span-3" className="truncate">{name}</span>}
    </span>
  )
}
