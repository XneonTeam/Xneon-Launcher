import { useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowUp, IconLoader2 } from "@tabler/icons-react"

export function ShareCommentComposer({ value, onChange, onSend, busy }: { value: string; onChange(value: string): void; onSend(): Promise<void>; busy: boolean }) {
  const { t } = useTranslation()
  const textarea = useRef<HTMLTextAreaElement>(null), sending = useRef(false)
  const [pending, setPending] = useState(false)
  const disabled = busy || pending
  useLayoutEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = "auto"
    textarea.current.style.height = `${Math.min(160, Math.max(48, textarea.current.scrollHeight))}px`
  }, [value])
  async function send() {
    if (disabled || sending.current || !value.trim()) return
    sending.current = true; setPending(true)
    try { await onSend() } finally { sending.current = false; setPending(false); textarea.current?.focus() }
  }
  return <form onSubmit={event => { event.preventDefault(); void send() }} className="rounded-3xl border border-border/65 bg-[color-mix(in_oklab,var(--muted)_22%,var(--card))] shadow-[0_8px_30px_#00000008] transition-colors focus-within:border-primary/45">
    <textarea ref={textarea} rows={1} aria-label={t("share.comment")} placeholder={t("share.comment")} className="block max-h-40 min-h-12 w-full resize-none overflow-y-auto bg-transparent px-4 pb-2 pt-3.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50" value={value} onChange={event => onChange(event.target.value)} disabled={disabled} maxLength={8000} onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
    }} />
    <div className="flex min-h-11 items-center justify-end gap-2 px-2.5 pb-2.5 pt-1">
      <button type="submit" disabled={disabled || !value.trim()} aria-label={t("share.addComment")} title={t("share.addComment")} className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40">
        {disabled ? <IconLoader2 className="h-[18px] w-[18px] animate-spin" /> : <IconArrowUp className="h-[19px] w-[19px]" strokeWidth={2.5} />}
      </button>
    </div>
  </form>
}
