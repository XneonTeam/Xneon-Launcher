import type { DetailedHTMLProps, HTMLAttributes } from "react"

/**
 * Типы для тега `<webview>` из Electron. В React-типах такого элемента нет,
 * поэтому дополняем JSX.IntrinsicElements (React 19 держит JSX внутри модуля react).
 *
 * Включён в главном окне через `webviewTag: true` — используется читалкой новостей.
 */
export type ElectronWebviewTagProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string
  partition?: string
  useragent?: string
  webpreferences?: string
  allowpopups?: boolean
  nodeintegration?: boolean
  disablewebsecurity?: boolean
}

/** Методы, которые Electron добавляет самому DOM-элементу `<webview>`. */
export type ElectronWebviewElement = HTMLElement & {
  insertCSS(css: string): Promise<string>
  removeInsertedCSS(key: string): Promise<void>
  executeJavaScript(code: string): Promise<unknown>
  loadURL(url: string): Promise<void>
  getURL(): string
  isLoading(): boolean
  reload(): void
  stop(): void
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: ElectronWebviewTagProps
    }
  }
}
