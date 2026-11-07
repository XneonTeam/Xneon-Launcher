import type { ButtonHTMLAttributes } from "react"
import { IconX } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

export function ModalCloseButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useTranslation()
  return <button type="button" aria-label={t("common.close")} data-modal-close {...props}><IconX aria-hidden="true" strokeWidth={1.75} /></button>
}
