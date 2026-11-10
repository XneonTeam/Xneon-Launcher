import { ModelIcon } from "../model-icon"
import { SETTINGS_CONTENT_ENTER } from "./settings-motion"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { IconCpu, IconCheck, IconPlayerPlay, IconKey, IconWorld, IconLoader2, IconAlertTriangle, IconSearch, IconRefresh, IconPlus, IconTrash, IconPhoto, IconApi, IconExternalLink } from "@tabler/icons-react"
import type { AiConfigUpdate, AiModelConfig, AiProtocol } from "@xnlc/types"
import { SettingsAiMcp } from "./settings-ai-mcp"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import codexSaleLogo from "@/assets/ai-providers/codex-sale.svg"
import anthropicLogo from "@/assets/ai-providers/anthropic.svg"
import geminiLogo from "@/assets/ai-providers/googlegemini.svg"
import ollamaLogo from "@/assets/ai-providers/ollama.svg"

const endpoints: Record<AiProtocol, string> = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta", ollama: "http://localhost:11434" }
const protocols: Record<AiProtocol, string> = { openai: "OpenAI compatible", anthropic: "Anthropic Messages", gemini: "Google Gemini", ollama: "Ollama" }
const protocolLogos: Partial<Record<AiProtocol, string>> = { anthropic: anthropicLogo, gemini: geminiLogo, ollama: ollamaLogo }
const defaultModel = (id: string): AiModelConfig => ({ id, contextWindow: 256_000, supportsImages: false })
const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
const aiKeyScope = (config: AiConfigUpdate) => `${config.protocol || "openai"} ${config.endpoint.trim().replace(/\/+$/, "")}`
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"

export function SettingsAi() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AiConfigUpdate>({ endpoint: endpoints.openai, protocol: "openai", model: "gpt-4o-mini", models: [defaultModel("gpt-4o-mini")] })
  const [savedKeyScope, setSavedKeyScope] = useState<string | null>(null)
  const keyScope = aiKeyScope(config)
  const hasApiKey = savedKeyScope === keyScope
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const dirty = useRef(false)
  const saveQueue = useRef(Promise.resolve())
  const [error, setError] = useState("")
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [contextWindows, setContextWindows] = useState<Record<string, number>>({})
  const [catalog, setCatalog] = useState<string[]>([])
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState("")
  const [query, setQuery] = useState("")
  const [customModel, setCustomModel] = useState("")
  const generation = useRef(0)
  useEffect(() => {
    let cancelled = false
    window.electrobunAPI?.getAiConfig().then(({ hasApiKey, ...value }) => { if (!cancelled) { setSavedKeyScope(hasApiKey ? aiKeyScope(value) : null); setConfig({ ...value, protocol: value.protocol || "openai", models: value.models || [defaultModel(value.model)] }) } }).catch(error => { if (!cancelled) setError(String(error)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; generation.current++ }
  }, [])
  const update = (value: Partial<AiConfigUpdate>) => { dirty.current = true; setConfig(current => ({ ...current, ...value })); setTestResults({}) }
  const models = config.models || []
  const updateModel = (id: string, patch: Partial<AiModelConfig>) => update({ models: models.map(item => item.id === id ? { ...item, ...patch } : item) })
  const toggleModel = (id: string) => {
    const next = models.some(item => item.id === id) ? models.filter(item => item.id !== id) : [...models, { ...defaultModel(id), contextWindow: contextWindows[id] ?? 256_000 }]
    update({ models: next, model: next.some(item => item.id === config.model) ? config.model : next[0]?.id || "" })
  }
  const invalidateCatalog = () => { generation.current++; setCatalog([]); setContextWindows({}); setCatalogError(""); setCatalogLoading(false) }
  const discover = async () => {
    const api = window.electrobunAPI
    if (!api) return
    const request = ++generation.current
    setCatalogLoading(true); setCatalogError("")
    try {
      const result = await api.listAiModels({ apiKey: config.apiKey, endpoint: config.endpoint, protocol: config.protocol })
      if (request !== generation.current) return
      if (!result.success) throw new Error(result.error || t("ai.modelsError"))
      setCatalog(result.models || []); setContextWindows(result.contextWindows || {})
    } catch (error) { if (request === generation.current) setCatalogError(error instanceof Error ? error.message : String(error)) }
    finally { if (request === generation.current) setCatalogLoading(false) }
  }
  const save = async () => {
    const api = window.electrobunAPI
    if (!api) return false
    if (!models.length || !models.some(item => item.id === config.model) || models.some(item => !Number.isInteger(item.contextWindow) || item.contextWindow < 8192 || item.contextWindow > 4_000_000)) { setError(""); return false }
    setSaving(true); setError("")
    try {
      const pending = saveQueue.current.catch(() => {}).then(() => api.saveAiConfig(config))
      saveQueue.current = pending
      await pending
      setSavedKeyScope(previous => config.apiKey === undefined
        ? previous === keyScope ? previous : null
        : config.apiKey.trim() ? keyScope : null)
      if (config.apiKey !== undefined) setConfig(current => current === config ? { ...current, apiKey: undefined } : current)
      window.dispatchEvent(new Event("agent:config-updated"))
      return true
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false }
    finally { setSaving(false) }
  }
  useEffect(() => {
    if (loading || !dirty.current) return
    const timer = setTimeout(() => { void save() }, 400)
    return () => clearTimeout(timer)
  }, [config, loading])
  const test = async (model: string) => {
    setTesting(model)
    setTestResults(current => ({ ...current, [model]: "" }))
    try {
      if (!await save()) return
      const result = await window.electrobunAPI!.analyzeCrash("Connection test. Reply OK.", model)
      if (!result.success) throw new Error(result.error || t("ai.modelsError"))
      setTestResults(current => ({ ...current, [model]: t("ai.library.connected") }))
    } catch (error) { setTestResults(current => ({ ...current, [model]: error instanceof Error ? error.message : String(error) })) }
    finally { setTesting(null) }
  }
  const filtered = useMemo(() => catalog.filter(id => id.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [catalog, query])
  if (loading) return <div className="flex justify-center p-12"><IconLoader2 className="animate-spin text-primary" /></div>
  return <div data-component="settings-ai" className={`space-y-5 ${SETTINGS_CONTENT_ENTER}`}>
    <aside className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5"><span aria-hidden="true" className="size-7 shrink-0 bg-primary" style={{ mask: `url("${codexSaleLogo}") center / contain no-repeat`, WebkitMask: `url("${codexSaleLogo}") center / contain no-repeat` }} /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{t("ai.promo.title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("ai.promo.desc")}</p></div><button type="button" className={buttonClass} onClick={() => void window.electrobunAPI?.openExternal("https://codex.sale/register?ref=stepangavrilov736")}>{t("ai.promo.cta")}<IconExternalLink size={14} /></button></aside>
    <section data-settings-tone="blue" className="settings-color-panel space-y-4 rounded-2xl border border-border p-4">
      <label className="block space-y-2"><span className="flex items-center gap-2 text-sm font-medium"><IconApi size={16} className="text-primary" />{t("ai.library.protocol")}</span>
        <Select value={config.protocol} onValueChange={value => { invalidateCatalog(); update({ protocol: value as AiProtocol, endpoint: endpoints[value as AiProtocol], apiKey: undefined, models: [], model: "" }) }}>
          <SelectTrigger className="w-full rounded-xl border-border bg-background text-foreground dark:bg-background dark:hover:bg-muted"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(protocols) as AiProtocol[]).map(protocol => {
              const logo = protocolLogos[protocol]
              const label = protocol === "openai" ? t("ai.library.compatible") : protocols[protocol]
              return (
                <SelectItem key={protocol} value={protocol} textValue={label}>
                  {logo ? (
                    <span aria-hidden="true" className="inline-block size-4 shrink-0 bg-current" style={{
                      mask: `url("${logo}") center / contain no-repeat`,
                      WebkitMask: `url("${logo}") center / contain no-repeat`,
                    }} />
                  ) : <IconApi className="size-4 text-current" strokeWidth={1.75} aria-hidden="true" />}
                  <span>{label}</span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-2"><span className="flex items-center gap-2 text-sm font-medium"><IconWorld size={16} className="text-primary" />{t("ai.endpoint")}</span><input className={inputClass} value={config.endpoint} onChange={event => { invalidateCatalog(); update({ endpoint: event.target.value, apiKey: undefined }) }} placeholder={endpoints[config.protocol || "openai"]} /></label>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("ai.library.endpointHint")}</p>
      <label className="block space-y-2"><span className="flex items-center gap-2 text-sm font-medium"><IconKey size={16} className="text-primary" />{t("ai.apiKey")}</span><input type="password" autoComplete="off" className={inputClass} value={config.apiKey ?? ""} onChange={event => { invalidateCatalog(); update({ apiKey: event.target.value }) }} placeholder={hasApiKey ? "••••••••" : t("ai.apiKeyPlaceholder")} /></label>
      {hasApiKey && <button type="button" className={buttonClass} onClick={() => { invalidateCatalog(); update({ apiKey: "" }) }}><IconTrash size={14} />{t("ai.clearApiKey")}</button>}
    </section>
    <section data-settings-tone="violet" className="settings-color-panel space-y-4 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-semibold"><IconCpu size={16} className="text-primary" aria-hidden="true" />{t("ai.library.title")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("ai.library.description")}</p></div><button type="button" className={buttonClass} onClick={() => { setCatalogOpen(true); if (!catalog.length) void discover() }}><IconPlus size={16} />{t("ai.library.addFromEndpoint")}</button></div>
      {!models.length && <p className="py-4 text-sm text-muted-foreground">{t("ai.library.empty")}</p>}
      <div className="space-y-3">{models.map(item => <article key={item.id} data-selected={config.model === item.id} className="space-y-3 rounded-xl border border-border bg-background/70 p-3">
        <div className="flex items-center gap-3"><button type="button" role="radio" aria-checked={config.model === item.id} aria-label={t("ai.library.activate", { model: item.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => update({ model: item.id })}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${config.model === item.id ? "border-primary bg-primary/15 text-primary" : "border-border"}`}><ModelIcon model={item.id} className="size-3.5" /></span><strong className="truncate text-sm" title={item.id}>{item.id}</strong></button><button type="button" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("ai.library.remove", { model: item.id })} onClick={() => toggleModel(item.id)}><IconTrash size={16} /></button></div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3"><label className="flex items-center gap-2 text-xs text-muted-foreground">{t("ai.library.context")}<input type="number" min={8192} max={4_000_000} step={1000} className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-primary" value={item.contextWindow || ""} onChange={event => updateModel(item.id, { contextWindow: Number(event.target.value) })} /></label><label className="flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={item.supportsImages} onCheckedChange={checked => updateModel(item.id, { supportsImages: checked === true })} /><IconPhoto size={15} className="text-primary" aria-hidden="true" />{t("ai.library.images")}</label>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3"><button type="button" className={buttonClass} disabled={saving || testing !== null} onClick={() => void test(item.id)}>{testing === item.id ? <IconLoader2 size={16} className="animate-spin" /> : <IconPlayerPlay size={16} strokeWidth={1.75} aria-hidden="true" />}{t("ai.test")}</button>{testResults[item.id] && <p role="status" className="text-xs text-muted-foreground">{testResults[item.id]}</p>}</div></div>
      </article>)}</div>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); const id = customModel.trim(); if (id && !models.some(item => item.id === id)) { toggleModel(id); setCustomModel("") } }}><input maxLength={200} className={inputClass} value={customModel} onChange={event => setCustomModel(event.target.value)} placeholder={t("ai.library.manualPlaceholder")} aria-label={t("ai.library.manualPlaceholder")} /><button type="submit" className={buttonClass} disabled={!customModel.trim() || models.some(item => item.id === customModel.trim())}><IconPlus size={16} />{t("ai.library.add")}</button></form>
    </section>
    <SettingsAiMcp />
    {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><IconAlertTriangle size={18} className="shrink-0" />{error}</p>}
    <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><IconApi size={20} className="shrink-0 text-primary" aria-hidden="true" />{t("ai.library.addFromEndpoint")}</DialogTitle><DialogDescription>{t("ai.library.pickHint")}</DialogDescription></DialogHeader><div className="flex items-center gap-2"><div className="relative flex-1"><IconSearch size={16} className="absolute left-3 top-3 text-muted-foreground" /><input className={`${inputClass} pl-9`} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("ai.modelsSearch")} /></div><button type="button" className={buttonClass} disabled={catalogLoading} aria-label={t("ai.modelsReload")} onClick={() => void discover()}>{catalogLoading ? <IconLoader2 size={17} className="text-primary animate-spin" /> : <IconRefresh size={17} className="" />}</button></div>
      <div className="max-h-80 space-y-1 overflow-y-auto">{catalogLoading ? <div role="status" className="flex flex-col items-center justify-center gap-3 py-8 text-center text-sm text-muted-foreground"><IconLoader2 size={26} strokeWidth={1.75} className="animate-spin text-primary" aria-hidden="true" /><p>{t("ai.modelsLoading")}</p></div> : catalogError ? <p role="alert" className="text-sm text-destructive">{catalogError}</p> : filtered.length ? filtered.map(id => <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted"><Checkbox checked={models.some(item => item.id === id)} onCheckedChange={() => toggleModel(id)} /><ModelIcon model={id} className="size-4 text-muted-foreground" /><span className="min-w-0 break-all text-sm">{id}</span></label>) : <p className="py-6 text-center text-sm text-muted-foreground">{t("ai.modelsEmpty")}</p>}</div>
      <div className="flex items-center justify-end text-sm"><button type="button" className={buttonClass} onClick={() => setCatalogOpen(false)}><IconCheck size={16} aria-hidden="true" />{t("ai.library.done")}</button></div>
    </DialogContent></Dialog>
  </div>
}
