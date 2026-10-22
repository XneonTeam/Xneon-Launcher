/** Исправляет адреса статей из ленты и уже сохранённого кэша новостей. */
export function normalizeNewsArticleUrl(url?: string | null): string | null {
  if (!url) return null
  return url.replace(
    /^https?:\/\/(?:localhost|127\.0\.0\.1):3000(?=[/?#]|$)/i,
    "https://launcher.xneon.org",
  )
}
