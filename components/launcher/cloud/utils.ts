import i18n from "@/src/i18n"

export { formatBytes } from "@/lib/format"

export function timeAgo(date: string | Date): string {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return i18n.t("cloud.timeAgo.justNow")
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return i18n.t("cloud.timeAgo.minutesAgo", { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return i18n.t("cloud.timeAgo.hoursAgo", { count: hours })
  return i18n.t("cloud.timeAgo.daysAgo", { count: Math.floor(hours / 24) })
}

export function decodePossiblyBrokenUtf8(value: string): string {
  try {
    if (!/[ÐÑ]/.test(value)) return value
    const bytes = Uint8Array.from(value, char => char.charCodeAt(0))
    return new TextDecoder("utf-8").decode(bytes)
  } catch {
    return value
  }
}
