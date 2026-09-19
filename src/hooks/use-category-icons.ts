import { useCallback, useEffect, useRef, useState } from "react"

/** Иконка категории: имя категории → src (встроенный логотип или data URL). */
export type CategoryIconMap = Record<string, string>

/** Разделы, у которых категории независимы. */
export type CategoryIconScope = "servers" | "builds"

const SETTINGS_KEY: Record<CategoryIconScope, string> = {
  servers: "category_icons_servers",
  builds: "category_icons_builds",
}

/**
 * Иконки категорий: категория у нас не отдельная сущность, а строковое поле
 * (`group`) у серверов и сборок, поэтому иконка хранится рядом — картой
 * «имя категории → src» в общем сторе настроек (`settings:get/set`), как
 * `servers_favorites`. Отдельные ключи на раздел, чтобы сервера и сборки
 * не делили одно имя категории.
 */
export function useCategoryIcons(scope: CategoryIconScope) {
  const key = SETTINGS_KEY[scope]
  const [icons, setIcons] = useState<CategoryIconMap>({})
  // Зеркало состояния: правки должны считаться от актуальной карты и записываться
  // наружу (в стор), а не внутри updater'а setState — иначе в StrictMode запись
  // может уехать дважды.
  const iconsRef = useRef<CategoryIconMap>({})

  useEffect(() => {
    let alive = true
    iconsRef.current = {}
    setIcons({})
    void window.electronAPI?.getSetting(key).then((raw) => {
      if (!alive || !raw) return
      try {
        const parsed = JSON.parse(raw) as CategoryIconMap
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          iconsRef.current = parsed
          setIcons(parsed)
        }
      } catch {
        // Повреждённый JSON не должен ломать раздел — просто начинаем с пустой карты.
      }
    })
    return () => { alive = false }
  }, [key])

  const apply = useCallback((mutate: (prev: CategoryIconMap) => CategoryIconMap) => {
    const next = mutate(iconsRef.current)
    iconsRef.current = next
    setIcons(next)
    void window.electronAPI?.setSetting(key, JSON.stringify(next))
  }, [key])

  /** Ставит иконку категории; пустая строка — убирает иконку. */
  const setCategoryIcon = useCallback((group: string, icon: string) => {
    const name = group.trim()
    if (!name) return
    apply((prev) => {
      const next = { ...prev }
      if (icon) next[name] = icon
      else delete next[name]
      return next
    })
  }, [apply])

  /** Переносит иконку на новое имя вместе с переименованием категории. */
  const renameCategoryIcon = useCallback((oldName: string, newName: string) => {
    const from = oldName.trim()
    const to = newName.trim()
    if (!from || !to || from === to) return
    apply((prev) => {
      if (!(from in prev)) return prev
      const next = { ...prev }
      next[to] = next[from]
      delete next[from]
      return next
    })
  }, [apply])

  /** Убирает иконку удалённой категории. */
  const dropCategoryIcon = useCallback((group: string) => {
    const name = group.trim()
    if (!name) return
    apply((prev) => {
      if (!(name in prev)) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }, [apply])

  return { categoryIcons: icons, setCategoryIcon, renameCategoryIcon, dropCategoryIcon }
}
