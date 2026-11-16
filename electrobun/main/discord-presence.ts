export type DiscordActivity = {
  state?: string
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
  loader?: string
  startTimestamp?: number
}

const loaderIcons: Record<string, string> = { fabric: "fabric_icon", quilt: "quilt_icon", optifine: "optifine_icon" }
const loaderNames: Record<string, string> = { fabric: "Fabric", quilt: "Quilt", optifine: "OptiFine" }

/** Discord загружает картинку со своей стороны и не видит локальные файлы. */
export function discordImageUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined
    if (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname)) return undefined
    return url.href
  } catch { return undefined }
}

export function presenceSmallImage(activity: DiscordActivity): { key?: string; text?: string } {
  const loader = activity.loader?.toLowerCase() ?? ""
  const key = activity.smallImageKey || loaderIcons[loader]
  return { key, text: key ? activity.smallImageText || loaderNames[loader] : undefined }
}

export function minecraftPresence(mcVersion: string, loader: string, build?: { name: string; icon?: string }, t: RuntimeTranslator = key => key): DiscordActivity {
  return {
    state: build ? t("runtime.presence.build", { name: build.name }) : t("runtime.presence.minecraft", { version: mcVersion }),
    loader: loader !== "vanilla" ? loader : undefined,
    smallImageKey: build ? discordImageUrl(build.icon) || (loaderIcons[loader.toLowerCase()] ? undefined : "logo") : undefined,
    smallImageText: build?.name,
    startTimestamp: Math.floor(Date.now() / 1000),
  }
}
import type { RuntimeTranslator } from "./i18n"
