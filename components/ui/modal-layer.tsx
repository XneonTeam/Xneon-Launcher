import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type ModalLayerProps = {
  onClose: () => void
  className?: string
  children: ReactNode
}

/** Фон модалки: закрывает по клику и по Esc; клик внутри панели — нет. */
export function ModalLayer({ onClose, className, children }: ModalLayerProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Вложенный Radix-диалог гасит Esc сам — не закрываем и внешний слой.
      if (event.key === "Escape" && !event.defaultPrevented) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      // Затемнение задано здесь, а не у каждого вызова: иначе модалки без своего
      // `bg-*` (аккаунты, миры, серверы) открывались поверх яркого интерфейса.
      // Свой фон можно передать через className — он перекроет значение по умолчанию.
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/50", className)}
      onClick={onClose}
    >
      <div className="contents" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
