import { useTranslation } from "react-i18next"
import { IconRotateClockwise } from "@tabler/icons-react"

interface InstanceTrashToastProps {
  /** Имя сборки, которая только что ушла в корзину. */
  name: string
  onUndo: () => void
}

/**
 * Плашка «сборка в корзине» с кнопкой отмены. Показывается и при удалении из
 * списка сборок, и при удалении с самой страницы сборки — поведение одинаковое.
 */
export function InstanceTrashToast({ name, onUndo }: InstanceTrashToastProps) {
  const { t } = useTranslation()

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 shadow-2xl">
      <p className="text-sm text-foreground">{t("instanceList.trashed", { name })}</p>
      <button type="button" onClick={onUndo} className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
        <IconRotateClockwise className="w-3.5 h-3.5" />
        {t("instanceList.undo")}
      </button>
    </div>
  )
}
