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
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  return new Promise(resolve => {
    const finish = () => { reveal(); resolve() }
    // Готовый интерфейс не ждёт конца декоративного рисования логотипа.
    if (reducedMotion) { finish(); return }
    splash.style.transition = "opacity 180ms ease-out"
    splash.style.opacity = "0"
    window.setTimeout(finish, 180)
  })
}
