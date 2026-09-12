import { useCallback, useState } from "react"
import { ActionConfirmDialog } from "@/components/launcher/instance/action-confirm-dialog"

export interface AlertDialogOptions {
  /** Заголовок окна. По умолчанию выводится из тона сообщения. */
  title?: string
  /** Тон окна: ошибка (красный) или информация/успех (синий). */
  variant?: "danger" | "info"
}

interface AlertDialogState {
  title: string
  message: string
  variant: "danger" | "info"
}

/**
 * Замена нативному `alert()`: возвращает функцию показа сообщения и готовый
 * модальный диалог, который нужно отрендерить в разметке компонента.
 *
 * Использование:
 *   const { showAlert, alertDialog } = useAlertDialog()
 *   showAlert("Не удалось сохранить мир")
 *   return <>{...}{alertDialog}</>
 */
export function useAlertDialog() {
  const [state, setState] = useState<AlertDialogState | null>(null)

  const showAlert = useCallback((message: string, options?: AlertDialogOptions) => {
    const text = (message ?? "").toString().trim()
    if (!text) return
    const variant = options?.variant ?? "danger"
    setState({
      title: options?.title ?? (variant === "danger" ? "Ошибка" : "Готово"),
      message: text,
      variant,
    })
  }, [])

  const closeAlert = useCallback(() => setState(null), [])

  const alertDialog = (
    <ActionConfirmDialog
      open={state !== null}
      onClose={closeAlert}
      title={state?.title ?? ""}
      description={state?.message ?? ""}
      type="alert"
      variant={state?.variant ?? "danger"}
      icon={state?.variant === "info" ? "info" : "warning"}
      confirmText="Понятно"
    />
  )

  return { showAlert, closeAlert, alertDialog }
}
