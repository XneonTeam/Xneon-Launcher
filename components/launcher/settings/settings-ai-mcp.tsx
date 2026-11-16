import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { IconAlertTriangle, IconCheck, IconLoader2, IconPencil, IconPlus, IconTrash, IconUpload, IconTerminal2, IconWorld, IconX as LauncherCancelIcon } from "@tabler/icons-react"
import type { AgentMcpServerConfig, AgentMcpServerState } from "@xnlc/types"
import { SettingsSwitch } from "./settings-switch"
import { ShareModal, ShareButton, shareInput, shareTextarea } from "../instance/shared/share-ui"

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
  dirty: boolean
}

const inputClass = `${shareInput} min-w-0 placeholder:text-muted-foreground`
const textareaClass = `${shareTextarea} min-w-0`
const buttonBase = "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
const buttonClass = `${buttonBase} border-border bg-muted text-foreground enabled:hover:bg-muted/80`
const iconButtonClass = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
const deleteButtonClass = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

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

function McpKeyValueFields({ kind, value, onChange }: {
  kind: "env" | "headers"; value: Record<string, string>; onChange: (value: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const rows = Object.entries(value)
  const setRow = (oldKey: string, key: string, next: string) => {
    // Не затираем другую переменную при переименовании в уже занятое имя.
    if (key !== oldKey && Object.hasOwn(value, key)) return
    onChange(Object.fromEntries(rows.map(([name, current]) => name === oldKey ? [key, next] : [name, current])))
  }
  return <section className="space-y-3">
    <h4 className="text-xs font-medium text-muted-foreground">{t(kind === "env" ? "ai.mcp.environment" : "ai.mcp.headers")}</h4>
    {rows.length > 0 && <div className="space-y-2">{rows.map(([key, current], index) => <div key={`${kind}-${index}`} className="grid items-end gap-2 rounded-xl border border-border/60 bg-card/40 p-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
      <label className="min-w-0 space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{t("ai.mcp.envName")}</span>
        <input className={`${inputClass} font-mono text-xs`} spellCheck={false} autoCapitalize="none" autoCorrect="off" value={key} onChange={event => setRow(key, event.target.value, current)} placeholder={kind === "env" ? "API_KEY" : "Authorization"} />
      </label>
      <label className="min-w-0 space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{t("ai.mcp.envValue")}</span>
        <input className={inputClass} type="password" autoComplete="new-password" spellCheck={false} value={current} onChange={event => setRow(key, key, event.target.value)} placeholder={t("ai.mcp.envValue")} />
      </label>
      <button type="button" className={`${deleteButtonClass} justify-self-end`} aria-label={t(kind === "env" ? "ai.mcp.removeEnvironment" : "ai.mcp.removeHeader")} title={t(kind === "env" ? "ai.mcp.removeEnvironment" : "ai.mcp.removeHeader")}
        onClick={() => onChange(Object.fromEntries(rows.filter(([name]) => name !== key)))}><IconTrash size={16} strokeWidth={1.75} aria-hidden="true" /></button>
    </div>)}</div>}
    <ShareButton secondary onClick={() => {
      const base = kind === "env" ? "NEW_VARIABLE" : "New-Header"
      let key = base, suffix = 1
      while (Object.hasOwn(value, key)) key = `${base}_${suffix++}`
      onChange({ ...value, [key]: "" })
    }}><IconPlus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />{t(kind === "env" ? "ai.mcp.addEnvironment" : "ai.mcp.addHeader")}</ShareButton>
  </section>
}

/** Черновик изолирован от сохранённых серверов: закрытие окна ничего не записывает. */
function McpServerEditorDialog({ editor, busy, error, onClose, onSave }: {
  editor: Editor; busy: boolean; error: string; onClose: () => void
  onSave: (config: AgentMcpServerConfig) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [config, setConfig] = useState(() => structuredClone(editor.config))
  const [dirty, setDirty] = useState(editor.dirty)
  const http = config.url !== undefined
  const commandText = [config.command || "", ...(config.args ?? [])].join("\n")
  const patch = (value: Partial<AgentMcpServerConfig>) => { setConfig(current => ({ ...current, ...value })); setDirty(true) }
  return <ShareModal open onClose={() => { if (!busy) onClose() }}
    title={t(editor.state ? "ai.mcp.editServer" : "ai.mcp.addServer")}
    titleIcon={http ? <IconWorld className="h-4 w-4 text-primary" strokeWidth={1.75} /> : <IconTerminal2 className="h-4 w-4 text-primary" strokeWidth={1.75} />}
    footer={<>
      <ShareButton secondary disabled={busy} onClick={onClose}><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("common.cancel")}</ShareButton>
      <ShareButton busy={busy} disabled={busy || !dirty || !config.name.trim()}
        onClick={() => { void onSave(config).then(saved => { if (saved) onClose() }) }}>{!busy && <IconCheck className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}{t("ai.mcp.save")}</ShareButton>
    </>}>
        <fieldset data-component="mcp-server-editor" disabled={busy} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block min-w-0 space-y-2"><span className="text-xs font-medium text-muted-foreground">{t("ai.mcp.name")}</span><input autoFocus className={inputClass} value={config.name} maxLength={80} onChange={event => patch({ name: event.target.value })} placeholder="new-mcp-server" /></label>
             <div className="flex min-h-10 items-center justify-between gap-3 text-xs text-foreground"><span>{t("ai.mcp.enabled")}</span><SettingsSwitch checked={config.enabled === true} onCheckedChange={enabled => patch({ enabled })} label={t("ai.mcp.enabled")} disabled={busy} /></div>
          </div>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-medium text-muted-foreground">{t("ai.mcp.howToConnect")}</h4>
              <div className="flex shrink-0 gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1">
                <button type="button" className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!http ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`} aria-pressed={!http}
                  onClick={() => http && patch({ command: "npx", args: ["-y"], url: undefined, headers: undefined })}><IconTerminal2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />{t("ai.mcp.command")}</button>
                <button type="button" className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${http ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`} aria-pressed={http}
                  onClick={() => !http && patch({ command: undefined, args: undefined, env: undefined, url: "https://mcp.example.com/mcp" })}><IconWorld className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />{t("ai.mcp.link")}</button>
              </div>
            </div>
            {http ? <label className="block space-y-2"><span className="text-xs font-medium text-muted-foreground">URL</span><input className={inputClass} type="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={config.url || ""} onChange={event => patch({ url: event.target.value })} placeholder="https://mcp.example.com/mcp" /></label>
              : <label className="block space-y-2"><span className="text-xs font-medium text-muted-foreground">{t("ai.mcp.command")}</span><textarea spellCheck={false} className={`${textareaClass} min-h-28 resize-y font-mono text-xs`} value={commandText}
                   onChange={event => { const lines = event.target.value.split(/\r?\n/); patch({ command: lines.shift() || "", args: lines }) }} placeholder={'npx\n-y\n@example/mcp-server'} /></label>}
          </section>
          {http ? <McpKeyValueFields kind="headers" value={config.headers ?? {}} onChange={headers => patch({ headers })} />
            : <McpKeyValueFields kind="env" value={config.env ?? {}} onChange={env => patch({ env })} />}
        </fieldset>
        {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive"><IconAlertTriangle size={16} className="shrink-0" aria-hidden="true" />{error}</p>}
  </ShareModal>
}

export function SettingsAiMcp() {
  const { t } = useTranslation()
  const [editors, setEditors] = useState<Editor[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [editing, setEditing] = useState<Editor | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)
  const revision = useRef(0)
  const busyRef = useRef(false)
  const refreshPending = useRef(false)
  const refreshAfterOperation = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    let fetching = false
    let again = false
    const refresh = async () => {
      if (busyRef.current) { refreshPending.current = true; return }
      if (fetching) { again = true; return }
      fetching = true
      const currentRevision = revision.current
      try {
        const servers = await window.electrobunAPI?.getAiMcpServers()
        if (!cancelled && currentRevision === revision.current && servers) setEditors(servers.map(editorFromState))
      } catch (value) { if (!cancelled && currentRevision === revision.current) setError(value instanceof Error ? value.message : String(value)) }
      finally {
        fetching = false
        if (!cancelled) {
          setLoading(false)
          if (again) { again = false; void refresh() }
        }
      }
    }
    const off = window.electrobunAPI?.onAiMcpServersUpdated?.(() => { void refresh() })
    const flushed = () => { if (refreshPending.current) { refreshPending.current = false; void refresh() } }
    // После локальной операции обновление не может обогнать её ответ.
    refreshAfterOperation.current = flushed
    void refresh()
    return () => { cancelled = true; off?.(); refreshAfterOperation.current = null }
  }, [])

  const startOperation = () => { busyRef.current = true; revision.current++ }
  const finishOperation = () => { busyRef.current = false; setBusy(null); refreshAfterOperation.current?.() }

  const persist = async (configs: AgentMcpServerConfig[]) => {
    const saved = await window.electrobunAPI!.saveAiMcpServers(configs)
    setEditors(saved.map(editorFromState))
    return saved
  }
  const save = async (editor: Editor, config: AgentMcpServerConfig): Promise<boolean> => {
    startOperation()
    setBusy(editor.id); setError(""); setMessage("")
    try {
      const configs = editors.map(item => item.id === editor.id ? config : configFromEditor(item))
      if (!editors.some(item => item.id === editor.id)) configs.push(config)
      const saved = await persist(configs)
      setMessage(t("ai.mcp.saved", { name: config.name }))
      if (saved.find(item => item.name === config.name)?.error) setError(saved.find(item => item.name === config.name)?.error || "")
      return true
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); return false }
    finally { finishOperation() }
  }
  const connect = async (editor: Editor, enabled: boolean) => {
    if (editor.dirty) return
    startOperation()
    setBusy(editor.id); setError(""); setMessage("")
    try {
      const state = enabled
        ? await window.electrobunAPI!.connectAiMcpServer(editor.config.name)
        : await window.electrobunAPI!.disconnectAiMcpServer(editor.config.name)
      setEditors(current => current.map(item => item.id === editor.id ? editorFromState(state) : item))
      if (state.error) setError(state.error)
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { finishOperation() }
  }
  const remove = async (editor: Editor) => {
    startOperation()
    setBusy(editor.id); setError(""); setMessage("")
    try {
      const configs = editors.filter(item => item.id !== editor.id).map(configFromEditor)
      const saved = await persist(configs)
      if (saved.length !== configs.length) throw new Error(t("ai.mcp.removeFailed"))
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { finishOperation() }
  }
  const importJson = async () => {
    startOperation()
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
    finally { finishOperation() }
  }
  const addServer = () => {
    const editor = newEditor(editors.length)
    const names = new Set(editors.map(item => item.config.name.toLocaleLowerCase()))
    let suffix = 1
    while (names.has(editor.config.name.toLocaleLowerCase())) editor.config.name = `new-mcp-server-${suffix++}`
    setEditing(editor); setError(""); setMessage("")
  }
  const editServer = (editor: Editor) => { setEditing(editor); setError(""); setMessage("") }

  return <section data-settings-tone="blue" data-component="settings-ai-mcp" className="settings-color-panel space-y-4 rounded-2xl border border-border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2"><McpIcon /><h3 className="font-semibold">{t("ai.mcp.title")}</h3></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={loading || busy !== null} onClick={addServer}><IconPlus size={16} />{t("ai.mcp.addServer")}</button><button type="button" className={buttonClass} disabled={loading || busy !== null} onClick={() => { setImportOpen(true); setError(""); setMessage("") }}><IconUpload size={16} />{t("ai.mcp.importFragment")}</button></div>
    </div>
    {loading ? <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><IconLoader2 size={15} className="animate-spin" />{t("ai.mcp.loading")}</div> : editors.length === 0 ? <p className="rounded-xl border border-dashed border-border py-5 text-center text-xs text-muted-foreground">{t("ai.mcp.empty")}</p> : <div className="space-y-4">{editors.map(editor => {
      const config = editor.config
      const http = config.url !== undefined
      return <article key={editor.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-primary">{http ? <IconWorld size={18} strokeWidth={1.75} aria-hidden="true" /> : <IconTerminal2 size={18} strokeWidth={1.75} aria-hidden="true" />}</div>
          <div className="min-w-0 space-y-1">
            <h4 className="truncate text-sm font-semibold text-foreground">{config.name || t("ai.mcp.server")}</h4>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className={editor.state?.connected ? "text-success" : editor.state?.error ? "text-destructive" : "text-muted-foreground"}>{t(editor.state?.connecting ? "ai.mcp.statusConnecting" : editor.state?.connected ? "ai.mcp.statusConnected" : editor.state?.error ? "ai.mcp.statusError" : "ai.mcp.statusDisconnected")}</span>
              {editor.state?.connected && <span>{t("ai.mcp.toolCount", { count: editor.state.tools.length })}</span>}
            </div>
            {editor.state?.error && <p className="break-words text-xs text-destructive">{editor.state.error}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-h-10 items-center gap-2 px-1">
            {(busy === editor.id || editor.state?.connecting) && <IconLoader2 size={16} className="animate-spin text-primary" aria-hidden="true" />}
            <SettingsSwitch checked={config.enabled === true} disabled={busy !== null || !editor.state || editor.dirty}
              label={`${t("ai.mcp.enabled")}: ${config.name}`} onCheckedChange={enabled => { void connect(editor, enabled) }} />
          </div>
          <button type="button" className={iconButtonClass} disabled={busy !== null} aria-label={t("ai.mcp.editServer")} title={t("ai.mcp.editServer")} onClick={() => editServer(editor)}><IconPencil size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          <button type="button" className={deleteButtonClass} disabled={busy !== null} aria-label={t("ai.mcp.remove", { name: config.name })} title={t("ai.mcp.remove", { name: config.name })} onClick={() => void remove(editor)}><IconTrash size={16} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
      </article>
    })}</div>}
    {(error || message) && !editing && !importOpen && <p role={error ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${error ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-success/30 bg-success/10 text-success"}`}>{error ? <IconAlertTriangle size={15} className="shrink-0" /> : <IconCheck size={15} className="shrink-0" />}{error || message}</p>}
    {editing && <McpServerEditorDialog key={editing.id} editor={editing} busy={busy !== null} error={error} onClose={() => setEditing(null)} onSave={config => save(editing, config)} />}
    <ShareModal open={importOpen} onClose={() => { if (busy === null) setImportOpen(false) }}
      title={t("ai.mcp.importFragment")}
      titleIcon={<IconUpload className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden="true" />}
      footer={<>
        <ShareButton secondary disabled={busy !== null} onClick={() => setImportOpen(false)}><LauncherCancelIcon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />{t("common.cancel")}</ShareButton>
        <ShareButton busy={busy === "import"} disabled={busy !== null || !importText.trim()} onClick={() => void importJson()}>{busy !== "import" && <IconUpload className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}{t("ai.mcp.import")}</ShareButton>
      </>}>
      <div data-component="mcp-import-dialog" className="space-y-4">
      <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" disabled={busy !== null} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (file.size > 1_000_000) { setError(t("ai.mcp.fileTooLarge")); return }; void file.text().then(setImportText).catch(value => setError(value instanceof Error ? value.message : String(value))) }} />
      <div className="flex justify-end"><ShareButton secondary disabled={busy !== null} onClick={() => fileInput.current?.click()}><IconUpload className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />{t("ai.mcp.chooseFile")}</ShareButton></div>
      <label className="block space-y-2"><span className="text-xs font-medium text-muted-foreground">{t("ai.mcp.jsonLabel")}</span><textarea spellCheck={false} disabled={busy !== null} className={`${textareaClass} min-h-56 resize-y font-mono text-xs`} value={importText} onChange={event => setImportText(event.target.value)} placeholder={'{\n  "mcpServers": {\n    "postgres": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@host/db"],\n      "env": {}\n    },\n    "remote": { "url": "https://mcp.example.com/mcp" }\n  }\n}'} /></label>
      {error && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><IconAlertTriangle size={15} className="shrink-0" />{error}</p>}
      </div>
    </ShareModal>
  </section>
}
