import { useEffect, useState } from "react"
import type { Theme } from "./types"
import { applyTheme } from "./theme-model"

export function useAppliedTheme(initial: Theme): Theme {
  const [theme, setTheme] = useState(initial)
  useEffect(() => setTheme(initial), [initial])
  useEffect(() => {
    const listener = (event: Event) => setTheme((event as CustomEvent<Theme>).detail)
    window.addEventListener("theme:applied", listener)
    return () => window.removeEventListener("theme:applied", listener)
  }, [])
  return theme
}

export function cssBackgroundVideo(theme: Theme): string {
  if (theme.cssEnabled === false) return ""
  const source = theme.css?.match(/--custom-background-video\s*:\s*url\(\s*['"]?([^'"\)]+)['"]?\s*\)/i)?.[1]?.trim() ?? ""
  return /^(https?:|xnl-theme:|data:video\/)/i.test(source) ? source : ""
}

/** Приостанавливает фоновое видео, когда окно скрыто или запущена игра. */
export function useMediaPaused() {
  const [paused, setPaused] = useState(document.hidden)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void (window.electronAPI?.isMinecraftRunning() ?? Promise.resolve(false)).then((running) => {
        if (alive) setPaused(document.hidden || running)
      }).catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 2500)
    document.addEventListener("visibilitychange", refresh)
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [])
  return paused
}

export function ThemeRuntime({ theme: initial }: { theme: Theme }) {
  const theme = useAppliedTheme(initial)
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)")
    const update = () => { if (theme.appearance?.colorMode === "system") applyTheme(theme) }
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [theme])
  useEffect(() => {
    if (!theme.font?.source) return
    let alive = true
    const font = new FontFace("XneonThemeFont", `url(${JSON.stringify(theme.font.source)})`)
    void font.load().then((loaded) => { if (alive) document.fonts.add(loaded) }).catch(() => {})
    return () => { alive = false; document.fonts.delete(font) }
  }, [theme.font?.source])
  return null
}
