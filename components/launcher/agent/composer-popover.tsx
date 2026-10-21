import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

interface ComposerPopoverProps {
  anchor: RefObject<HTMLButtonElement | null>
  label: string
  children: ReactNode
  onClose: () => void
  align?: "start" | "end"
  width?: number
  id: string
}

/** Портал не обрезается границами чата; меню остаётся привязанным к кнопке. */
export function ComposerPopover({ anchor, label, children, onClose, align = "start", width = 326, id }: ComposerPopoverProps) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const [position, setPosition] = useState({ left: 0, bottom: 0, width, maxHeight: 440 })
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const actualWidth = Math.min(width, window.innerWidth - 24)
      const left = Math.max(12, Math.min(align === "end" ? rect.right - actualWidth : rect.left, window.innerWidth - actualWidth - 12))
      setPosition({ left, bottom: window.innerHeight - rect.top + 10, width: actualWidth, maxHeight: Math.max(160, Math.min(500, rect.top - 24)) })
    }
    place()
    window.addEventListener("resize", place)
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) place() }
    window.addEventListener("scroll", scroll, true)
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", scroll, true) }
  }, [anchor, align, width])
  useEffect(() => {
    const initial = panel.current?.querySelector<HTMLElement>("[data-autofocus], [aria-checked=true], button:not(:disabled), input")
    initial?.focus()
    const nestedSelectOpen = () => [...document.querySelectorAll<HTMLElement>("[data-agent-composer-owner]")].some(element => element.dataset.agentComposerOwner === id && element.dataset.state === "open")
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-agent-composer-owner]")?.getAttribute("data-agent-composer-owner") === id) return
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) close.current()
    }
    const keyboard = (event: KeyboardEvent) => {
      // Клавиатуру вложенного Select обрабатывает Radix, включая Escape.
      if (nestedSelectOpen()) return
      if (event.key !== "Escape" && document.activeElement?.closest('[data-slot="select-trigger"]')) return
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); anchor.current?.focus(); return }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !panel.current?.contains(document.activeElement)) return
      if (document.activeElement instanceof HTMLInputElement && ["Home", "End"].includes(event.key)) return
      const items = [...panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter(item => item.getClientRects().length)
      if (!items.length) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
      event.preventDefault(); items[next].focus()
    }
    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("keydown", keyboard, true)
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", keyboard, true) }
  }, [anchor, id])
  return createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} className="agent-composer-popover" style={{ position: "fixed", ...position }}>{children}</div>, document.body)
}
