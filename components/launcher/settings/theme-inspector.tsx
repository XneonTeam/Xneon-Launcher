import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"

/** Селектор исходного элемента сохраняется при перестановке соседних узлов. */
export function themeElementSelector(element: Element): string {
  const svg = element.closest("svg")
  if (svg) {
    const icon = [...svg.classList].find((name) =>
      (name.startsWith("tabler-icon-") || name.startsWith("icon-tabler-")) &&
      name !== "icon-tabler-outline" && name !== "icon-tabler-filled")
    if (icon) {
      const owner = svg.parentElement?.closest("[data-ui]")
      const scope = owner ? `[data-ui="${CSS.escape(owner.getAttribute("data-ui")!)}"] ` : ""
      return `${scope}svg.${CSS.escape(icon)}`
    }
  }
  const node = element.closest("[data-ui], [data-slot], [id], [data-component]") ?? element
  if (node.hasAttribute("data-ui")) return `[data-ui="${CSS.escape(node.getAttribute("data-ui")!)}"]`
  if (node.id) return `#${CSS.escape(node.id)}`
  for (const name of ["data-component", "data-slot"]) {
    const value = node.getAttribute(name)
    if (value) return `[${name}="${CSS.escape(value)}"]`
  }
  return node.localName
}

/** Инспектор доступен на любой странице, включая открытые портальные окна. */
export function ThemeInspector() {
  const { t } = useTranslation()
  const [active, setActive] = useState(false)
  const [selector, setSelector] = useState("")
  const [copied, setCopied] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const selected = useRef<Element | null>(null)

  useEffect(() => {
    const toggle = () => setActive((value) => !value)
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === "KeyC") {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("theme-inspector:toggle", toggle)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("theme-inspector:toggle", toggle)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const target = (event: MouseEvent) => {
      const node = event.target
      if (!(node instanceof Element) || node.closest("[data-theme-inspector]")) return null
      return node.closest("svg") ?? node
    }
    const move = (event: MouseEvent) => {
      if (!event.altKey) return
      const node = target(event)
      if (node) {
        selected.current = node
        setRect(node.getBoundingClientRect())
      }
    }
    const click = (event: MouseEvent) => {
      if (!event.altKey) return
      const node = target(event)
      if (!node) return
      event.preventDefault()
      event.stopImmediatePropagation()
      selected.current = node
      setRect(node.getBoundingClientRect())
      setSelector(themeElementSelector(node))
      setCopied(false)
    }
    const refresh = () => {
      const node = selected.current
      setRect(node?.isConnected ? node.getBoundingClientRect() : null)
    }
    // Останавливаем и pointerdown: некоторые меню открываются до события click.
    const pointer = (event: PointerEvent) => {
      if (event.altKey && target(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener("mousemove", move, true)
    window.addEventListener("click", click, true)
    window.addEventListener("pointerdown", pointer, true)
    window.addEventListener("scroll", refresh, true)
    window.addEventListener("resize", refresh)
    return () => {
      window.removeEventListener("mousemove", move, true)
      window.removeEventListener("click", click, true)
      window.removeEventListener("pointerdown", pointer, true)
      window.removeEventListener("scroll", refresh, true)
      window.removeEventListener("resize", refresh)
    }
  }, [active])

  if (!active) return null
  return createPortal(
    <div data-theme-inspector className="pointer-events-none fixed inset-0 z-[2147483647]">
      {rect && (
        <div className="fixed border-2 border-primary bg-primary/10"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
      )}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <strong>{t("themeInspector.title")}</strong>
          <button type="button" onClick={() => setActive(false)} className="rounded-md px-2 py-1 hover:bg-muted">{t("themeInspector.close")}</button>
        </div>
        <p className="text-muted-foreground">{t("themeInspector.hint")}</p>
        {selector && (
          <div className="flex items-center gap-2">
            <input aria-label={t("themeInspector.selector")} readOnly value={selector} onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono" />
            <button type="button" className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
              onClick={() => {
                void navigator.clipboard.writeText(selector).then(() => setCopied(true), () => setCopied(false))
              }}>{t(copied ? "themeInspector.copied" : "themeInspector.copy")}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
