import { createElement, lazy, type ComponentType, type ComponentProps } from "react"
import type { PageLoader } from "@/lib/page-loader"

/** Готовый prefetch не проходит через первый Suspense и его задержку fallback. */
export function preloadedPage<T extends ComponentType<any>>(load: PageLoader<{ default: T }>) {
  const LazyPage = lazy(load)
  return function PreloadedPage(props: ComponentProps<T>) {
    const ready = load.peek()
    return ready ? createElement(ready.default, props) : createElement(LazyPage, props)
  }
}
