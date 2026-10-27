import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconPlus, IconChevronDown, IconCheck, IconShieldCheck, IconBolt, IconMessageCircle, IconSearch, IconRefresh, IconLoader2, IconSettings } from "@tabler/icons-react"
import type { AgentChat } from "@xnlc/types"
import { ComposerPopover } from "./composer-popover"
import { ModelIcon } from "../model-icon"
import { AttachmentMenu } from "./attachment-menu"
import { ContextIndicator } from "./context-indicator"
import { setAgentMode, useAgentState } from "./store"

interface ComposerControlsProps {
  mode: AgentChat["mode"]
  model: string
  disabled: boolean
  running: boolean
  onFile: () => void
  onModelChange: (model: string) => Promise<void>
  onConfigure: () => void
}

export function ComposerControls({ mode, model, disabled, running, onFile, onModelChange, onConfigure }: ComposerControlsProps) {
  const { t } = useTranslation()
  const enabledModels = useAgentState().config?.models
  const [popup, setPopup] = useState<"attach" | "mode" | "model" | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const attachAnchor = useRef<HTMLButtonElement>(null)
  const modeAnchor = useRef<HTMLButtonElement>(null)
  const modelAnchor = useRef<HTMLButtonElement>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  useEffect(() => { if (disabled || running) setPopup(null) }, [disabled, running])
  const close = () => setPopup(null)
  const loadModels = async () => {
    if (!window.electronAPI || loading) return
    const request = ++generation.current
    setLoading(true); setError("")
    try {
      const result = await window.electronAPI.getAiConfig().then(config => ({ success: true, models: (config.models || [{ id: config.model }]).map(item => item.id), error: "" }))
      if (request !== generation.current) return
      if (!result.success) throw new Error(result.error || t("ai.modelsError"))
      setModels([...new Set(result.models || [])])
    } catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (request === generation.current) setLoading(false) }
  }
  const toggle = (next: typeof popup) => {
    setPopup(popup === next ? null : next)
    if (next === "model" && popup !== "model") { setQuery(""); if (!models.length) void loadModels() }
  }
  const selectModel = async (value: string) => {
    const selected = value.trim()
    if (!selected || saving || selected.length > 200) return
    if (selected === model) { close(); return }
    const request = generation.current
    setSaving(true); setError("")
    try { await onModelChange(selected); if (request === generation.current) { setModels(items => items.includes(selected) ? items : [selected, ...items]); close(); modelAnchor.current?.focus() } }
    catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (request === generation.current) setSaving(false) }
  }
  const filteredModels = [...new Set((enabledModels ? enabledModels.map(item => item.id) : [model, ...models]).filter(Boolean))].filter(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <>
    <button ref={attachAnchor} type="button" className="agent-composer-add" disabled={disabled || saving} title={t("agent.attachTitle")} aria-label={t("agent.attachTitle")} aria-haspopup="dialog" aria-expanded={popup === "attach"} aria-controls={popup === "attach" ? "agent-attach-menu" : undefined} onClick={() => toggle("attach")}><IconPlus size={21} stroke={1.7} /></button>
    <button ref={modeAnchor} type="button" className="agent-composer-mode" disabled={disabled || running || saving} aria-label={t("agent.mode")} title={t("agent.mode")} aria-haspopup="dialog" aria-expanded={popup === "mode"} aria-controls={popup === "mode" ? "agent-mode-menu" : undefined} onClick={() => toggle("mode")}>{mode === "questions" ? <IconMessageCircle size={15} stroke={1.6} /> : mode === "auto" ? <IconBolt size={15} stroke={1.6} /> : <IconShieldCheck size={15} stroke={1.6} />}<span>{t(mode === "questions" ? "agent.modeQuestionsComposer" : mode === "auto" ? "agent.modeAutoComposer" : "agent.modeConfirmComposer")}</span></button>
    <span className="flex-1" />
    <ContextIndicator />
    <button ref={modelAnchor} type="button" className="agent-composer-model" disabled={disabled || running || saving} title={model || t("agent.selectModel")} aria-label={t("agent.selectModel")} aria-haspopup="dialog" aria-expanded={popup === "model"} aria-controls={popup === "model" ? "agent-model-menu" : undefined} onClick={() => toggle("model")}>{model && <ModelIcon model={model} className="size-3.5" />}<span>{model || t("agent.selectModel")}</span>{saving ? <IconLoader2 size={12} className="animate-spin" /> : <IconChevronDown size={12} />}</button>
    {popup === "attach" && <ComposerPopover anchor={attachAnchor} id="agent-attach-menu" label={t("agent.attachTitle")} onClose={close}><AttachmentMenu onClose={close} onFile={onFile} /></ComposerPopover>}
    {popup === "mode" && <ComposerPopover anchor={modeAnchor} id="agent-mode-menu" label={t("agent.mode")} onClose={close} width={310}>
      <div className="agent-popover-heading">{t("agent.mode")}</div><div role="radiogroup" aria-label={t("agent.mode")} className="agent-popover-options">{(["questions", "confirm", "auto"] as const).map(value => <button key={value} type="button" className="agent-menu-row agent-mode-option" role="radio" aria-checked={mode === value} onClick={() => { setAgentMode(value); close(); modeAnchor.current?.focus() }}>{value === "questions" ? <IconMessageCircle size={19} /> : value === "confirm" ? <IconShieldCheck size={19} /> : <IconBolt size={19} />}<span><strong>{t(value === "questions" ? "agent.modeQuestionsComposer" : value === "auto" ? "agent.modeAutoComposer" : "agent.modeConfirmComposer")}</strong><small>{t(value === "questions" ? "agent.modeQuestionsDescription" : value === "auto" ? "agent.modeAutoDescription" : "agent.modeConfirmDescription")}</small></span>{mode === value && <IconCheck size={16} className="text-primary" />}</button>)}</div>
    </ComposerPopover>}
    {popup === "model" && <ComposerPopover anchor={modelAnchor} id="agent-model-menu" label={t("agent.selectModel")} onClose={close} align="end" width={350}>
      <div className="agent-popover-heading"><span>{t("agent.selectModel")}</span><button type="button" className="agent-icon-button ml-auto" disabled={loading || saving} aria-label={t("ai.modelsReload")} title={t("ai.modelsReload")} onClick={() => void loadModels()}>{loading ? <IconLoader2 size={15} className="animate-spin" /> : <IconRefresh size={15} />}</button></div>
      <form className="agent-popover-search" onSubmit={event => { event.preventDefault(); if (filteredModels[0]) void selectModel(filteredModels.find(value => value === query.trim()) || filteredModels[0]) }}><IconSearch size={15} /><input data-autofocus type="search" value={query} maxLength={200} placeholder={t("ai.modelsSearch")} aria-label={t("ai.modelsSearch")} onChange={event => setQuery(event.target.value)} /></form>
      {error && <p className="agent-popover-error" role="alert">{error}</p>}
      <div className="agent-popover-list" role="radiogroup" aria-label={t("agent.selectModel")} aria-busy={loading || saving}>
        {loading && !models.length && <p className="agent-menu-empty">{t("ai.modelsLoading")}</p>}
        {filteredModels.map(value => <button type="button" key={value} className="agent-menu-row agent-model-option" role="radio" aria-checked={model === value} disabled={saving} title={value} onClick={() => void selectModel(value)}><ModelIcon model={value} className={`size-4 ${model === value ? "text-primary" : "text-muted-foreground"}`} /><span><strong>{value}</strong></span></button>)}
        {!loading && !filteredModels.length && <p className="agent-menu-empty">{t("ai.modelsEmpty")}</p>}

      </div>
      <button type="button" className="agent-popover-configure" onClick={() => { close(); onConfigure() }}><IconSettings size={15} />{t("agent.providerSettings")}</button>
    </ComposerPopover>}
  </>
}
