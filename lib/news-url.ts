import { SERVICE_URLS } from "@xnlc/urls"
import type { MinecraftNewsEntry } from "@xnlc/types"

/** Исправляет адреса статей из ленты и уже сохранённого кэша новостей. */
export function normalizeNewsArticleUrl(url?: string | null): string | null {
  if (!url) return null
  return url.replace(
    /^https?:\/\/(?:localhost|127\.0\.0\.1):3000(?=[/?#]|$)/i,
    SERVICE_URLS.launcher,
  )
}

/** Сайт лаунчера оформляет свои статьи сам, включая пользовательские ленты. */
export function isLauncherNewsArticle(entry: Pick<MinecraftNewsEntry, "newsType" | "readMoreLink"> | null): boolean {
  if (entry?.newsType?.includes("Launcher")) return true
  const url = normalizeNewsArticleUrl(entry?.readMoreLink)
  try {
    return !!url && new URL(url).origin === new URL(SERVICE_URLS.launcher).origin
  } catch {
    return false
  }
}
