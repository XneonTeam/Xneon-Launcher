import { useCallback, useEffect, useRef, useState } from "react"

/** Разделы, у которых категории независимы. */
export type CategoryListScope = "servers" | "builds"

const SETTINGS_KEY: Record<CategoryListScope, string> = {
  servers: "category_list_servers",
  builds: "category_list_builds",
}

/**
 * Категории, созданные вручную и пока пустые. Обычные категории у нас не сущность,
 * а строковое поле `group` у серверов и сборок — то есть категория без вещей
 * существовать не могла: создал, а она исчезла. Здесь хранится список имён,
 * который раздел объединяет со своими группами. Отдельный ключ на раздел.
 */
export function useCategoryList(scope: CategoryListScope) {
  const key = SETTINGS_KEY[scope]
  const [names, setNames] = useState<string[]>([])
  // Зеркало состояния: считаем от актуального списка и пишем в стор вне updater'а.
  const namesRef = useRef<string[]>([])

  useEffect(() => {
    let alive = true
    namesRef.current = []
    setNames([])
    void window.electronAPI?.getSetting(key).then((raw) => {
      if (!alive || !raw) return
      try {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
          namesRef.current = clean
          setNames(clean)
        }
      } catch {
        // Повреждённый JSON не должен ломать раздел — начинаем с пустого списка.
      }
    })
    return () => { alive = false }
  }, [key])

  const apply = useCallback((mutate: (prev: string[]) => string[]) => {
    const next = mutate(namesRef.current)
    namesRef.current = next
    setNames(next)
    void window.electronAPI?.setSetting(key, JSON.stringify(next))
  }, [key])

  /** Создаёт категорию. Никаких вещей не трогает — перемещение выбирает пользователь. */
  const addCategory = useCallback((name: string) => {
    const value = name.trim()
    if (!value) return
    apply((prev) => (prev.includes(value) ? prev : [...prev, value]))
  }, [apply])

  /** Переносит имя вместе с переименованием категории. */
  const renameCategory = useCallback((oldName: string, newName: string) => {
    const from = oldName.trim()
    const to = newName.trim()
    if (!from || !to || from === to) return
    apply((prev) => {
      if (!prev.includes(from)) return prev
      const next = prev.map(n => (n === from ? to : n))
      return Array.from(new Set(next))
    })
  }, [apply])

  /** Убирает имя удалённой категории. */
  const dropCategory = useCallback((name: string) => {
    const value = name.trim()
    if (!value) return
    apply((prev) => (prev.includes(value) ? prev.filter(n => n !== value) : prev))
  }, [apply])

  return { declaredCategories: names, addCategory, renameCategory, dropCategory }
}
