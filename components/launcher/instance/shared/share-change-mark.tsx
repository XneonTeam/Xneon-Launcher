import { IconMinus, IconPlus, IconRefresh } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import type { DiffEntry } from "@xnlc/share"

export const shareChangeColor = (type: DiffEntry["type"]) => type === "added" ? "text-green-500" : type === "removed" ? "text-red-500" : "text-muted-foreground"

export function ShareChangeMark({ type }: { type: DiffEntry["type"] }) {
  const { t } = useTranslation()
  const Icon = type === "added" ? IconPlus : type === "removed" ? IconMinus : IconRefresh
  return <Icon role="img" aria-label={t(`share.diff.${type}`)} className={`h-4 w-4 shrink-0 ${shareChangeColor(type)}`} strokeWidth={2} />
}
