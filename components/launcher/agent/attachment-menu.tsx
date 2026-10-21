import { useEffect, useRef, useState, type ComponentType } from "react"
import { useTranslation } from "react-i18next"
import { IconArrowLeft, IconChevronRight, IconCheck, IconFileText, IconPhoto, IconSparkles, IconPuzzle, IconSearch, IconLoader2, IconAlertTriangle, IconArchive, IconLayoutGrid, IconColorSwatch, IconServer } from "@tabler/icons-react"
import type { AgentAttachment, DbBuildLight, DbBuildMod, McServerInfo, ModContentType, ModSearchResult } from "@xnlc/types"
import { attachToAgent, useAgentState } from "./store"
import { getAgentProject } from "./tools"
import { AgentEntityIcon } from "./entity-icon"
import { LoaderIcon, loaderLabel } from "../instance/loader-icon"
import { SourceMark } from "../source-mark"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type ContentKind = "mod" | "resourcepack" | "shader" | "datapack"
type Purpose = "build" | ContentKind | "log" | "crash"
type Entry = { id: string; name: string; detail: string; content: string; source?: "modrinth" | "curseforge" | "ftb"; iconUrl?: string; kind: "file" | "project" }
type View = { kind: "root" } | { kind: "builds"; purpose: Purpose } | { kind: "content"; build: DbBuildLight; purpose: Purpose; items: Entry[] } | { kind: "catalog" } | { kind: "servers" }
const ICONS: Record<Purpose | "file" | "catalog" | "server", ComponentType<{ size?: number; className?: string; strokeWidth?: number }>> = { build: IconColorSwatch, mod: IconPuzzle, resourcepack: IconPhoto, shader: IconSparkles, datapack: IconArchive, file: IconFileText, log: IconFileText, crash: IconAlertTriangle, catalog: IconLayoutGrid, server: IconServer }

export function AttachmentMenu({ onClose, onFile }: { onClose: () => void; onFile: () => void }) {
  const { t } = useTranslation()
  const { chat } = useAgentState()
  const [view, setView] = useState<View>({ kind: "root" })
  const [query, setQuery] = useState("")
  const [builds, setBuilds] = useState<DbBuildLight[]>([])
  const [servers, setServers] = useState<McServerInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [source, setSource] = useState<"modrinth" | "curseforge" | "ftb">("modrinth")
  const [type, setType] = useState<ModContentType>("mod")
  const [results, setResults] = useState<ModSearchResult[]>([])
  const generation = useRef(0)
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let cancelled = false
    void window.electronAPI?.loadBuildsLight().then(items => { if (!cancelled) setBuilds(items) }).catch(error => { if (!cancelled) setError(String(error)) })
    void window.electronAPI?.mcServerList().then(items => { if (!cancelled) setServers(items) }).catch(error => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true; generation.current++ }
  }, [])
  useEffect(() => { searchInput.current?.focus() }, [view.kind])
  const navigate = (next: View) => { generation.current++; setView(next); setQuery(""); setError(""); setResults([]); setBusy(false) }
  const attach = (item: AgentAttachment) => { attachToAgent(item); onClose() }
  const chooseBuild = async (build: DbBuildLight, purpose: Purpose) => {
    if (!window.electronAPI || busy) return
    if (purpose === "build") {
      const { icon, coverImage, customEnv, ...context } = build
      attach({ id: `build:${build.id}`, kind: "build", name: build.name, iconUrl: build.icon || undefined, content: JSON.stringify(context, null, 2) })
      return
    }
    const request = ++generation.current
    setBusy(true); setError("")
    try {
      let items: Entry[]
      if (purpose === "log" || purpose === "crash") {
        const folder = purpose === "log" ? "logs" : "crash-reports"
        try {
          const result = await window.electronAPI.agentBuildFile({ buildId: build.id, path: folder, operation: "list" })
          items = (result.entries || []).filter(name => !name.endsWith("/") && /\.(log|txt)$/i.test(name)).sort((a, b) => a === "latest.log" ? -1 : b === "latest.log" ? 1 : b.localeCompare(a)).map(name => ({ id: `${purpose}:${build.id}:${name}`, name, detail: build.name, content: `${folder}/${name}`, kind: "file" }))
        } catch (error) {
          if (!/ENOENT/.test(String(error))) throw error
          items = []
        }
      } else if (purpose === "datapack") {
        const worlds = await window.electronAPI.listWorlds(build.name)
        const groups = await Promise.all(worlds.map(async world => (await window.electronAPI!.listWorldDatapacks(build.name, world.folder)).map(pack => ({ id: `content:datapack:${build.id}:${world.folder}:${pack.name}`, name: pack.name, detail: world.name, kind: "project" as const, content: JSON.stringify({ buildId: build.id, buildName: build.name, world: world.folder, datapack: pack.name }) }))))
        items = groups.flat()
      } else {
        const scanned = await window.electronAPI.scanBuildIntentContent(build.name)
        const key = purpose === "mod" ? "mods" : purpose === "shader" ? "shaders" : "resourcepacks"
        items = scanned[key].map((mod: DbBuildMod) => ({ id: `content:${purpose}:${build.id}:${mod.slug}`, name: mod.name || mod.slug, detail: mod.slug, iconUrl: mod.icon_url, source: mod.source === "modrinth" || mod.source === "curseforge" ? mod.source : undefined, kind: "project", content: JSON.stringify({ buildId: build.id, buildName: build.name, contentType: purpose, fileName: mod.slug, ...mod }, null, 2) }))
      }
      if (request === generation.current) { setView({ kind: "content", build, purpose, items }); setQuery("") }
    } catch (error) { if (request === generation.current) setError(String(error)) } finally { if (request === generation.current) setBusy(false) }
  }
  const choosePurpose = (purpose: Purpose) => {
    const attached = builds.find(build => chat?.attachments.some(item => item.id === `build:${build.id}`))
    if (purpose !== "build" && attached) void chooseBuild(attached, purpose)
    else navigate({ kind: "builds", purpose })
  }
  const chooseEntry = async (entry: Entry) => {
    if (view.kind !== "content" || !window.electronAPI || busy) return
    if (entry.kind !== "file") { attach({ id: entry.id, kind: "project", name: entry.name, content: entry.content, source: entry.source, iconUrl: entry.iconUrl }); return }
    const request = ++generation.current
    setBusy(true); setError("")
    try {
      const result = await window.electronAPI.agentBuildFile({ buildId: view.build.id, path: entry.content, operation: "read" })
      if (request === generation.current) attach({ id: entry.id, kind: "file", name: `${view.build.name} · ${entry.name}`, content: result.content || "" })
    } catch (error) { if (request === generation.current) setError(String(error)) } finally { if (request === generation.current) setBusy(false) }
  }
  const searchCatalog = async () => {
    if (!query.trim() || busy || !window.electronAPI) return
    const request = ++generation.current
    setBusy(true); setError("")
    try {
      const result = source === "ftb" ? await window.electronAPI.modsFtbSearch(query.trim()) : source === "modrinth" ? await window.electronAPI.modsModrinthSearch(query.trim(), type) : await window.electronAPI.modsCurseforgeSearch(query.trim(), type)
      if (request === generation.current) setResults(result.results)
    } catch (error) { if (request === generation.current) setError(String(error)) } finally { if (request === generation.current) setBusy(false) }
  }
  const chooseProject = async (project: ModSearchResult) => {
    if (!window.electronAPI || busy) return
    const request = ++generation.current
    setBusy(true); setError("")
    try {
      const projectId = project.source === "curseforge" ? String(project.modId || project.id) : project.projectId || project.id
      const details = await getAgentProject(window.electronAPI, project.source, projectId)
      if (request === generation.current) attach({ id: `${project.source}:${projectId}`, kind: "project", name: project.name, source: project.source as "modrinth" | "curseforge" | "ftb", projectId, iconUrl: project.iconUrl, content: JSON.stringify({ ...project, contentType: type, description: details.description.slice(0, 18000), versions: details.versions.slice(0, 12) }, null, 2) })
    } catch (error) { if (request === generation.current) setError(String(error)) } finally { if (request === generation.current) setBusy(false) }
  }
  const chooseServer = (server: McServerInfo) => {
    const { javaPath, extraJavaArgs, ...settings } = server
    attach({ id: `server:${server.id}`, kind: "server", name: server.name, iconUrl: server.icon || undefined, content: JSON.stringify({ ...settings, hasCustomJavaPath: Boolean(javaPath), extraJavaArgs: extraJavaArgs || undefined }, null, 2) })
  }
  const filter = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const rootItems = (["build", "server", "mod", "resourcepack", "shader", "datapack", "catalog", "file", "log", "crash"] as const).filter(kind => filter(`${t(`agent.attach.${kind}`)} ${t(`agent.attach.${kind}Hint`)}`))
  const title = view.kind === "root" ? t("agent.attachTitle") : view.kind === "catalog" ? t("agent.projects") : view.kind === "servers" ? t("agent.attach.chooseServer") : view.kind === "builds" ? t("agent.attach.chooseBuild") : `${view.build.name} · ${t(`agent.attach.${view.purpose}`)}`
  const back = () => view.kind === "content" ? navigate({ kind: "builds", purpose: view.purpose }) : navigate({ kind: "root" })
  return <>
    <div className="agent-popover-heading">{view.kind !== "root" && <button type="button" className="agent-icon-button" aria-label={t("agent.back")} onClick={back}><IconArrowLeft size={16} /></button>}<span>{title}</span></div>
    <form className="agent-popover-search" onSubmit={event => { event.preventDefault(); if (view.kind === "catalog") void searchCatalog() }}><IconSearch size={15} /><input ref={searchInput} data-autofocus type="search" autoComplete="off" aria-label={t("agent.attach.search")} placeholder={view.kind === "catalog" ? t("agent.searchProjects") : t("agent.attach.search")} value={query} onChange={event => setQuery(event.target.value)} />{view.kind === "catalog" && <button className="agent-icon-button" type="submit" aria-label={t("agent.search")} disabled={busy || !query.trim()}><IconSearch size={16} /></button>}</form>
    {view.kind === "catalog" && <div className="agent-catalog-filters">
      <Select value={source} onValueChange={value => { generation.current++; setBusy(false); setSource(value as typeof source); if (value === "ftb") setType("modpack"); setResults([]) }}>
        <SelectTrigger size="sm" className="min-w-0 flex-1 rounded-xl border border-border bg-muted/50 text-xs text-foreground" aria-label={t("agent.source")}><SelectValue /></SelectTrigger>
        <SelectContent className="z-[120]" data-agent-composer-owner="agent-attach-menu">
          <SelectItem value="modrinth"><SourceMark source="modrinth" />Modrinth</SelectItem>
          <SelectItem value="curseforge"><SourceMark source="curseforge" />CurseForge</SelectItem>
          <SelectItem value="ftb"><SourceMark source="ftb" />FTB</SelectItem>
        </SelectContent>
      </Select>
      <Select value={type} onValueChange={value => { generation.current++; setBusy(false); setType(value as ModContentType); setResults([]) }}>
        <SelectTrigger size="sm" className="min-w-0 flex-1 rounded-xl border border-border bg-muted/50 text-xs text-foreground" aria-label={t("agent.contentType")}><SelectValue /></SelectTrigger>
        <SelectContent className="z-[120]" data-agent-composer-owner="agent-attach-menu">
          {(source === "ftb" ? ["modpack"] : ["mod", "modpack", "resourcepack", "shader"]).map(kind => <SelectItem value={kind} key={kind}>{t(`agent.content.${kind}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>}
    {error && <p className="agent-popover-error" role="alert">{error}</p>}
    <div className="agent-popover-list" aria-busy={busy}>
      {busy && <p className="agent-popover-loading" role="status"><IconLoader2 size={14} className="animate-spin" />{t("agent.loadingContent")}</p>}
      {view.kind === "root" && <><p className="agent-popover-section">{t("agent.attach.context")}</p>{rootItems.map(kind => { const Icon = ICONS[kind]; return <button key={kind} type="button" className="agent-menu-row" onClick={() => kind === "file" ? (onClose(), onFile()) : kind === "catalog" ? navigate({ kind: "catalog" }) : kind === "server" ? navigate({ kind: "servers" }) : choosePurpose(kind)}><Icon size={18} strokeWidth={1.75} className={`agent-attach-icon agent-attach-icon-${kind}`} /><span><strong>{t(`agent.attach.${kind}`)}</strong><small>{t(`agent.attach.${kind}Hint`)}</small></span><IconChevronRight size={14} /></button> })}{!rootItems.length && <p className="agent-menu-empty">{t("agent.noResults")}</p>}</>}
      {view.kind === "servers" && <>{servers.filter(server => filter(`${server.name} ${server.gameVersion} ${server.modloader} ${server.group || ""}`)).map(server => <button key={server.id} type="button" className="agent-menu-row" onClick={() => chooseServer(server)}><AgentEntityIcon src={server.icon} kind="server" name={server.name} /><span><strong>{server.name}</strong><small>{server.gameVersion} · {server.modloader} · :{server.port}</small></span>{chat?.attachments.some(item => item.id === `server:${server.id}`) ? <IconCheck size={15} className="text-primary" /> : <IconChevronRight size={14} />}</button>)}{!servers.filter(server => filter(`${server.name} ${server.gameVersion} ${server.modloader} ${server.group || ""}`)).length && <p className="agent-menu-empty">{servers.length ? t("agent.noResults") : t("agent.attach.noServers")}</p>}</>}
      {view.kind === "builds" && <>{builds.filter(build => filter(`${build.name} ${build.version} ${build.modLoader}`)).map(build => <button key={build.id} type="button" className="agent-menu-row agent-build-row" disabled={busy} onClick={() => void chooseBuild(build, view.purpose)}><AgentEntityIcon src={build.icon} kind="build" loader={build.modLoader} name={build.name} /><span><strong>{build.name}</strong><small><span>{build.version}</span><span className="mx-1.5 opacity-40">·</span><span className="agent-build-loader"><LoaderIcon loaderId={build.modLoader} />{loaderLabel(build.modLoader)}</span></small></span>{chat?.attachments.some(item => item.id === `build:${build.id}`) && view.purpose === "build" ? <IconCheck size={15} className="text-primary" /> : <IconChevronRight size={14} />}</button>)}{!builds.filter(build => filter(`${build.name} ${build.version} ${build.modLoader}`)).length && <p className="agent-menu-empty">{builds.length ? t("agent.noResults") : t("agent.noBuilds")}</p>}</>}
      {view.kind === "content" && <>{view.items.filter(item => filter(`${item.name} ${item.detail}`)).map(item => { return <button key={item.id} type="button" className="agent-menu-row" disabled={busy} onClick={() => void chooseEntry(item)}><AgentEntityIcon src={item.iconUrl} kind={view.purpose} name={item.name} /><span><strong>{item.name}</strong><small>{item.detail}</small></span>{chat?.attachments.some(attached => attached.id === item.id) && <IconCheck size={14} className="text-primary" />}</button> })}{!view.items.filter(item => filter(`${item.name} ${item.detail}`)).length && <p className="agent-menu-empty">{t("agent.attach.emptyContent")}</p>}</>}
      {view.kind === "catalog" && <>{results.map(project => <button key={`${project.source}:${project.id}`} type="button" className="agent-menu-row" disabled={busy} onClick={() => void chooseProject(project)}><AgentEntityIcon src={project.iconUrl} kind={type} name={project.name} /><span><strong>{project.name}</strong><small>{project.summary}</small></span><SourceMark source={project.source} /></button>)}{!results.length && <p className="agent-menu-empty">{t("agent.searchHint")}</p>}</>}
    </div>
    <div className="agent-popover-footer">{t("agent.attach.count", { count: chat?.attachments.length || 0, max: 8 })}</div>
  </>
}
