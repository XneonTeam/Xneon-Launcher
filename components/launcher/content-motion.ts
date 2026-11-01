import { useEffect, useState } from "react"
import { SETTINGS_CONTENT_ENTER, SETTINGS_CONTENT_ENTER_DELAYED } from "./settings/settings-motion"

// Все разделы используют те же кадры и параметры, что и вкладки настроек.
export const CONTENT_ENTER = SETTINGS_CONTENT_ENTER
export const CONTENT_ENTER_DELAYED = SETTINGS_CONTENT_ENTER_DELAYED

/** Анимация начинается при появлении контейнера и не зависит от загрузки данных. */
export function useContentEnter(_ready: boolean) {
  return CONTENT_ENTER
}

/** Для разделов, где анимация должна начинаться после первой загрузки данных. */
export function useContentEnterAfterLoad(ready: boolean) {
  const [entered, setEntered] = useState(ready)
  useEffect(() => {
    if (ready) setEntered(true)
  }, [ready])
  return entered || ready ? CONTENT_ENTER : undefined
}
