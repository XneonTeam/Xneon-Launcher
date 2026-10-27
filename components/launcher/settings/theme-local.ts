import type { LocalThemeFile, LocalThemeSnapshot, Theme } from "@xnlc/types"
import { createCustomTheme, parseThemeCss, sanitizeTheme } from "./theme-model"

/** Существующий ID сохраняется: внешнее редактирование не сбрасывает выбор темы. */
export function themeFromLocalFile(file: LocalThemeFile, current?: Theme): Theme | null {
  const validated = sanitizeTheme(file.theme)
  const metadata = validated?.id.startsWith("custom-") ? validated : null
  const base = metadata ? { ...current, ...metadata, id: current?.id ?? metadata.id } : current ?? createCustomTheme(file.name)
  const parsed = parseThemeCss(file.css, base)
  if (!parsed) return null
  return { ...parsed, id: current?.id ?? metadata?.id ?? `custom-local-${encodeURIComponent(file.fileName)}`, name: base.name, custom: true, localFile: file.fileName }
}

export function mergeLocalThemes(current: Theme[], snapshot: LocalThemeSnapshot): Theme[] {
  const next = [...current]
  for (const file of snapshot.files) {
    const index = next.findIndex(theme => theme.localFile === file.fileName || theme.id === file.theme?.id)
    const theme = themeFromLocalFile(file, next[index])
    if (!theme) continue
    if (index < 0) next.push(theme)
    else next[index] = theme
  }
  // При удалении CSS извне оставляем последнюю рабочую копию в БД.
  // Ошибки чтения файла также не уничтожают сохранённую тему.
  return next
}
