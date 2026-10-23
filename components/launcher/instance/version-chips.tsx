import { cn } from "@/lib/utils"
import { LoaderIcon, loaderLabel } from "./loader-icon"

/**
 * Площадки пишут в `loaders` не только загрузчики: Modrinth ставит `minecraft`
 * всем проектам без мода (ресурспаки, шейдеры), и рядом с версиями игры такая
 * метка ничего не сообщает — её не показываем.
 */
const GENERIC_LOADERS = new Set(["minecraft"])

/** Версии игры из строки площадки («1.20, 1.20.1, …») — по одной на чип. */
export function gameVersionsOf(value?: string | null): string[] {
  const seen = new Set<string>()
  for (const part of String(value ?? "").split(",")) {
    const version = part.trim()
    if (version) seen.add(version)
  }
  return [...seen]
}

/** Загрузчики версии без служебных меток площадок, без повторов. */
export function loadersOf(loaders?: readonly string[] | null): string[] {
  const seen = new Map<string, string>()
  for (const raw of loaders ?? []) {
    const loader = String(raw ?? "").trim()
    const key = loader.toLowerCase()
    if (!key || GENERIC_LOADERS.has(key) || seen.has(key)) continue
    seen.set(key, loader)
  }
  return [...seen.values()]
}

/**
 * Версии игры отдельными блоками: у ресурспаков их бывает два десятка,
 * и одной строкой через запятую они не читаются.
 */
export function GameVersionChips({
  gameVersion,
  className,
}: {
  gameVersion?: string | null
  className?: string
}) {
  const versions = gameVersionsOf(gameVersion)
  if (versions.length === 0) return null

  return (
    <span data-ui="instance-version-chips-span-1" data-component="game-version-chips" className={cn("flex flex-wrap items-center gap-1", className)}>
      {versions.map((version) => (
        <span data-ui="instance-version-chips-span-2"
          key={version}
          className="rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground"
        >
          {version}
        </span>
      ))}
    </span>
  )
}

/** Настоящие загрузчики версии (Forge/Fabric/Iris…), каждый — отдельным блоком. */
export function LoaderBadges({
  loaders,
  className,
}: {
  loaders?: readonly string[] | null
  className?: string
}) {
  const list = loadersOf(loaders)
  if (list.length === 0) return null

  return (
    <span data-ui="instance-version-chips-span-3" data-component="loader-badges" className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {list.map((loader) => (
        <span data-ui="instance-version-chips-span-4"
          key={loader}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
        >
          <LoaderIcon loaderId={loader.toLowerCase()} className="h-3 w-3 shrink-0" />
          {loaderLabel(loader)}
        </span>
      ))}
    </span>
  )
}
