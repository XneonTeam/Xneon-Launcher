import type { ModContentType, ModVersion } from "@xnlc/types"

export const MODS_PER_PAGE = 20

export const MODLOADER_MODS = ["forge", "fabric", "quilt", "neoforge"]
export const MODLOADER_PLUGINS = ["paper", "spigot", "bukkit", "purpur", "folia", "sponge", "bungeecord", "velocity", "waterfall"]

export function getContentType(modloader: string): ModContentType | null {
  if (MODLOADER_MODS.includes(modloader)) return "mod"
  if (MODLOADER_PLUGINS.includes(modloader)) return "plugin"
  return null
}

export function getContentDir(modloader: string): string {
  if (MODLOADER_MODS.includes(modloader)) return "mods"
  if (MODLOADER_PLUGINS.includes(modloader)) return "plugins"
  return ""
}

export function normalizeContentIdentity(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(jar|zip)$/gi, "")
    .replace(/[\W_]+/g, "")
}

/**
 * Семейства загрузчиков, внутри которых плагины взаимозаменяемы: Paper/Spigot/
 * Purpur/Bukkit понимают одни и те же плагины, прокси — свои.
 */
const PLUGIN_LOADER_FAMILIES: readonly (readonly string[])[] = [
  ["bukkit", "spigot", "paper", "purpur", "folia", "pufferfish"],
  ["bungeecord", "waterfall", "velocity"],
  ["sponge", "spongeapi"],
]

export function isPluginLoaderCompatible(loader: string, loaders: string[]): boolean {
  if (loaders.includes(loader)) return true
  const family = PLUGIN_LOADER_FAMILIES.find(group => group.includes(loader))
  if (!family) return false
  return loaders.some(candidate => family.includes(candidate))
}

/**
 * Совместима ли версия с сервером: подходит и версия Minecraft, и загрузчик.
 * Логика та же, что в инстансах (matchesBuildVersion) — версии под другие
 * загрузчики/версии игры не показываются вовсе.
 */
export function isVersionCompatibleWithServer(version: ModVersion, gameVersion: string, modloader: string): boolean {
  const gvs = (version.gameVersion ?? "").split(/[|,/]/).map(s => s.trim()).filter(Boolean)
  const targetMc = (gameVersion ?? "").trim().toLowerCase()
  if (gvs.length > 0 && targetMc && !gvs.some(v => v.trim().toLowerCase() === targetMc)) {
    return false
  }

  const loader = (modloader ?? "").toLowerCase().trim()
  if (!loader) return true
  const loaders = (version.loaders ?? []).map(l => String(l).toLowerCase().trim()).filter(Boolean)
  if (loader === "vanilla") return loaders.length === 0

  const isPluginServer = getContentType(loader) === "plugin"

  // CurseForge не проставляет загрузчик у файлов плагинов (classId = 5): в их
  // gameVersions лежат только версии Minecraft, без Bukkit/Spigot/Paper. Поэтому
  // пустой список загрузчиков на плагин-сервере — это норма, а не «другой
  // загрузчик»; иначе все плагины CurseForge выглядели несовместимыми
  // («Не найдено подходящих версий» при живых файлах под нужную версию).
  if (loaders.length === 0) return isPluginServer

  if (isPluginServer) return isPluginLoaderCompatible(loader, loaders)
  return loaders.includes(loader)
}
