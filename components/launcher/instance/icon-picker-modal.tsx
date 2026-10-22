import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCamera, IconUpload, IconX, IconCheck } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { BUILTIN_LOGOS, findBuiltinLogo } from "./builtin-logos"
import { EntityIcon } from "./entity-icon"

interface IconPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
  /** Заголовок и описание — по умолчанию для иконки сборки; категории передают свои. */
  title?: string
  description?: string
  /** Подпись кнопки снятия иконки. */
  removeLabel?: string
}

export function IconPickerModal({ open, onOpenChange, value, onChange, title, description, removeLabel }: IconPickerModalProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Своё состояние открытия: пикер закрывается сам после выбора и не «зависает»
  // открытым, даже если родитель не отреагировал на onOpenChange(false) —
  // например, когда пикер вложен в другой модал.
  const [selfOpen, setSelfOpen] = useState(open)

  useEffect(() => {
    setSelfOpen(open)
  }, [open])

  const isCustom = value && (value.startsWith("data:") || value.startsWith("http"))
  const builtinLogo = findBuiltinLogo(value)

  const close = () => {
    setSelfOpen(false)
    onOpenChange(false)
  }

  /** Выбор иконки сразу применяется и закрывает пикер — доводить его руками не нужно. */
  const select = (icon: string) => {
    onChange(icon)
    close()
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === "string") select(reader.result)
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  return (
    <Dialog open={selfOpen} onOpenChange={(next) => { setSelfOpen(next); onOpenChange(next) }}>
      <DialogContent data-window="instance-icon-picker-modal-window-1" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconCamera className="w-5 h-5 text-primary" />
            {title ?? t("builds.iconPicker", "Иконка сборки")}
          </DialogTitle>
          <DialogDescription>{description ?? t("builds.iconPickerDesc", "Выберите готовую иконку или загрузите свою")}</DialogDescription>
        </DialogHeader>

        <div data-ui="instance-icon-picker-modal-div-1" data-component="icon-picker-modal" className="space-y-4">
          <div data-ui="instance-icon-picker-modal-div-2" className="grid grid-cols-5 gap-2">
            {BUILTIN_LOGOS.map(logo => (
              <button data-ui="instance-icon-picker-modal-button-1" key={logo.id} type="button"
                title={t(logo.nameKey)}
                aria-label={t(logo.nameKey)}
                onClick={() => select(logo.src)}
                className={cn(
                  "relative flex w-full aspect-square items-center justify-center rounded-xl border-2 overflow-hidden transition-all hover:scale-105",
                  value === logo.src
                    ? "border-primary shadow-[0_0_12px_var(--primary)]"
                    : "border-border hover:border-primary/50",
                )}>
                <EntityIcon
                  src={logo.src}
                  className="w-full h-full p-1.5 text-primary"
                  imgClassName="w-full h-full object-contain p-1.5"
                />
                {value === logo.src && (
                  <div data-ui="instance-icon-picker-modal-div-3" className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <IconCheck className="w-5 h-5 text-primary" strokeWidth={3} />
                  </div>
                )}
              </button>
            ))}
          </div>

          <div data-ui="instance-icon-picker-modal-div-4" className="flex items-center gap-2">
            <div data-ui="instance-icon-picker-modal-div-5" className="flex-1 border-t border-border" />
            <span data-ui="instance-icon-picker-modal-span-1" className="text-xs text-muted-foreground">{t("builds.or", "или")}</span>
            <div data-ui="instance-icon-picker-modal-div-6" className="flex-1 border-t border-border" />
          </div>

          <div data-ui="instance-icon-picker-modal-div-7" className="flex gap-2">
            <button data-ui="instance-icon-picker-modal-button-2" type="button" onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-sm text-muted-foreground hover:text-foreground">
              <IconUpload className="w-4 h-4" />
              {t("builds.uploadCustom", "Загрузить своё")}
            </button>
            <input data-ui="instance-icon-picker-modal-input-1" ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

            {isCustom && (
              <button data-ui="instance-icon-picker-modal-button-3" type="button" onClick={() => select("")}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border hover:bg-destructive/10 hover:border-destructive/50 transition-colors text-sm text-muted-foreground hover:text-destructive">
                <IconX className="w-4 h-4" />
                {removeLabel ?? t("builds.remove", "Убрать")}
              </button>
            )}
          </div>

          {(isCustom || builtinLogo) && (
            <div data-ui="instance-icon-picker-modal-div-8" className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border">
              <div data-ui="instance-icon-picker-modal-div-9" className="w-12 h-12 rounded-lg overflow-hidden bg-background flex-shrink-0 flex items-center justify-center">
                <EntityIcon src={value} className="w-full h-full p-1 text-primary" imgClassName="w-full h-full object-contain" />
              </div>
              <div data-ui="instance-icon-picker-modal-div-10" className="flex-1 min-w-0">
                <p data-ui="instance-icon-picker-modal-p-1" className="text-sm font-medium truncate">
                  {builtinLogo ? t(builtinLogo.nameKey) : t("builds.customIcon", "Пользовательская иконка")}
                </p>
                <p data-ui="instance-icon-picker-modal-p-2" className="text-xs text-muted-foreground">
                  {isCustom ? "PNG / JPG / SVG" : t("builds.builtinIcon")}
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
