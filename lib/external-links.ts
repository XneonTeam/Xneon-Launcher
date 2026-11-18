/** Отделяет внешние ссылки от навигации по собственным views и якорям документа. */
export function browserLink(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base)
    const document = new URL(base)
    // В dev документ HTTP, но его якоря остаются внутренней навигацией.
    if (url.hash && url.origin === document.origin && url.pathname === document.pathname && url.search === document.search) return null
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null
  } catch { return null }
}

/** Native navigationRules — страховка, но не замена отмене клика до навигации WebView. */
export function installExternalLinks(target: Window, openExternal: (url: string) => Promise<void>): () => void {
  // WebView2 рисует собственный status bubble при наличии href. Не трогаем
  // настройки всего браузера: гостевая читалка новостей сохраняет обычные ссылки.
  // В UI адрес хранится отдельно, а role/tabindex/Enter сохраняют семантику link.
  const addressAttribute = "data-xneon-external-href"
  const originalAttributes = new WeakMap<Element, { role: string | null; tabIndex: string | null }>()
  const quietLink = (anchor: Element) => {
    const raw = anchor.getAttribute("href")
    if (raw === null || anchor.closest('[data-component="news-card"], [data-component="news-reader-modal"]')) return
    if (!browserLink(raw, target.location.href)) return
    if (!originalAttributes.has(anchor)) originalAttributes.set(anchor, { role: anchor.getAttribute("role"), tabIndex: anchor.getAttribute("tabindex") })
    anchor.setAttribute(addressAttribute, raw)
    anchor.removeAttribute("href")
    if (!anchor.hasAttribute("role")) anchor.setAttribute("role", "link")
    if (!anchor.hasAttribute("tabindex")) anchor.setAttribute("tabindex", "0")
  }
  const scan = (root: ParentNode & { matches?: (selector: string) => boolean }) => {
    if (root.matches?.("a[href]")) quietLink(root as Element)
    root.querySelectorAll?.("a[href]").forEach(quietLink)
  }
  scan(target.document)
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") quietLink(record.target as Element)
      else record.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node as Element) })
    }
  })
  observer?.observe(target.document, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] })
  const open = (url: string) => { void openExternal(url).catch(error => console.error("[External link]", error)) }
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return
    const element = event.target as (Element & { parentElement: Element | null }) | null
    const selector = `a[href], a[${addressAttribute}]`
    const anchor = element?.closest?.(selector) ?? element?.parentElement?.closest?.(selector)
    if (!anchor) return
    const url = browserLink(anchor.getAttribute("href") ?? anchor.getAttribute(addressAttribute) ?? "", target.location.href)
    if (!url) return
    event.preventDefault()
    // Ссылка принадлежит единому роутеру. Не даём React/SDK повторно открыть
    // её из собственного onClick после уже выполненного openExternal.
    event.stopImmediatePropagation()
    open(url)
  }
  // ModalLayer и Radix останавливают bubble внутри панели. Перехватываем
  // раньше, иначе стандартная навигация webview успевает открыть href.
  target.document.addEventListener("click", click, true)
  target.document.addEventListener("auxclick", click, true)
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== "Enter") return
    const element = event.target as Element | null
    const anchor = element?.closest?.(`a[${addressAttribute}]`) as HTMLElement | null
    if (!anchor) return
    event.preventDefault()
    anchor.click()
  }
  target.document.addEventListener("keydown", keydown, true)
  const previous = target.open
  const externalOpen: Window["open"] = (url, ...args) => {
    const external = url == null ? null : browserLink(String(url), target.location.href)
    if (external) { open(external); return null }
    return previous.call(target, url, ...args)
  }
  target.open = externalOpen
  return () => {
    observer?.disconnect()
    target.document.querySelectorAll?.(`a[${addressAttribute}]`).forEach(anchor => {
      const raw = anchor.getAttribute(addressAttribute)
      if (raw !== null && !anchor.hasAttribute("href")) anchor.setAttribute("href", raw)
      anchor.removeAttribute(addressAttribute)
      const original = originalAttributes.get(anchor)
      if (original) {
        if (original.role === null) anchor.removeAttribute("role")
        else anchor.setAttribute("role", original.role)
        if (original.tabIndex === null) anchor.removeAttribute("tabindex")
        else anchor.setAttribute("tabindex", original.tabIndex)
      }
    })
    target.document.removeEventListener("click", click, true)
    target.document.removeEventListener("auxclick", click, true)
    target.document.removeEventListener("keydown", keydown, true)
    if (target.open === externalOpen) target.open = previous
  }
}
