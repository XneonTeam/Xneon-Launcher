/** Отделяет внешние ссылки от навигации по собственным views и якорям документа. */
export function browserLink(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base)
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null
  } catch { return null }
}

/** Native navigationRules — страховка, но не замена отмене клика до навигации WebView. */
export function installExternalLinks(target: Window, openExternal: (url: string) => Promise<void>): () => void {
  const open = (url: string) => { void openExternal(url).catch(error => console.error("[External link]", error)) }
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return
    const anchor = (event.target as Element | null)?.closest?.("a[href]")
    if (!anchor) return
    const url = browserLink(anchor.getAttribute("href") ?? "", target.location.href)
    if (!url) return
    event.preventDefault()
    open(url)
  }
  target.document.addEventListener("click", click)
  target.document.addEventListener("auxclick", click)
  const previous = target.open
  const externalOpen: Window["open"] = (url, ...args) => {
    const external = url == null ? null : browserLink(String(url), target.location.href)
    if (external) { open(external); return null }
    return previous.call(target, url, ...args)
  }
  target.open = externalOpen
  return () => {
    target.document.removeEventListener("click", click)
    target.document.removeEventListener("auxclick", click)
    if (target.open === externalOpen) target.open = previous
  }
}
