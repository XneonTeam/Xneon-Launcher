import { useTranslation } from "react-i18next"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export function ShareRoleSelect({ value, onValueChange, disabled, label, className }: {
  value: "editor" | "viewer"
  onValueChange(value: "editor" | "viewer"): void
  disabled?: boolean
  label: string
  className?: string
}) {
  const { t } = useTranslation()
  return <Select value={value} disabled={disabled} onValueChange={value => {
    if (value === "editor" || value === "viewer") onValueChange(value)
  }}>
    <SelectTrigger aria-label={label} className={cn("w-full rounded-xl border-border bg-muted/40", className)}><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="viewer">{t("share.roles.viewer")}</SelectItem>
      <SelectItem value="editor">{t("share.roles.editor")}</SelectItem>
    </SelectContent>
  </Select>
}
