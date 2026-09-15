import i18n from "@/src/i18n"

export function formatDateTime(ms: number): string {
  if (!ms) return "—"
  const locale = i18n.language === "ru" ? "ru-RU" : i18n.language === "uk" ? "uk-UA" : i18n.language === "de" ? "de-DE" : i18n.language === "es" ? "es-ES" : "en-US"
  return new Date(ms).toLocaleString(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export function formatBytes(bytes: number | null | undefined, locale?: "en" | "ru"): string {
  if (bytes == null || Number.isNaN(bytes)) return "—"
  void locale
  const units = [
    i18n.t("units.byte"),
    i18n.t("units.kb"),
    i18n.t("units.mb"),
    i18n.t("units.gb"),
    i18n.t("units.tb"),
  ]
  if (bytes === 0) return `0 ${units[0]}`
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  const digits = (i === 0 || value >= 10) ? 0 : 1
  return `${value.toFixed(digits)} ${units[i]}`
}

export function formatPlaytime(seconds: number): string {
  if (seconds < 60) return i18n.t("time.seconds", { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return i18n.t("time.minutes", { count: minutes })
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return mins > 0 ? i18n.t("time.hoursMinutes", { hours, minutes: mins }) : i18n.t("time.hours", { count: hours })
  const days = Math.floor(hours / 24)
  const hrs = hours % 24
  return hrs > 0 ? i18n.t("time.daysHours", { days, hours: hrs }) : i18n.t("time.days", { count: days })
}