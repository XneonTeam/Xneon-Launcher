import { Component, type ReactNode } from "react"
import { IconAlertTriangle } from "@tabler/icons-react"

type Props = { children: ReactNode; fallback?: ReactNode }
type State = { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <IconAlertTriangle className="w-10 h-10 text-destructive mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">Произошла ошибка</p>
          <p className="text-xs text-muted-foreground mb-3">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Попробовать снова
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
