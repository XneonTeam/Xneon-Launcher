import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { agentContextUsage, useAgentState } from "./store"
import { ComposerPopover } from "./composer-popover"

export function ContextIndicator() {
  const { t, i18n } = useTranslation()
  const { chat, config } = useAgentState()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const contextWindow = config?.models?.find(item => item.id === config.model)?.contextWindow || 256_000
  const measured = chat?.contextUsage?.model === config?.model ? chat?.contextUsage : undefined
  const usage = useMemo(() => agentContextUsage(chat?.messages || [], chat?.draft, chat?.attachments, contextWindow, measured, config, chat?.toolGroups), [chat?.messages, chat?.draft, chat?.attachments, contextWindow, measured, config, i18n.language, chat?.toolGroups])
  const format = (value: number) => value.toLocaleString(i18n.language)
  const label = t("agent.context.label", { percent: usage.percent })
  return <>
    <button ref={anchor} type="button" className="agent-context-indicator" data-full={usage.full || undefined} aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "agent-context-info" : undefined} onClick={() => setOpen(value => !value)}>
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" className="agent-context-track" /><circle cx="10" cy="10" r="7" pathLength="100" strokeDasharray={`${usage.percent} 100`} transform="rotate(-90 10 10)" /></svg>
      <span>{usage.percent}%</span>
    </button>
    {open && <ComposerPopover anchor={anchor} id="agent-context-info" label={t("agent.context.title")} onClose={() => setOpen(false)} align="end" width={310}>
      <div className="agent-popover-heading">{t("agent.context.title")}<span className="ml-auto">{usage.percent}%</span></div>
      <div className="agent-context-info">
        <p>{t("agent.context.modelTokens", { used: `${usage.approximate ? "≈ " : ""}${format(usage.tokens)}`, limit: format(usage.contextWindow) })}</p>
        <div className="agent-context-bar" aria-hidden="true">{usage.breakdown.map(part => <span key={part.key} data-category={part.key} style={{ width: `${part.tokens / Math.max(usage.tokens, usage.contextWindow) * 100}%` }} />)}</div>
        <dl className="agent-context-breakdown">{usage.breakdown.map(part => <div key={part.key}><dt><span className="agent-context-swatch" data-category={part.key} />{t(`agent.context.parts.${part.key}`)}</dt><dd>≈ {format(part.tokens)}</dd></div>)}</dl>
        <small>{t("agent.context.breakdownHint")}</small>
        {usage.trimmed && <p>{t("agent.context.trimmed")}</p>}
        {usage.full && <p className="text-destructive">{t("agent.contextFull")}</p>}
      </div>
    </ComposerPopover>}
  </>
}
