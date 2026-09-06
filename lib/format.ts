export function formatDateTime(ms: number): string {
  if (!ms) return "—"
  return new Date(ms).toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export function formatBytes(bytes: number | null | undefined, locale: "en" | "ru" = "en"): string {
  if (bytes == null || Number.isNaN(bytes)) return "—"
  const units = locale === "ru" ? ["Б", "КБ", "МБ", "ГБ", "ТБ"] : ["B", "KB", "MB", "GB", "TB"]
  if (bytes === 0) return `0 ${units[0]}`
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  const digits = (i === 0 || value >= 10) ? 0 : 1
  return `${value.toFixed(digits)} ${units[i]}`
}