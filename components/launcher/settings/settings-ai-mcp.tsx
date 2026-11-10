import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { IconAlertTriangle, IconChevronDown, IconCheck, IconLoader2, IconPlug, IconPlugConnected, IconPlus, IconTrash, IconUpload, IconTerminal2, IconWorld } from "@tabler/icons-react"
import type { AgentMcpServerConfig, AgentMcpServerState } from "@xnlc/types"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

function McpIcon() {
  return <svg aria-hidden="true" viewBox="7 7 166 166" fill="none" stroke="currentColor" className="mt-0.5 size-[18px] shrink-0 text-primary">
    <path d="M23.5996 85.2532L86.2021 22.6507C94.8457 14.0071 108.86 14.0071 117.503 22.6507C126.147 31.2942 126.147 45.3083 117.503 53.9519L70.2254 101.23" strokeWidth="11.0667" strokeLinecap="round"/>
    <path d="M70.8789 100.578L117.504 53.952C126.148 45.3083 140.163 45.3083 148.806 53.952L149.132 54.278C157.776 62.9216 157.776 76.9357 149.132 85.5792L92.5139 142.198C89.6327 145.079 89.6327 149.75 92.5139 152.631L104.14 164.257" strokeWidth="11.0667" strokeLinecap="round"/>
    <path d="M101.853 38.3013L55.553 84.6011C46.9094 93.2447 46.9094 107.258 55.553 115.902C64.1966 124.546 78.2106 124.546 86.8543 115.902L133.154 69.6025" strokeWidth="11.0667" strokeLinecap="round"/>
  </svg>
}

type Editor = {
  id: string
  config: AgentMcpServerConfig
  state?: AgentMcpServerState
  expanded?: boolean
  dirty: boolean
}

const inputClass = "w-full rounded-xl border border-border bg-transparent px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
const buttonBase = "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary"
const buttonClass = `${buttonBase} border-border bg-transparent text-foreground hover:bg-muted disabled:text-muted-foreground`
const primaryButtonClass = `${buttonBase} border-primary bg-primary text-primary-foreground enabled:hover:bg-primary/90 disabled:border-border disabled:bg-transparent disabled:text-muted-foreground`

function editorFromState(server: AgentMcpServerState): Editor {
  return { id: server.name, config: { name: server.name, command: server.command, args: server.args, env: server.env, url: server.url, headers: server.headers, enabled: server.enabled }, state: server, dirty: false }
}

function configFromEditor(editor: Editor): AgentMcpServerConfig {
  return { ...editor.config }
}

function importConfigs(raw: string, t: TFunction): AgentMcpServerConfig[] {
  const value: unknown = JSON.parse(raw)
  if (Array.isArray(value)) return value as AgentMcpServerConfig[]
  if (!value || typeof value !== "object") throw new Error(t("ai.mcp.invalidJson"))
  const source = value as Record<string, unknown>
  const map = source.mcpServers ?? source.servers
  if (map && typeof map === "object" && !Array.isArray(map)) return Object.entries(map).map(([name, config]) => ({ ...(config as AgentMcpServerConfig), name }))
  if (typeof source.name === "string") return [source as unknown as AgentMcpServerConfig]
  throw new Error(t("ai.mcp.missingServers"))
}

function newEditor(index: number): Editor {
  return { id: `new-${Date.now()}-${index}`, config: { name: "new-mcp-server", command: "npx", args: ["-y"], env: {}, enabled: false }, expanded: true, dirty: true }
}

export function SettingsAiMcp() {
  const { t } = useTranslation()
  const [editors, setEditors] = useState<Editor[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    window.electrobunAPI?.getAiMcpServers().then(servers => { if (!cancelled) setEditors(servers.map(editorFromState)) })
      .catch(value => { if (!cancelled) setError(value instanceof Error ? value.message : String(value)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const updateEditor = (id: string, update: (editor: Editor) => Editor) => {
    setEditors(current => current.map(editor => editor.id === id ? update(editor) : editor))
    setError(""); setMessage("")
  }
  const patchConfig = (id: string, patch: Partial<AgentMcpServerConfig>) => updateEditor(id, editor => ({ ...editor, config: { ...editor.config, ...patch }, dirty: true }))
  const persist = async (configs: AgentMcpServerConfig[]) => {
    const saved = await window.electrobunAPI!.saveAiMcpServers(configs)
    setEditors(saved.map(editorFromState))
    return saved
  }
  const save = async (id: string) => {
    const editor = editors.find(item => item.id === id)
    if (!editor) return
    setBusy(id); setError(""); setMessage("")
    try {
      const configs = editors.map(configFromEditor)
      const saved = await persist(configs)
      setMessage(t("ai.mcp.saved", { name: editor.config.name }))
      if (saved.find(item => item.name === editor.config.name)?.error) setError(saved.find(item => item.name === editor.config.name)?.error || "")
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { setBusy(null) }
  }
  const connect = async (editor: Editor) => {
    if (editor.dirty) return
    setBusy(editor.id); setError(""); setMessage("")
    try {
      const state = editor.state?.connected
        ? await window.electrobunAPI!.disconnectAiMcpServer(editor.config.name)
        : await window.electrobunAPI!.connectAiMcpServer(editor.config.name)
      setEditors(current => current.map(item => item.id === editor.id ? { ...item, config: { ...item.config, enabled: state.enabled }, state } : item))
      if (state.error) setError(state.error)
      else setMessage(t(state.connected ? "ai.mcp.connected" : "ai.mcp.disconnected", { name: state.name }))
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { setBusy(null) }
  }
  const remove = async (editor: Editor) => {
    setBusy(editor.id); setError(""); setMessage("")
    try {
      const configs = editors.filter(item => item.id !== editor.id).map(configFromEditor)
      const saved = await persist(configs)
      if (saved.length !== configs.length) throw new Error(t("ai.mcp.removeFailed"))
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { setBusy(null) }
  }
  const importJson = async () => {
    setBusy("import"); setError(""); setMessage("")
    try {
      const incoming = importConfigs(importText, t)
      const configs = editors.map(configFromEditor)
      const merged = new Map(configs.map(config => [config.name.toLocaleLowerCase(), config]))
      for (const config of incoming) {
        if (!config || typeof config.name !== "string" || !config.name.trim()) throw new Error(t("ai.mcp.missingServerName"))
        merged.set(config.name.toLocaleLowerCase(), config)
      }
      const saved = await persist([...merged.values()])
      setImportOpen(false); setImportText("")
      setMessage(t("ai.mcp.imported", { count: incoming.length }))
      const failed = saved.find(server => server.enabled && server.error)
      if (failed) setError(`${failed.name}: ${failed.error}`)
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { setBusy(null) }
  }
  const addServer = () => { setEditors(current => [...current, newEditor(current.length)]); setError(""); setMessage("") }

  return <section data-settings-tone="blue" data-component="settings-ai-mcp" className="settings-color-panel space-y-4 rounded-2xl border border-border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2"><McpIcon /><div><h3 className="font-semibold">{t("ai.mcp.title")}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("ai.mcp.description")}</p></div></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={loading || busy !== null} onClick={addServer}><IconPlus size={16} />{t("ai.mcp.addServer")}</button><button type="button" className={buttonClass} disabled={loading || busy !== null} onClick={() => setImportOpen(true)}><IconUpload size={16} />{t("ai.mcp.importFragment")}</button></div>
    </div>
    {loading ? <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><IconLoader2 size={15} className="animate-spin" />{t("ai.mcp.loading")}</div> : editors.length === 0 ? <p className="rounded-xl border border-dashed border-border py-5 text-center text-xs text-muted-foreground">{t("ai.mcp.empty")}</p> : <div className="space-y-4">{editors.map(editor => {
      const config = editor.config
      const http = config.url !== undefined
      const environment = Object.entries(config.env ?? {})
      const commandText = [config.command || "", ...(config.args ?? [])].join("\n")
      const setEnvironment = (oldKey: string, key: string, value: string) => {
        const entries = Object.entries(config.env ?? {}).map(([name, currentValue]) => name === oldKey ? [key, value] : [name, currentValue])
        patchConfig(editor.id, { env: Object.fromEntries(entries) })
      }
      return <article key={editor.id} className="rounded-xl border border-border">
        <button
          type="button"
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary"
          aria-expanded={editor.expanded === true}
          onClick={() => setEditors(current => current.map(item => item.id === editor.id ? { ...item, expanded: !item.expanded } : item))}
        >
          {http ? <IconWorld size={17} className="shrink-0 text-primary" /> : <IconTerminal2 size={17} className="shrink-0 text-primary" />}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{config.name || t("ai.mcp.server")}</span>
          {editor.dirty ? <span className="text-xs text-muted-foreground">{t("ai.mcp.notSaved")}</span> : editor.state && (
            <span className={`text-xs ${editor.state.connected ? "text-success" : editor.state.error ? "text-destructive" : "text-muted-foreground"}`}>
              {t(editor.state.connected ? "ai.mcp.statusConnected" : editor.state.error ? "ai.mcp.statusError" : "ai.mcp.statusDisconnected")}
            </span>
          )}
          <IconChevronDown size={16} className={`shrink-0 text-muted-foreground ${editor.expanded ? "rotate-180" : ""}`} />
        </button>
        {editor.expanded && <div className="space-y-4 border-t border-border px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h5 className="text-sm font-semibold">{t("ai.mcp.howToConnect")}</h5>
              <p className="mt-1 text-xs text-muted-foreground">{t("ai.mcp.howToConnectHint")}</p>
            </div>
            <button type="button" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" disabled={busy !== null} aria-label={t("ai.mcp.remove", { name: config.name })} title={t("ai.mcp.remove", { name: config.name })} onClick={() => void remove(editor)}><IconTrash size={16} /></button>
          </div>
          <div>
            <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border p-1"><button type="button" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${!http ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`} aria-pressed={!http} onClick={() => http && updateEditor(editor.id, current => ({ ...current, config: { ...current.config, command: current.config.command || "npx", args: current.config.args?.length ? current.config.args : ["-y"], url: undefined, headers: undefined }, dirty: true }))}><IconTerminal2 size={14} aria-hidden="true" />{t("ai.mcp.command")}</button><button type="button" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${http ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`} aria-pressed={http} onClick={() => !http && updateEditor(editor.id, current => ({ ...current, config: { ...current.config, command: undefined, args: undefined, env: undefined, url: current.config.url || "https://mcp.example.com/mcp" }, dirty: true }))}><IconWorld size={14} aria-hidden="true" />{t("ai.mcp.link")}</button></div>
            {http ? <label className="mt-3 block space-y-2"><span className="text-xs font-medium text-muted-foreground">URL</span><input className={inputClass} value={config.url || ""} onChange={event => patchConfig(editor.id, { url: event.target.value })} placeholder="https://mcp.example.com/mcp" /></label> : <><textarea spellCheck={false} className={`${inputClass} mt-3 min-h-28 resize-y font-mono text-sm leading-relaxed`} value={commandText} onChange={event => { const lines = event.target.value.split(/\r?\n/); patchConfig(editor.id, { command: lines.shift() || "", args: lines }) }} placeholder={'npx\n-y\n@example/mcp-server'} /><p className="mt-2 text-xs text-muted-foreground">{t("ai.mcp.commandHint")}</p></>}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block space-y-2"><span className="text-sm font-medium">{t("ai.mcp.name")}</span><input className={inputClass} value={config.name} maxLength={80} onChange={event => patchConfig(editor.id, { name: event.target.value })} placeholder="new-mcp-server" /></label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-foreground"><Checkbox checked={config.enabled === true} onCheckedChange={checked => patchConfig(editor.id, { enabled: checked === true })} />{t("ai.mcp.enabled")}</label>
          </div>
          {!http && <div className="border-t border-border pt-5"><h5 className="text-sm font-semibold">{t("ai.mcp.environment")}</h5><p className="mt-1 text-xs text-muted-foreground">{t("ai.mcp.environmentHint")}</p>
            <div className="mt-3 space-y-2">{environment.map(([key, value], index) => <div key={`${editor.id}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]"><input className={`${inputClass} font-mono text-xs`} value={key} aria-label={t("ai.mcp.envName")} onChange={event => setEnvironment(key, event.target.value, value)} placeholder="API_KEY" /><input className={inputClass} type="password" autoComplete="new-password" value={value} aria-label={t("ai.mcp.envValue")} onChange={event => setEnvironment(key, key, event.target.value)} placeholder={t("ai.mcp.envValue")} /><button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t("ai.mcp.removeEnvironment")} onClick={() => patchConfig(editor.id, { env: Object.fromEntries(environment.filter(([name]) => name !== key)) })}><IconTrash size={15} /></button></div>)}</div>
            <button type="button" className={`${buttonClass} mt-3`} onClick={() => { let key = "NEW_VARIABLE", suffix = 1; while (Object.hasOwn(config.env ?? {}, key)) key = `NEW_VARIABLE_${suffix++}`; patchConfig(editor.id, { env: { ...config.env, [key]: "" } }) }}><IconPlus size={15} />{t("ai.mcp.addEnvironment")}</button>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="min-w-0 flex-1 text-xs text-muted-foreground">{editor.state ? t("ai.mcp.toolCount", { count: editor.state.tools.length }) : t("ai.mcp.notSaved")}{editor.state?.error ? ` · ${editor.state.error}` : ""}</p><div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy !== null || !editor.state || editor.dirty} onClick={() => void connect(editor)}>{busy === editor.id ? <IconLoader2 size={15} className="animate-spin" /> : editor.state?.connected ? <IconPlug size={15} /> : <IconPlugConnected size={15} />}{t(editor.state?.connected ? "ai.mcp.disconnect" : "ai.mcp.connect")}</button><button type="button" className={primaryButtonClass} disabled={busy !== null || !editor.dirty || !config.name.trim()} onClick={() => void save(editor.id)}>{busy === editor.id ? <IconLoader2 size={15} className="animate-spin" /> : <IconCheck size={15} />}{t("ai.mcp.save")}</button></div></div>
        </div>}
      </article>
    })}</div>}
    {(error || message) && <p role={error ? "alert" : "status"} className={`flex items-start gap-2 text-xs ${error ? "text-destructive" : "text-success"}`}>{error ? <IconAlertTriangle size={15} className="shrink-0" /> : <IconCheck size={15} className="shrink-0" />}{error || message}</p>}
    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{t("ai.mcp.importFragment")}</DialogTitle><DialogDescription>{t("ai.mcp.importHint")}</DialogDescription></DialogHeader>
      <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (file.size > 1_000_000) { setError(t("ai.mcp.fileTooLarge")); return }; void file.text().then(setImportText).catch(value => setError(value instanceof Error ? value.message : String(value))) }} />
      <div className="flex justify-end"><button type="button" className={buttonClass} onClick={() => fileInput.current?.click()}><IconUpload size={15} />{t("ai.mcp.chooseFile")}</button></div>
      <textarea spellCheck={false} className={`${inputClass} min-h-56 resize-y font-mono text-xs leading-relaxed`} value={importText} onChange={event => setImportText(event.target.value)} placeholder={'{\n  "mcpServers": {\n    "postgres": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@host/db"],\n      "env": {}\n    },\n    "remote": { "url": "https://mcp.example.com/mcp" }\n  }\n}'} />
      <p className="text-xs text-muted-foreground">{t("ai.mcp.securityHint")}</p>
      {error && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><IconAlertTriangle size={15} className="shrink-0" />{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={() => setImportOpen(false)}>{t("common.cancel")}</button><button type="button" className={primaryButtonClass} disabled={busy !== null || !importText.trim()} onClick={() => void importJson()}>{busy === "import" ? <IconLoader2 size={15} className="animate-spin" /> : <IconUpload size={15} />}{t("ai.mcp.import")}</button></div>
    </DialogContent></Dialog>
  </section>
}
