import { useCallback, useState } from "react"

export type LayoutMode = "grid" | "list"

/**
 * Вид «карточки / список», который запоминается между заходами на страницу.
 * Ключ передаётся снаружи, поэтому у сборок и серверов выбор независимый:
 * переключение в одном разделе не меняет вид в другом.
 */
export function usePersistentLayout(storageKey: string, fallback: LayoutMode = "grid") {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved === "grid" || saved === "list") return saved
    } catch {
      // localStorage может быть недоступен — работаем без запоминания.
    }
    return fallback
  })

  const changeLayout = useCallback((mode: LayoutMode) => {
    setLayoutMode(mode)
    try {
      localStorage.setItem(storageKey, mode)
    } catch {
      // Запоминание не критично: вид всё равно уже применён.
    }
  }, [storageKey])

  return [layoutMode, changeLayout] as const
}
