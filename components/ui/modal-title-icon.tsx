import type { ReactNode } from "react"

export function ModalTitleIcon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
      {children}
    </span>
  )
}
