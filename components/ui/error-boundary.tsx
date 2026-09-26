import { Component, type ReactNode } from "react"
import { IconAlertTriangle, IconReload } from "@tabler/icons-react"
import i18n from "@/src/i18n"

type Props = {
  children: ReactNode
  /**
   * Ключ сброса: при его изменении ошибка забывается. Нужен, чтобы сбой одной
   * вкладки не «залипал» при переходе на другую (передаём id активной вкладки).
   */
  resetKey?: string | number
  /** Подпись для логов — какая именно область упала. */
  label?: string
}

type State = { hasError: boolean; error: Error | null }

/**
 * Граница ошибок для страниц и крупных блоков.
 *
 * Без неё исключение в рендере размонтирует всё дерево React, и пользователь
 * видит пустой (чёрный) экран без каких-либо объяснений — именно так выглядел
 * сбой на странице сборок. Здесь ошибка локализуется: интерфейс остаётся
 * живым, показано сообщение и кнопка для повтора либо перезагрузки окна.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidUpdate(prevProps: Props) {
    // Перешли на другую вкладку (или сменили область) — даём рендеру новый шанс.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
        <IconAlertTriangle className="h-10 w-10 text-destructive" strokeWidth={1.5} />
        <p className="text-sm font-medium text-foreground">
          {i18n.t("common.errorTitle", "Что-то пошло не так")}
        </p>
        <p className="max-w-md text-xs text-muted-foreground break-words">
          {this.state.error?.message || i18n.t("common.errorUnknown", "Неизвестная ошибка")}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {i18n.t("common.retry", "Попробовать снова")}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconReload className="h-3.5 w-3.5" strokeWidth={1.75} />
            {i18n.t("common.reloadWindow", "Перезагрузить")}
          </button>
        </div>
      </div>
    )
  }
}