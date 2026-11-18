import type { DetailedHTMLProps, HTMLAttributes } from "react"

/**
 * Типы для тега `<electrobun-webview>` — аналога Electron `<webview>`.
 *
 * Тег регистрирует полный preload Electrobun (`initWebviewTag()`), поэтому в
 * React-типах его нет: дополняем JSX.IntrinsicElements (React 19 держит JSX
 * внутри модуля react). Каждый тег — отдельный гостевой webview (OOPIF) поверх
 * окна; атрибуты `transparent`/`passthrough` нужны, чтобы React-оверлей
 * загрузки был виден и кликабелен, пока страница ещё не отрисована.
 */
export type ElectrobunWebviewTagProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string
  html?: string
  preload?: string
  partition?: string
  renderer?: "native" | "cef"
  /** Getter-only у SDK: устанавливать атрибутом через ref, не React-prop. */
  sandbox?: never
  /** Начальный атрибут через ref: native читает его через hasAttribute. */
  transparent?: never
  /** Начальный атрибут через ref: клики проходят в DOM лаунчера во время загрузки. */
  passthrough?: never
  spellcheck?: boolean
  "navigation-rules"?: string
}

export type ElectrobunWebviewEvent =
  | "will-navigate"
  | "did-navigate"
  | "did-navigate-in-page"
  | "did-commit-navigation"
  | "dom-ready"
  | "new-window-open"
  | "host-message"
  | "download-started"
  | "download-progress"
  | "download-completed"
  | "download-failed"
  | "load-started"
  | "load-committed"
  | "load-finished"

/** Методы, которые Electrobun добавляет самому DOM-элементу `<electrobun-webview>`. */
export type ElectrobunWebviewElement = HTMLElement & {
  /** Готов только после инициализации в native; `null` — тег ещё не подключён. */
  readonly webviewId: number | null
  readonly sandbox: boolean
  /** Lifecycle SDK: адаптер читалки страхует закрытие до завершения native init. */
  initWebview(): Promise<void>
  disconnectedCallback(): void
  loadURL(url: string): void
  loadHTML(html: string): void
  reload(): void
  goBack(): void
  goForward(): void
  executeJavascript(code: string): void
  setNavigationRules(rules: string[]): void
  toggleTransparent(value?: boolean): void
  togglePassthrough(value?: boolean): void
  toggleHidden(value?: boolean): void
  on(event: ElectrobunWebviewEvent, listener: (event: CustomEvent) => void): void
  off(event: ElectrobunWebviewEvent, listener: (event: CustomEvent) => void): void
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "electrobun-webview": ElectrobunWebviewTagProps
    }
  }
}
