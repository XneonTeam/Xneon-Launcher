/** Страница готовится под заставкой, но её анимации ещё не должны проигрываться. */
export function prepareStartupReveal() {
  if (document.getElementById("splash")) document.documentElement.dataset.launcherReveal = "pending"
}

export function dismissStartupSplash(): Promise<void> {
  const splash = document.getElementById("splash")
  const reveal = () => {
    splash?.remove()
    delete document.documentElement.dataset.launcherReveal
    window.dispatchEvent(new Event("app:revealed"))
  }
  if (!splash) { reveal(); return Promise.resolve() }
  const startedAt = Number(splash.dataset.startedAt)
  const elapsed = Number.isFinite(startedAt) && splash.dataset.startedAt
    ? Math.max(0, performance.now() - startedAt) : 0
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  return new Promise(resolve => {
    const finish = () => { reveal(); resolve() }
    // Сохраняем время прорисовки логотипа; загрузка приложения идёт параллельно.
    window.setTimeout(() => {
      if (reducedMotion) { finish(); return }
      splash.style.transition = "opacity 180ms ease-out"
      splash.style.opacity = "0"
      window.setTimeout(finish, 180)
    }, reducedMotion ? 0 : Math.max(0, 2800 - elapsed))
  })
}
