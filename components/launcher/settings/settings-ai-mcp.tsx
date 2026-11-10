import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { IconAlertTriangle, IconApi, IconCheck, IconLoader2, IconPlug, IconPlugConnected, IconPlus, IconTrash, IconUpload, IconTerminal2, IconWorld } from "@tabler/icons-react"
import type { AgentMcpServerConfig, AgentMcpServerState } from "@xnlc/types"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Editor = {
  id: string
  config: AgentMcpServerConfig
  state?: AgentMcpServerState
  dirty: boolean
}

const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"

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
  return { id: `new-${Date.now()}-${index}`, config: { name: "new-mcp-server", command: "npx", args: ["-y"], env: {}, enabled: false }, dirty: true }
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
      <div className="flex min-w-0 items-start gap-2"><IconApi size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" /><div><h3 className="font-semibold">{t("ai.mcp.title")}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("ai.mcp.description")}</p></div></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy !== null} onClick={addServer}><IconPlus size={16} />{t("ai.mcp.addServer")}</button><button type="button" className={buttonClass} disabled={busy !== null} onClick={() => setImportOpen(true)}><IconUpload size={16} />{t("ai.mcp.importFragment")}</button></div>
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
      return <article key={editor.id} className="space-y-5 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><IconApi size={17} className="text-primary" /><h4 className="text-sm font-semibold">{t("ai.mcp.server")}</h4>{editor.state && <span className={`rounded-full px-2 py-0.5 text-[10px] ${editor.state.connected ? "bg-success/10 text-success" : editor.state.error ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{t(editor.state.connected ? "ai.mcp.statusConnected" : editor.state.error ? "ai.mcp.statusError" : "ai.mcp.statusDisconnected")}</span>}</div>
          <button type="button" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" disabled={busy !== null} aria-label={t("ai.mcp.remove", { name: config.name })} title={t("ai.mcp.remove", { name: config.name })} onClick={() => void remove(editor)}><IconTrash size={16} /></button>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block space-y-2"><span className="text-sm font-medium">{t("ai.mcp.name")}</span><input className={inputClass} value={config.name} maxLength={80} onChange={event => patchConfig(editor.id, { name: event.target.value })} placeholder="new-mcp-server" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground"><Checkbox checked={config.enabled === true} onCheckedChange={checked => patchConfig(editor.id, { enabled: checked === true })} />{t("ai.mcp.enabled")}</label>
        </div>
        <div className="border-t border-border pt-5">
          <h5 className="text-sm font-semibold">{t("ai.mcp.howToConnect")}</h5><p className="mt-1 text-xs text-muted-foreground">{t("ai.mcp.howToConnectHint")}</p>
          <div className="mt-4 inline-flex rounded-xl border border-border bg-muted/30 p-1"><button type="button" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${!http ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => updateEditor(editor.id, current => ({ ...current, config: { ...current.config, command: current.config.command || "npx", args: current.config.args?.length ? current.config.args : ["-y"], url: undefined, headers: undefined }, dirty: true }))}><IconTerminal2 size={14} aria-hidden="true" />{t("ai.mcp.command")}</button><button type="button" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${http ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => updateEditor(editor.id, current => ({ ...current, config: { ...current.config, command: undefined, args: undefined, env: undefined, url: current.config.url || "https://mcp.example.com/mcp" }, dirty: true }))}><IconWorld size={14} aria-hidden="true" />{t("ai.mcp.link")}</button></div>
          {http ? <label className="mt-3 block space-y-2"><span className="text-xs font-medium text-muted-foreground">URL</span><input className={inputClass} value={config.url || ""} onChange={event => patchConfig(editor.id, { url: event.target.value })} placeholder="https://mcp.example.com/mcp" /></label> : <><textarea spellCheck={false} className={`${inputClass} mt-3 min-h-28 resize-y font-mono text-sm leading-relaxed`} value={commandText} onChange={event => { const lines = event.target.value.split(/\r?\n/); patchConfig(editor.id, { command: lines.shift() || "", args: lines }) }} placeholder={'npx\n-y\n@example/mcp-server'} /><p className="mt-2 text-xs text-muted-foreground">{t("ai.mcp.commandHint")}</p></>}
        </div>
        {!http && <div className="border-t border-border pt-5"><h5 className="text-sm font-semibold">{t("ai.mcp.environment")}</h5><p className="mt-1 text-xs text-muted-foreground">{t("ai.mcp.environmentHint")}</p>
          <div className="mt-3 space-y-2">{environment.map(([key, value], index) => <div key={`${editor.id}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]"><input className={`${inputClass} font-mono text-xs`} value={key} aria-label={t("ai.mcp.envName")} onChange={event => setEnvironment(key, event.target.value, value)} placeholder="API_KEY" /><input className={inputClass} type="password" autoComplete="new-password" value={value} aria-label={t("ai.mcp.envValue")} onChange={event => setEnvironment(key, key, event.target.value)} placeholder={t("ai.mcp.envValue")} /><button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t("ai.mcp.removeEnvironment")} onClick={() => patchConfig(editor.id, { env: Object.fromEntries(environment.filter(([name]) => name !== key)) })}><IconTrash size={15} /></button></div>)}</div>
          <button type="button" className={`${buttonClass} mt-3`} onClick={() => { let key = "NEW_VARIABLE", suffix = 1; while (Object.hasOwn(config.env ?? {}, key)) key = `NEW_VARIABLE_${suffix++}`; patchConfig(editor.id, { env: { ...config.env, [key]: "" } }) }}><IconPlus size={15} />{t("ai.mcp.addEnvironment")}</button>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="min-w-0 flex-1 text-xs text-muted-foreground">{editor.state ? t("ai.mcp.toolCount", { count: editor.state.tools.length }) : t("ai.mcp.notSaved")}{editor.state?.error ? ` · ${editor.state.error}` : ""}</p><div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy !== null || !editor.state || editor.dirty} onClick={() => void connect(editor)}>{busy === editor.id ? <IconLoader2 size={15} className="animate-spin" /> : editor.state?.connected ? <IconPlug size={15} /> : <IconPlugConnected size={15} />}{t(editor.state?.connected ? "ai.mcp.disconnect" : "ai.mcp.connect")}</button><button type="button" className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy !== null || !editor.dirty || !config.name.trim()} onClick={() => void save(editor.id)}>{busy === editor.id ? <IconLoader2 size={15} className="animate-spin" /> : <IconCheck size={15} />}{t("ai.mcp.save")}</button></div></div>
      </article>
    })}</div>}
    {(error || message) && <p role={error ? "alert" : "status"} className={`flex items-start gap-2 text-xs ${error ? "text-destructive" : "text-success"}`}>{error ? <IconAlertTriangle size={15} className="shrink-0" /> : <IconCheck size={15} className="shrink-0" />}{error || message}</p>}
    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{t("ai.mcp.importFragment")}</DialogTitle><DialogDescription>{t("ai.mcp.importHint")}</DialogDescription></DialogHeader>
      <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (file.size > 1_000_000) { setError(t("ai.mcp.fileTooLarge")); return }; void file.text().then(setImportText).catch(value => setError(value instanceof Error ? value.message : String(value))) }} />
      <div className="flex justify-end"><button type="button" className={buttonClass} onClick={() => fileInput.current?.click()}><IconUpload size={15} />{t("ai.mcp.chooseFile")}</button></div>
      <textarea spellCheck={false} className={`${inputClass} min-h-56 resize-y font-mono text-xs leading-relaxed`} value={importText} onChange={event => setImportText(event.target.value)} placeholder={'{\n  "mcpServers": {\n    "postgres": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@host/db"],\n      "env": {}\n    },\n    "remote": { "url": "https://mcp.example.com/mcp" }\n  }\n}'} />
      <p className="text-xs text-muted-foreground">{t("ai.mcp.securityHint")}</p>
      {error && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><IconAlertTriangle size={15} className="shrink-0" />{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={() => setImportOpen(false)}>{t("common.cancel")}</button><button type="button" className={`${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy !== null || !importText.trim()} onClick={() => void importJson()}>{busy === "import" ? <IconLoader2 size={15} className="animate-spin" /> : <IconUpload size={15} />}{t("ai.mcp.import")}</button></div>
    </DialogContent></Dialog>
  </section>
}
