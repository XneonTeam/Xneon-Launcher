import { LOADER_SVG_ICONS } from "./loader-icons"

interface LoaderIconProps {
  loaderId: string
  className?: string
}

/**
 * Варианты Sponge используют иконку базового `sponge`.
 * `modloader` в серверах хранит конкретный тип (spongeneo/spongeforge/spongevanilla),
 * поэтому маппим их на общий ключ.
 */
const LOADER_ICON_ALIASES: Record<string, string> = {
  spongeneo: "sponge",
  spongeforge: "sponge",
  spongevanilla: "sponge",
}

/** Отображаемое имя загрузчика (для `modloader` сервера/сборки). */
const LOADER_DISPLAY_NAMES: Record<string, string> = {
  vanilla: "Vanilla",
  forge: "Forge",
  fabric: "Fabric",
  quilt: "Quilt",
  neoforge: "NeoForge",
  liteloader: "LiteLoader",
  optifine: "OptiFine",
  paper: "Paper",
  spigot: "Spigot",
  bukkit: "Bukkit",
  purpur: "Purpur",
  folia: "Folia",
  sponge: "Sponge",
  spongevanilla: "SpongeVanilla",
  spongeforge: "SpongeForge",
  spongeneo: "SpongeNeo",
  velocity: "Velocity",
  waterfall: "Waterfall",
  bungeecord: "BungeeCord",
  instance: "Instance",
}

export function loaderLabel(loaderId?: string | null): string {
  const id = String(loaderId ?? "").toLowerCase().trim()
  if (!id) return "Vanilla"
  return LOADER_DISPLAY_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

export function LoaderIcon({ loaderId, className = "w-4 h-4" }: LoaderIconProps) {
  const id = String(loaderId ?? "").toLowerCase().trim()
  const key = LOADER_ICON_ALIASES[id] ?? id
  const svg = LOADER_SVG_ICONS[key]
  if (!svg) return null

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
