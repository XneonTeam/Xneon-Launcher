import { useContentEnter } from "../content-motion"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { IconRobot, IconArchive, IconArchiveOff, IconArrowLeft, IconPlus, IconTrash, IconPaperclip, IconArrowUp, IconPlayerStop, IconX, IconFolderPlus, IconAdjustmentsCog, IconSearch, IconBug, IconCheck, IconLoader2, IconSettings, IconShieldCheck, IconLayoutSidebar, IconCopy, IconAlertTriangle, IconChevronDown, IconChevronUp } from "@tabler/icons-react"
import type { AgentAttachment, AgentTimelineItem, DbBuildLight } from "@xnlc/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ActionConfirmDialog } from "../instance/action-confirm-dialog"
import { cn } from "@/lib/utils"
import { formatBytes } from "@/lib/format"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl } from "@/lib/home-page-shared"
import { AGENT_TOOLS, getAgentProject } from "./tools"
import { attachedProjectCards, assistantProjectContext, assistantResultCards, projectAnswerText, projectAnswerSections } from "./project-cards"
import { ComposerControls } from "./composer-controls"
import { answerAgentApproval, answerAgentQuestion, archiveAgentChat, attachToAgent, deleteAgentChat, initializeAgent, newAgentChat, removeAgentAttachment, selectAgentChat, sendAgentMessage, setAgentDraft, stopAgent, refreshAgentConfig, useAgentState } from "./store"
import { AgentEntityIcon } from "./entity-icon"
import { AgentPlan } from "./agent-plan"
import { EntityIcon } from "../instance/entity-icon"
import { LoaderIcon } from "../instance/loader-icon"
import { LOADER_SVG_ICONS } from "../instance/loader-icons"
import { CategoryBadge } from "../instance/category-badge"
import { SourceMark } from "../source-mark"
import { projectPageUrl, type ProjectKind } from "@/lib/project-links"
import { IconDownload, IconExternalLink, IconColorSwatch, IconPuzzle, IconPhoto, IconSparkles, IconDatabase, IconServer, IconCircle, IconBolt, IconPlant2, IconCpu, IconCompass, IconWand, IconBrandMinecraft } from "@tabler/icons-react"
import "./agent.css"
const AgentProjectDetailsModal = lazy(() => import("./project-details-modal"))

function AttachmentChip({ item, onRemove, onPreview }: { item: AgentAttachment; onRemove?: () => void; onPreview: () => void }) {
  const { t } = useTranslation()
  const category = item.id.startsWith("content:") ? item.id.split(":")[1] : item.id.startsWith("log:") ? "log" : item.id.startsWith("crash:") ? "crash" : item.kind
  let metadata: Record<string, unknown> = {}
  if (item.kind !== "file") { try { const parsed = JSON.parse(item.content); if (parsed && typeof parsed === "object") metadata = parsed } catch { /* Текстовые вложения могут не содержать JSON. */ } }
  const icon = item.iconUrl || (typeof metadata.icon_url === "string" ? metadata.icon_url : undefined)
  return <div className="agent-attachment" data-attachment-kind={category}>
    <button type="button" onClick={onPreview} className="flex min-w-0 items-center gap-2 text-left" title={item.name}>
      <AgentEntityIcon src={icon} kind={category} name={item.name} loader={typeof metadata.modLoader === "string" ? metadata.modLoader : undefined} className="agent-entity-icon-small" />
      <span className="agent-attachment-type">{t(`agent.attach.kind.${category}`)}</span><span className="agent-attachment-name">{item.name}</span>
    </button>
    {onRemove && <button type="button" className="agent-icon-button" aria-label={t("agent.removeAttachment")} onClick={onRemove}><IconX size={14} /></button>}
  </div>
}

function UserAvatar() {
  const { activeAccount, avatarVersion } = useAccounts()
  return <div className="agent-avatar agent-user-avatar" title={activeAccount?.username}>
    <CachedAvatar src={activeAccount ? getAvatarUrl(activeAccount, activeAccount.username, avatarVersion) : "avatar://head/Steve"} alt={activeAccount?.username || ""} className="h-full w-full object-cover" style={{ imageRendering: "pixelated" }} />
  </div>
}

function QuestionOptionIcon({ option, question, builds }: { option: string; question: string; builds: DbBuildLight[] }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  const direction = `${option} ${question}`.toLocaleLowerCase()
  const versionQuestion = /minecraft/.test(question.toLocaleLowerCase()) && /верс|version/.test(question.toLocaleLowerCase())
  const minecraftVersion = /^\s*(?:v)?\d+\.\d+(?:\.\d+)?(?:[- ]?(?:pre|rc)\s*\d+)?(?=$|[\s(])/i.test(option)
  const otherVersion = /другая версия|other version|different version/i.test(option)
  if (versionQuestion && (minecraftVersion || otherVersion)) return <IconBrandMinecraft size={18} strokeWidth={1.8} className="agent-question-option-icon text-primary" aria-hidden="true" />
  if (minecraftVersion) return null
  if (/modpack|модпак/.test(direction)) {
    const label = option.toLocaleLowerCase()
    const category = /optim|оптимизац|график|graphics/.test(label) ? { names: ["optimization", "visuals", "graphics"], Icon: IconBolt }
      : /vanilla|ванилл|удобств|quality.?of.?life|\bqol\b/.test(label) ? { names: ["vanilla-like", "utility", "game-mechanics"], Icon: IconPlant2 }
      : /adventure|приключ|исследован|exploration/.test(label) ? { names: ["adventure", "worldgen"], Icon: IconCompass }
      : /\brpg\b|рпг/.test(label) ? { names: ["adventure", "rpg"], Icon: IconCompass }
      : /techn|техник|механизм|automat|автоматизац/.test(label) ? { names: ["technology", "game-mechanics", "utility"], Icon: IconCpu }
      : /magic|магия|fantasy|фэнтез|фентез/.test(label) ? { names: ["magic", "fantasy"], Icon: IconWand }
      : /hardcore|хардкор/.test(label) ? { names: ["challenging", "survival"], Icon: IconBolt }
      : /survival|выжив/.test(label) ? { names: ["survival", "challenging"], Icon: IconPlant2 }
      : null
    if (category) return <CategoryBadge name={category.names} iconOnly fallbackIcon={<category.Icon size={18} strokeWidth={1.8} aria-hidden="true" />} />
  }
  // Пояснения и составные подписи («Vanilla (ванильный)», «Paper / Spigot»)
  // сохраняют иконку первого указанного загрузчика из общего реестра.
  const loaderToken = option.trim().toLocaleLowerCase().match(/^([a-z]+)(?=$|[\s(/])/)?.[1]
  const loaderAliases: Record<string, string> = {
    neoforged: "neoforge",
    spongevanilla: "sponge",
    spongeforge: "sponge",
    spongeneo: "sponge",
  }
  const loaderId = loaderToken && (loaderAliases[loaderToken] ?? loaderToken)
  const loader = loaderId && Object.hasOwn(LOADER_SVG_ICONS, loaderId) ? loaderId : undefined
  if (loader) return <span className="agent-question-option-icon flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true"><LoaderIcon loaderId={loader} className="h-5 w-5 text-primary" /></span>
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ")
  const matches = builds.filter(build => [build.id, build.name, `${build.name} (${build.version})`].some(value => normalize(value) === normalize(option)))
  const build = matches.length === 1 ? matches[0] : undefined
  if (build) return <span className="agent-question-option-icon h-6 w-6 overflow-hidden rounded flex items-center justify-center" aria-hidden="true">
    {build.icon && failedIcon !== build.icon
      ? <EntityIcon src={build.icon} className="h-full w-full text-primary object-cover" imgClassName="h-full w-full object-cover" onImgError={() => setFailedIcon(build.icon)} />
      : <LoaderIcon loaderId={build.modLoader || "vanilla"} className="h-5 w-5 text-primary" />}
  </span>
  const text = option.toLocaleLowerCase()
  const Icon = /shader|шейдер|шэйдер/.test(text) ? IconSparkles
    : /resource.?pack|texture|ресурс.?пак|текстур/.test(text) ? IconPhoto
    : /data.?pack|дата.?пак/.test(text) ? IconDatabase
    : /\bmods?\b|моды|моді|моди|геймплей|qol/.test(text) ? IconPuzzle
    : /server|сервер/.test(text) ? IconServer
    : /build|modpack|instance|сборк|збірк|сборок/.test(text + " " + question.toLocaleLowerCase()) ? IconColorSwatch
    : IconCircle
  return <Icon size={18} strokeWidth={1.75} className="agent-question-option-icon text-primary" aria-hidden="true" />
}

function AgentQuestion({ item }: { item: AgentTimelineItem }) {
  const { t } = useTranslation()
  const state = useAgentState()
  const [answer, setAnswer] = useState("")
  const [localSubmitted, setLocalSubmitted] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [builds, setBuilds] = useState<DbBuildLight[]>([])
  useEffect(() => {
    let cancelled = false
    void window.electronAPI?.loadBuildsLight().then(value => {
      if (!cancelled) setBuilds(value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [item.id])
  let question = "", options: string[] = [], submitted = ""
  try { const input = JSON.parse(item.input || "{}"); question = String(input.question || ""); options = Array.isArray(input.options) ? input.options.filter((value: unknown) => typeof value === "string").slice(0, 6) : [] } catch { /* Старый чат может содержать некорректный вызов. */ }
  try { submitted = String(JSON.parse(item.output || "{}").answer || "") } catch { /* Ответ ещё не получен. */ }
  submitted = localSubmitted || submitted
  const pending = state.questionId === item.id && !state.stopping
  const resolved = Boolean(submitted) || item.status === "denied"
  const compact = resolved && !expanded
  const submitAnswer = (value: string) => {
    setLocalSubmitted(value)
    answerAgentQuestion(item.id, value)
  }
  if (compact) return <section className="agent-question agent-question-collapsed" aria-label={t("agent.question.title")}>
    <button type="button" className="agent-question-summary" aria-expanded={false} aria-label={t("agent.question.expand")} onClick={() => setExpanded(true)}>
      {submitted ? <IconCheck size={16} className="shrink-0 text-primary" aria-hidden="true" /> : <IconAlertTriangle size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="agent-question-summary-text">{submitted || t("agent.question.cancelled")}</span>
      <IconChevronDown size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  </section>
  return <section className="agent-question" aria-label={t("agent.question.title")}>
    <div className="flex items-center justify-between gap-3">
      <p className="agent-question-label">{t("agent.question.title")}</p>
      {resolved && <button type="button" className="agent-question-collapse" aria-expanded={true} aria-label={t("agent.question.collapse")} onClick={() => setExpanded(false)}><IconChevronUp size={15} /></button>}
    </div>
    <h3>{question}</h3>
    {!!options.length && <div className="agent-question-options">{options.map(option => <button key={option} type="button" disabled={!pending} aria-pressed={submitted === option} onClick={() => submitAnswer(option)}><QuestionOptionIcon option={option} question={question} builds={builds} /><span className="agent-question-option-text">{option}</span>{submitted === option && <IconCheck size={15} className="shrink-0" aria-hidden="true" />}</button>)}</div>}
    {pending ? <form onSubmit={event => { event.preventDefault(); submitAnswer(answer) }} className="agent-question-form"><input value={answer} onChange={event => setAnswer(event.target.value)} maxLength={6000} aria-label={t("agent.question.answer")} placeholder={t("agent.question.answer")} /><button type="submit" className="agent-primary" disabled={!answer.trim()}>{t("agent.question.submit")}</button></form> : <p className="agent-question-result">{submitted || t("agent.question.cancelled")}</p>}
  </section>
}

function AgentToolProgress({ itemId }: { itemId: string }) {
  const { t, i18n } = useTranslation()
  const { progress } = useAgentState()
  if (!progress || progress.itemId !== itemId) return null
  const format = (value: number) => progress.bytes ? formatBytes(value) : value.toLocaleString(i18n.language)
  return <div className="agent-install-progress">
    <div className="agent-install-progress-heading"><span title={progress.message}>{progress.message}</span><strong>{progress.percent === null ? "…" : progress.percent + "%"}</strong></div>
    <div className="agent-install-progress-track" role="progressbar" aria-label={t("agent.progress.title")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined} aria-valuetext={progress.message}><span className={progress.percent === null ? "agent-install-progress-indeterminate" : ""} style={progress.percent === null ? undefined : { width: progress.percent + "%" }} /></div>
    <div className="agent-install-progress-meta"><span title={progress.fileName}>{progress.fileName}</span>{progress.total > 0 && <span>{format(progress.current)} / {format(progress.total)}</span>}</div>
  </div>
}

type ProjectToolCard = Record<string, unknown> & { name: string; iconUrl: string; kind: string }

function projectForTool(item: AgentTimelineItem, timeline: AgentTimelineItem[]): ProjectToolCard | null {
  if (!["install_content", "get_project_versions"].includes(item.toolName || "")) return null
  let input: Record<string, unknown>
  try { input = JSON.parse(item.input || "{}") } catch { return null }
  const source = String(input.source || "").toLocaleLowerCase()
  const projectId = String(input.projectId || "").toLocaleLowerCase()
  if (!source || !projectId) return null
  for (let index = timeline.indexOf(item) - 1; index >= 0; index--) {
    const candidate = timeline[index]
    if (candidate.kind !== "tool" || candidate.status !== "done" || !candidate.output || !["get_project", "search_projects"].includes(candidate.toolName || "")) continue
    try {
      const output = JSON.parse(candidate.output) as Record<string, unknown>
      const projects = candidate.toolName === "search_projects" && Array.isArray(output.results) ? output.results as Array<Record<string, unknown>> : [output]
      const match = projects.find(project => {
        if (String(project.source || "").toLocaleLowerCase() !== source) return false
        return [project.projectId, project.modId, project.id, project.slug].some(value => String(value || "").toLocaleLowerCase() === projectId)
      })
      if (match) return {
        ...match,
        name: String(match.name || projectId),
        iconUrl: String(match.iconUrl || match.icon_url || ""),
        summary: String(match.summary || match.description || match.shortDescription || ""),
        kind: String(input.type || match.contentType || "mod"),
      }
    } catch { /* Переходим к более раннему результату каталога. */ }
  }
  return { name: projectId, iconUrl: "", kind: String(input.type || "mod") }
}

function ToolActionDescription({ item, project }: { item: AgentTimelineItem; project: ProjectToolCard | null }) {
  const { t } = useTranslation()
  const [build, setBuild] = useState<DbBuildLight | undefined>()
  let input: Record<string, unknown> = {}
  try { input = JSON.parse(item.input || "{}") } catch { /* Подробности доступны отдельно. */ }
  const buildId = typeof input.buildId === "string" ? input.buildId : undefined
  useEffect(() => {
    let cancelled = false
    setBuild(undefined)
    if (buildId) void window.electronAPI?.loadBuildsLight().then(builds => { if (!cancelled) setBuild(builds.find(candidate => candidate.id === buildId)) }).catch(() => {})
    return () => { cancelled = true }
  }, [buildId])
  return <div className="space-y-2 text-xs">
    {project && <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3">
      <AgentEntityIcon src={project.iconUrl} kind={project.kind} name={project.name} className="h-8 w-8 shrink-0" />
      <div className="min-w-0"><p className="font-medium text-foreground">{project.name}</p>{typeof project.summary === "string" && project.summary && <p className="agent-project-summary">{project.summary}</p>}</div>
    </div>}
    {item.toolName === "install_content" && <p className="text-muted-foreground">{t("agent.action.installDescription")}</p>}
    {build && <p className="text-muted-foreground">{t("agent.action.targetBuild", { name: build.name, version: build.version })}</p>}
  </div>
}

function TimelineItem({ item, timeline, onPreview, pending, context = [], projects = [] }: { item: AgentTimelineItem; timeline: AgentTimelineItem[]; onPreview: (item: AgentAttachment) => void; pending: boolean; context?: AgentAttachment[]; projects?: Array<Record<string, unknown>> }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const label = item.toolName ? t(`agent.tools.${item.toolName}`, { defaultValue: item.toolName }) : ""
  const project = projectForTool(item, timeline)
  if (item.kind === "tool" && item.toolName === "ask_user") return <AgentQuestion item={item} />
  if (item.kind === "tool" && item.toolName === "update_plan") return null
  if (item.kind === "tool") return <div className={cn("agent-tool", item.status === "approval" && "agent-tool-approval")}>
    <details className="agent-tool-details" open={item.status === "approval" || item.status === "error"}>
      <summary className="flex cursor-pointer items-center gap-2 text-xs">
        {item.status === "running" ? <IconLoader2 size={15} className="animate-spin text-primary" /> : item.status === "done" ? <IconCheck size={15} className="text-success" /> : item.status === "approval" ? <IconShieldCheck size={15} className="text-primary" /> : <IconAlertTriangle size={15} className="text-warning" />}
        {project && <AgentEntityIcon src={project.iconUrl} kind={project.kind} name={project.name} className="agent-entity-icon-small agent-tool-summary-icon" />}
        <span className="flex-1 font-medium">{project ? `${label}: ${project.name}` : label}</span><span className="text-muted-foreground">{t(`agent.status.${item.status}`)}</span>
      </summary>
      <div className="mt-3 space-y-2">
        <ToolActionDescription item={item} project={project} />
        <details><summary className="cursor-pointer text-[11px] text-muted-foreground">{t("agent.action.technicalDetails")}</summary><pre className="agent-json mt-2">{(() => { try { return JSON.stringify(JSON.parse(item.input || "{}"), null, 2) } catch { return item.input } })()}</pre></details>
        {item.output && <details><summary className="cursor-pointer text-xs text-muted-foreground">{t("agent.result")}</summary><pre className="agent-json mt-2">{item.output}</pre></details>}
      </div>
      {item.status === "done" && <ProjectResults item={item} />}
    </details>
    {item.status === "running" && <AgentToolProgress itemId={item.id} />}
    {pending && <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/50 pt-3">
      <button className="agent-secondary" type="button" onClick={() => answerAgentApproval(false)}>{t("agent.deny")}</button>
      <button className="agent-primary" type="button" onClick={() => answerAgentApproval(true)}><IconCheck size={14} />{t("agent.allow")}</button>
    </div>}
  </div>
  if (item.kind === "error" || item.kind === "stopped") return <div className={cn("text-xs px-3 py-2 rounded-lg", item.kind === "error" ? "bg-destructive/10 text-destructive" : "text-muted-foreground")} role={item.kind === "error" ? "alert" : undefined}>{item.text}</div>
  if (item.kind === "assistant" && !item.text && item.status !== "running") return null
  const cardNames = projects.length ? projects.map(project => String(project.name || "")) : context.filter(attachment => attachment.kind === "project").map(attachment => attachment.name)
  const answerText = item.kind === "assistant" ? projectAnswerText(item.text, cardNames) : item.text
  const sections = projectAnswerSections(projects.length ? item.text : answerText, item.kind === "assistant" ? projects : [])
  return <article className={cn("agent-message", item.kind === "user" && "agent-message-user")}>
    {item.kind === "assistant" && <div className="agent-avatar"><IconRobot size={17} /></div>}
    <div className="min-w-0 max-w-full">
      {item.kind === "assistant" && !projects.length && !!context.length && <AttachedProjectCards attachments={context} />}
      {item.kind === "user" ? <div className="agent-user-bubble whitespace-pre-wrap">{item.text}</div> : <div className="agent-markdown">
        {item.text ? sections.map((section, index) => <div key={index} className="agent-project-section">{section.project && <div className="agent-project-mention"><AgentEntityIcon src={typeof section.project.iconUrl === "string" ? section.project.iconUrl : typeof section.project.icon_url === "string" ? section.project.icon_url : undefined} kind={String(section.project.contentType || section.project.kind || "mod")} name={String(section.project.name || "")} /><span>{String(section.project.name || "")}</span></div>}<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
          a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href && /^https?:\/\//.test(href)) void window.electronAPI?.openExternal(href) }}>{children}</a>,
          img: ({ alt }) => cardNames.length ? null : <span className="text-muted-foreground">{alt}</span>,
        }}>{section.text}</ReactMarkdown></div>) : <span className="inline-flex items-center gap-2 text-muted-foreground"><IconLoader2 size={15} className="animate-spin" />{t("agent.thinking")}</span>}
        {item.status === "running" && item.text && <span className="agent-cursor" />}
      </div>}
      {!!item.attachments?.length && <div className="mt-2 flex flex-wrap gap-2">{item.attachments.map(attachment => <AttachmentChip key={attachment.id} item={attachment} onPreview={() => onPreview(attachment)} />)}</div>}
      {item.kind === "assistant" && item.status !== "running" && <button type="button" className="agent-copy mt-2" title={t("agent.copy")} aria-label={t("agent.copy")} onClick={() => { void navigator.clipboard.writeText(item.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</button>}
    </div>
    {item.kind === "user" && <UserAvatar />}
  </article>
}

function isMergeableTool(item: AgentTimelineItem) {
  return item.kind === "tool" && ["get_project", "search_projects", "get_project_versions", "install_content"].includes(item.toolName || "")
}

function groupTimeline(timeline: AgentTimelineItem[]): Array<AgentTimelineItem | AgentTimelineItem[]> {
  const result: Array<AgentTimelineItem | AgentTimelineItem[]> = []
  const groupedToolIds = new Set<string>()
  const toolGroupsAt = new Map<number, AgentTimelineItem[]>()

  // Агент часто разбивает поиск, проверку совместимости и установку на несколько
  // ответов модели. Группируем одинаковые действия в один блок за пользовательский
  // ход, даже если между вызовами были обычные сообщения агента.
  for (let turnStart = 0; turnStart < timeline.length;) {
    const nextUser = timeline.findIndex((item, index) => index > turnStart && item.kind === "user")
    const turnEnd = nextUser < 0 ? timeline.length : nextUser
    const byTool = new Map<string, Array<{ item: AgentTimelineItem; index: number }>>()
    for (let index = turnStart; index < turnEnd; index++) {
      const item = timeline[index]
      if (!isMergeableTool(item) || item.status !== "done") continue
      const group = byTool.get(item.toolName!) ?? []
      group.push({ item, index })
      byTool.set(item.toolName!, group)
    }
    for (const group of byTool.values()) {
      if (group.length < 2) continue
      group.forEach(({ item }) => groupedToolIds.add(item.id))
      toolGroupsAt.set(group[group.length - 1].index, group.map(({ item }) => item))
    }
    turnStart = turnEnd
  }

  for (let index = 0; index < timeline.length; index++) {
    const groupedTools = toolGroupsAt.get(index)
    if (groupedTools) result.push(groupedTools)
    if (groupedToolIds.has(timeline[index].id)) continue
    if (!isMergeableTool(timeline[index]) || timeline[index].status !== "done") { result.push(timeline[index]); continue }
    const start = index
    while (index + 1 < timeline.length && !groupedToolIds.has(timeline[index + 1].id) && isMergeableTool(timeline[index + 1]) && timeline[index + 1].status === "done") index++
    result.push(index > start ? timeline.slice(start, index + 1) : timeline[start])
  }
  return result
}

function ProjectLookupGroup({ items, timeline }: { items: AgentTimelineItem[]; timeline: AgentTimelineItem[] }) {
  const { t } = useTranslation()
  const status = items.some(item => item.status === "running") ? "running"
    : items.some(item => item.status === "approval") ? "approval"
    : items.some(item => item.status === "error" || item.status === "denied") ? "error"
    : "done"
  const projects: Array<Record<string, unknown>> = []
  const seenProjects = new Set<string>()
  const requests = new Map<string, { label: string; count: number }>()
  const firstTool = items[0].toolName
  const requestLabel = (item: AgentTimelineItem) => {
    try {
      const input = JSON.parse(item.input || "{}") as Record<string, unknown>
      const value = String(input.query || input.projectId || input.slug || input.id || input.version || "")
      const source = String(input.source || "")
      return [source, value].filter(Boolean).join(" · ") || t(`agent.tools.${item.toolName}`, { defaultValue: item.toolName })
    } catch { return t(`agent.tools.${item.toolName}`, { defaultValue: item.toolName }) }
  }
  for (const item of items) {
    try {
      const input = JSON.parse(item.input || "{}") as Record<string, unknown>
      const value = String(input.query || input.projectId || input.slug || input.id || input.version || "")
      const source = String(input.source || "")
      const label = [source, value].filter(Boolean).join(" · ") || t(`agent.tools.${item.toolName}`, { defaultValue: item.toolName })
      const requestKey = label.toLocaleLowerCase().replace(/\s+/g, " ").trim()
      const request = requests.get(requestKey)
      if (request) request.count++
      else requests.set(requestKey, { label, count: 1 })
    } catch { /* Некорректный ввод не ломает объединённую запись. */ }
    if (["get_project_versions", "install_content"].includes(item.toolName || "")) {
      const relatedProject = projectForTool(item, timeline)
      if (relatedProject?.name) {
        const key = `${relatedProject.source || ""}:${relatedProject.projectId || relatedProject.modId || relatedProject.id || relatedProject.name}`.toLocaleLowerCase()
        if (!seenProjects.has(key)) { seenProjects.add(key); projects.push(relatedProject) }
      }
    }
    if (item.status !== "done" || !item.output) continue
    try {
      const output = JSON.parse(item.output) as Record<string, unknown>
      const result = item.toolName === "search_projects" && Array.isArray(output.results) ? output.results : [output]
      for (const project of result as Array<Record<string, unknown>>) {
        if (!project || typeof project.name !== "string") continue
        const key = `${project.source}:${project.projectId || project.modId || project.id || project.slug || project.name}`.toLocaleLowerCase()
        if (seenProjects.has(key)) continue
        seenProjects.add(key)
        projects.push(project)
      }
    } catch { /* Неуспешный ответ остаётся доступен в исходном результате запроса. */ }
  }
  const Icon = status === "running" ? IconLoader2 : status === "error" ? IconAlertTriangle : IconCheck
  const sameTool = items.every(item => item.toolName === firstTool)
  const label = sameTool && firstTool === "get_project" ? "agent.tools.projectLookupCards"
    : sameTool && firstTool === "get_project_versions" ? "agent.tools.projectLookupVersions"
    : sameTool && firstTool === "install_content" ? "agent.tools.projectLookupInstalls"
    : "agent.tools.projectLookupSearches"
  const icons = items.map(item => projectForTool(item, timeline)).filter((project): project is NonNullable<typeof project> => project !== null)
  const uniqueIcons = [...new Map(icons.map(project => [`${project.name}:${project.iconUrl}`, project])).values()]
  return <details className={cn("agent-tool", status === "error" && "agent-tool-approval")} open={status === "error"}>
    <summary className="flex cursor-pointer items-center gap-2 text-xs">
      <Icon size={15} className={cn(status === "running" && "animate-spin", status === "done" ? "text-success" : status === "error" ? "text-warning" : "text-primary")} />
      {uniqueIcons.slice(0, 3).map((project, index) => <AgentEntityIcon key={`${project.name}:${index}`} src={project.iconUrl} kind={project.kind} name={project.name} className="agent-entity-icon-small -ml-1 first:ml-0" />)}
      {uniqueIcons.length > 3 && <span className="text-[10px] text-muted-foreground">+{uniqueIcons.length - 3}</span>}
      <span className="flex-1 font-medium">{t(label, { count: items.length })}</span>
      <span className="text-muted-foreground">{t(`agent.status.${status}`)}</span>
    </summary>
    <div className="mt-3 space-y-3">
      {!projects.length && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {[...requests.values()].map(request => <span key={request.label}>{request.label}{request.count > 1 ? ` ×${request.count}` : ""}</span>)}
      </div>}
      {!!projects.length && <ProjectCards projects={projects} limit={projects.length} />}
      {items.filter(item => !["get_project", "search_projects"].includes(item.toolName || "") && !(projects.length && ["get_project_versions", "install_content"].includes(item.toolName || "") && item.status === "done")).map(item => <details key={item.id} className="rounded-lg border border-border/60 px-3 py-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">{requestLabel(item)}</summary>
        <div className="mt-2 space-y-2">
          <pre className="agent-json">{(() => { try { return JSON.stringify(JSON.parse(item.input || "{}"), null, 2) } catch { return item.input || "" } })()}</pre>
          {item.output && <pre className="agent-json">{item.output}</pre>}
        </div>
      </details>)}
      {items.filter(item => item.status === "error" || item.status === "denied").map(item => <pre key={item.id} className="agent-json">{item.output || item.text}</pre>)}
    </div>
  </details>
}

function ProjectResults({ item }: { item: AgentTimelineItem }) {
  if (!["get_project", "search_projects"].includes(item.toolName || "") || !item.output) return null
  let projects: Array<Record<string, unknown>>
  try {
    const output = JSON.parse(item.output) as Record<string, unknown>
    projects = item.toolName === "search_projects" && Array.isArray(output.results) ? output.results : [output]
  } catch { return null }
  return <ProjectCards projects={projects} />
}

function ProjectCards({ projects, limit = 4 }: { projects: Array<Record<string, unknown>>; limit?: number }) {
  const { t, i18n } = useTranslation()
  const [details, setDetails] = useState<Record<string, unknown> | null>(null)
  return <><div className="agent-project-list">{projects.slice(0, limit).filter(project => typeof project.name === "string").map(project => {
    const projectId = String((project.source === "curseforge" ? project.modId || project.projectId || project.id : project.projectId || project.id) || "")
    const remote = (project.source === "modrinth" || project.source === "curseforge" || project.source === "ftb") && !!projectId && (!String(project.attachmentId || "").startsWith("content:") || !!project.projectId || !!project.modId)
    const kind = ["mod", "modpack", "resourcepack", "shader", "datapack", "plugin"].includes(String(project.contentType)) ? project.contentType as ProjectKind : "mod"
    const url = remote ? projectPageUrl({ source: String(project.source), slug: typeof project.slug === "string" ? project.slug : undefined, projectId }, kind) : null
    const downloads = project.downloadCount ?? project.downloads
    return <div key={`${project.source}:${projectId}`} className="agent-project-card">
      <div className="agent-project-heading">
        <AgentEntityIcon src={typeof project.iconUrl === "string" ? project.iconUrl : undefined} kind={kind} name={String(project.name)} className="agent-project-image" />
        <div className="min-w-0 flex-1"><button type="button" className="agent-project-title" title={t("builds.details")} disabled={!remote} onClick={() => setDetails(project)}>{String(project.name)}</button><span className="agent-project-provider"><SourceMark source={String(project.source)} />{project.source === "modrinth" ? "Modrinth" : project.source === "curseforge" ? "CurseForge" : project.source === "ftb" ? "FTB" : t(`agent.attach.${kind}`)}{typeof downloads === "number" && <span><IconDownload size={12} />{new Intl.NumberFormat(i18n.language, { notation: "compact" }).format(downloads)}</span>}</span></div>
        {url && <button type="button" className="agent-icon-button" title={t("agent.openProject")} aria-label={t("agent.openProject")} onClick={() => void window.electronAPI?.openExternal(url)}><IconExternalLink size={16} /></button>}
      </div>
      {(typeof project.version === "string" || typeof project.buildName === "string") && <div className="agent-project-tags">{typeof project.version === "string" && <span>{project.version}</span>}{typeof project.buildName === "string" && <span>{project.buildName}</span>}</div>}
      {typeof project.summary === "string" && project.summary.trim() && <p className="agent-project-summary">{project.summary}</p>}
      <button className="agent-project-attach" type="button" onClick={() => attachToAgent({ id: String(project.attachmentId || `${project.source}:${projectId}`), kind: "project", name: String(project.name), source: remote ? project.source as "modrinth" | "curseforge" | "ftb" : undefined, projectId: remote ? projectId : undefined, iconUrl: typeof project.iconUrl === "string" ? project.iconUrl : undefined, content: JSON.stringify(project) })}><IconPaperclip size={14} />{t("agent.addContext")}</button>
    </div>
  })}</div>
    {details && <Suspense fallback={null}><AgentProjectDetailsModal project={details} onClose={() => setDetails(null)} /></Suspense>}
  </>
}

function AttachedProjectCards({ attachments }: { attachments: AgentAttachment[] }) {
  const [projects, setProjects] = useState<Array<Record<string, unknown>>>(() => attachedProjectCards(attachments))
  useEffect(() => {
    let cancelled = false
    const local = attachedProjectCards(attachments)
    setProjects(local)
    void Promise.all(local.map(async project => {
      const id = project.source === "curseforge" ? project.modId || project.projectId : project.projectId
      if (!window.electronAPI || !id || !["modrinth", "curseforge", "ftb"].includes(String(project.source))) return project
      try { return { ...project, ...await getAgentProject(window.electronAPI, String(project.source), String(id)), version: project.version, buildName: project.buildName, attachmentId: project.attachmentId, contentType: project.contentType } } catch { return project }
    })).then(items => { if (!cancelled) setProjects(items) })
    return () => { cancelled = true }
  }, [attachments])
  return <ProjectCards projects={projects} />
}

export function AgentPage() {
  const { t, i18n } = useTranslation()
  const state = useAgentState()
  const contentEnter = useContentEnter(!state.loading)
  const { chat, running } = state
  const [preview, setPreview] = useState<AgentAttachment | null>(null)
  const [previewProject, setPreviewProject] = useState<Record<string, unknown> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(() => window.innerWidth >= 1400)
  const [showArchive, setShowArchive] = useState(false)
  const visibleChats = state.chats.filter(item => !!item.archived === showArchive)
  const archivedCount = state.chats.filter(item => item.archived).length
  const [config, setConfig] = useState<{ ready: boolean; model: string } | null>(null)
  const [modelSaving, setModelSaving] = useState(false)
  const [localError, setLocalError] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)
  const messages = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    void initializeAgent()
    const refresh = () => { void refreshAgentConfig().then(value => { if (value) setConfig({ ready: !!value.apiKey || value.protocol === "ollama" || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(value.endpoint), model: value.model }) }).catch(error => setLocalError(String(error))) }
    refresh()
    const pickFiles = () => fileInput.current?.click()
    window.addEventListener("launcher:agent-pick-files", pickFiles)
    window.addEventListener("agent:config-updated", refresh)
    return () => { window.removeEventListener("agent:config-updated", refresh); window.removeEventListener("launcher:agent-pick-files", pickFiles) }
  }, [])
  useEffect(() => { if (messages.current && atBottom.current) messages.current.scrollTop = messages.current.scrollHeight }, [chat?.timeline, state.pendingId])
  useEffect(() => { atBottom.current = true; if (messages.current) messages.current.scrollTop = messages.current.scrollHeight }, [chat?.id])
  useEffect(() => { if (composer.current) { composer.current.style.height = "auto"; composer.current.style.height = `${Math.min(composer.current.scrollHeight, 160)}px` } }, [chat?.draft])
  const readFiles = async (files: FileList | File[]) => {
    setLocalError("")
    for (const file of Array.from(files)) {
      if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        if (!state.config?.models?.find(item => item.id === state.config?.model)?.supportsImages) { setLocalError(t("agent.imageUnsupported")); continue }
        if (file.size > 2_000_000) { setLocalError(t("agent.imageTooLarge")); continue }
        try {
          const imageUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
          attachToAgent({ id: crypto.randomUUID(), kind: "file", name: file.name, content: t("agent.imageAttachment"), imageUrl, iconUrl: imageUrl })
        } catch (error) { setLocalError(String(error)) }
        continue
      }
      if (file.size > 1_000_000 || !/\.(log|txt|md|json|json5|toml|cfg|conf|properties|yaml|yml)$/i.test(file.name)) { setLocalError(t("agent.fileError")); continue }
      try {
        const content = await file.text()
        if (content.includes("\0")) { setLocalError(t("agent.fileError")); continue }
        attachToAgent({ id: crypto.randomUUID(), kind: "file", name: file.name, content })
      } catch (error) { setLocalError(String(error)) }
    }
  }
  const showPreview = (attachment: AgentAttachment) => {
    const project = attachedProjectCards([attachment])[0]
    if (project && ["modrinth", "curseforge", "ftb"].includes(String(project.source)) && (project.projectId || project.modId || project.id || project.slug)) setPreviewProject(project)
    else setPreview(attachment)
  }
  const settings = () => window.dispatchEvent(new CustomEvent("launcher:open-settings", { detail: { tab: "ai" } }))
  const selectModel = async (model: string) => {
    const api = window.electronAPI
    if (!api) throw new Error("Electron API unavailable")
    setModelSaving(true)
    try {
      const config = await api.getAiConfig()
      if (!config.models?.some(item => item.id === model)) throw new Error(t("ai.library.invalid"))
      await api.saveAiConfig({ ...config, model })
      await refreshAgentConfig()
      setConfig(current => current ? { ...current, model } : { ready: false, model })
    } finally { setModelSaving(false) }
  }
  const guarded = (action: () => Promise<unknown>) => { void action().catch(error => setLocalError(String(error))) }
  return <div className={cn("agent-page", contentEnter)} id="agent-page" data-component="xneon-agent" onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault() }} onDrop={event => { event.preventDefault(); void readFiles(event.dataTransfer.files) }}>
    <header className="agent-header">
      <div className="flex items-center gap-3"><div className="agent-brand"><IconRobot size={22} stroke={1.7} /></div><div><h1 className="text-xl font-bold tracking-tight">{t("agent.title")}</h1><p className="text-xs text-muted-foreground">{t("agent.subtitle")}</p></div></div>
      <div className="flex w-fit items-center gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-1">
        <button type="button" className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium text-muted-foreground transition-all duration-200 hover:bg-muted/80 hover:text-foreground" aria-label={t("agent.configure")} title={t("agent.configure")} onClick={settings}><IconSettings className="h-4 w-4" strokeWidth={1.75} /><span>{t("agent.configure")}</span></button>
        {chat && <button type="button" className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium text-muted-foreground transition-all duration-200 hover:bg-muted/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45" disabled={running} title={t("agent.deleteChat")} aria-label={t("agent.deleteChat")} onClick={() => setDeleteId(chat.id)}><IconTrash className="h-4 w-4" strokeWidth={1.75} /><span>{t("agent.deleteChat")}</span></button>}
      </div>
    </header>
    <div className="agent-workspace">
      {showHistory && <aside className="agent-history">
        <button type="button" className="agent-primary w-full justify-center" disabled={running || state.loading} onClick={() => { setShowArchive(false); guarded(() => newAgentChat()) }}><IconPlus size={16} />{t("agent.newChat")}</button>
        <div className="mt-6 mb-2 flex justify-between px-2 text-[10px] uppercase tracking-widest text-muted-foreground"><span>{t(showArchive ? "agent.archive.title" : "agent.chats")}</span><span>{visibleChats.length}</span></div>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-1">{visibleChats.map(item => <div className={cn("agent-chat-row group", item.id === chat?.id && "agent-chat-active")} key={item.id}><button className="min-w-0 flex-1 py-3 pl-3 text-left" disabled={running || state.loading} onClick={() => guarded(() => selectAgentChat(item.id))}><span className="block truncate text-xs font-medium">{item.title}</span><span className="block mt-1 text-[10px] text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString(i18n.language, { day: "numeric", month: "short" })}</span></button><button type="button" className="agent-icon-button opacity-0 group-hover:opacity-100 focus-visible:opacity-100" disabled={running || state.loading} title={t(item.archived ? "agent.archive.restore" : "agent.archive.action")} aria-label={t(item.archived ? "agent.archive.restore" : "agent.archive.action")} onClick={() => guarded(() => archiveAgentChat(item.id, !item.archived))}>{item.archived ? <IconArchiveOff size={13} /> : <IconArchive size={13} />}</button><button type="button" className="agent-icon-button opacity-0 group-hover:opacity-100 focus-visible:opacity-100" disabled={running} title={t("agent.deleteChat")} aria-label={t("agent.deleteChat")} onClick={() => setDeleteId(item.id)}><IconTrash size={13} /></button></div>)}</div>
        {!visibleChats.length && <p className="px-2 py-3 text-xs text-muted-foreground">{t(showArchive ? "agent.archive.empty" : "agent.archive.noActive")}</p>}
        <button type="button" className="agent-history-archive" aria-pressed={showArchive} onClick={() => setShowArchive(value => !value)}>{showArchive ? <IconArrowLeft size={15} /> : <IconArchive size={15} />}<span>{t(showArchive ? "agent.archive.back" : "agent.archive.title")}</span>{!showArchive && <span className="ml-auto text-[10px]">{archivedCount}</span>}</button>
      </aside>}
      <section className="agent-conversation">
        <div className="agent-conversation-toolbar"><button type="button" className="agent-icon-button" aria-label={t("agent.toggleHistory")} title={t("agent.toggleHistory")} onClick={() => setShowHistory(value => !value)}><IconLayoutSidebar size={17} /></button><span className="truncate text-xs text-muted-foreground">{chat?.title}</span></div>
        {!state.loading && chat?.timeline.length ? <AgentPlan timeline={chat.timeline} /> : null}
        <div ref={messages} onScroll={() => { const el = messages.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }} className="agent-messages" aria-busy={running}>
          {state.loading ? <div className="flex h-full items-center justify-center"><IconLoader2 className="animate-spin text-primary" /></div> : <div className="agent-timeline">
            {!chat?.timeline.length && <div className="agent-empty"><div className="agent-empty-symbol"><IconRobot size={28} stroke={1.75} /></div><p className="agent-empty-label">{t("agent.title")}</p><h2>{t("agent.welcome")}</h2><p className="agent-empty-description">{t("agent.welcomeDescription")}</p><div className="agent-suggestions">{([ ["create", IconFolderPlus], ["optimize", IconAdjustmentsCog], ["find", IconSearch], ["diagnose", IconBug] ] as const).map(([key, Icon]) => <button key={key} type="button" onClick={() => { setAgentDraft(t(`agent.suggestion.${key}.prompt`)); composer.current?.focus() }}><span className="text-primary"><Icon size={17} strokeWidth={1.75} /></span><span>{t(`agent.suggestion.${key}.label`)}</span></button>)}</div></div>}
            {chat && groupTimeline(chat.timeline).map(entry => Array.isArray(entry)
              ? <ProjectLookupGroup key={entry[0].id} items={entry} timeline={chat.timeline} />
              : <TimelineItem key={entry.id} timeline={chat.timeline} context={assistantProjectContext(chat.timeline, chat.timeline.indexOf(entry))} projects={assistantResultCards(chat.timeline, chat.timeline.indexOf(entry))} item={entry} onPreview={showPreview} pending={state.pendingId === entry.id} />)}
          </div>}
        </div>
        {chat?.archived ? <div className="agent-composer-area"><div className="agent-config-banner"><IconArchive size={18} /><span className="flex-1">{t("agent.archive.readOnly")}</span><button type="button" className="agent-primary" disabled={state.loading} onClick={() => guarded(() => archiveAgentChat(chat.id, false))}>{t("agent.archive.restore")}</button></div></div> : <div className="agent-composer-area">
          {config && !config.ready && <div className="agent-config-banner"><IconSettings size={17} /><span className="flex-1">{t("agent.notConfigured")}</span><button className="text-primary text-xs font-medium" onClick={settings}>{t("agent.configure")}</button></div>}
          {(state.error || localError) && <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{localError || state.error}</div>}
          <div className="agent-composer">
            {!!chat?.attachments.length && <div className="flex flex-wrap gap-2 px-3 pt-3">{chat.attachments.map(item => <AttachmentChip key={item.id} item={item} onRemove={() => removeAgentAttachment(item.id)} onPreview={() => showPreview(item)} />)}</div>}
            <textarea ref={composer} rows={1} value={chat?.draft || ""} onChange={event => setAgentDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (config?.ready && !state.loading && !modelSaving) guarded(sendAgentMessage) } }} placeholder={t("agent.placeholder")} aria-label={t("agent.placeholder")} disabled={state.loading} maxLength={24000} />
            <div className="agent-composer-toolbar">
              <ComposerControls mode={chat?.mode || "confirm"} model={config?.model || ""} disabled={state.loading} running={running} onFile={() => fileInput.current?.click()} onModelChange={selectModel} onConfigure={settings} />
              {running ? <button className="agent-send" type="button" disabled={state.stopping} title={t("agent.stop")} aria-label={t("agent.stop")} onClick={() => guarded(stopAgent)}>{state.stopping ? <IconLoader2 size={18} className="animate-spin" /> : <IconPlayerStop size={18} />}</button> : <button className="agent-send" type="button" title={t("agent.send")} aria-label={t("agent.send")} disabled={state.loading || modelSaving || !config?.ready || !chat || !chat.draft.trim() && !chat.attachments.length} onClick={() => { atBottom.current = true; guarded(sendAgentMessage) }}><IconArrowUp size={19} /></button>}
            </div>
          </div>
          <div className="mt-2 text-center text-[10px] text-muted-foreground">{t("agent.disclaimer")}</div>
        </div>}
      </section>
    </div>
    <input ref={fileInput} className="hidden" type="file" multiple accept=".log,.txt,.md,.json,.json5,.toml,.cfg,.conf,.properties,.yaml,.yml,.png,.jpg,.jpeg,.webp,.gif" onChange={event => { if (event.target.files) void readFiles(event.target.files); event.target.value = "" }} />
    {previewProject && <Suspense fallback={null}><AgentProjectDetailsModal project={previewProject} onClose={() => setPreviewProject(null)} /></Suspense>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null) }}><DialogContent className="max-w-2xl" data-window="agent-attachment-preview"><DialogHeader><DialogTitle>{preview?.name}</DialogTitle><DialogDescription>{t("agent.previewDescription")}</DialogDescription></DialogHeader>{preview?.kind === "project" && preview.projectId && <ProjectResults item={{ id: preview.id, kind: "tool", text: "", toolName: "get_project", output: preview.content }} />}{preview?.imageUrl && <img src={preview.imageUrl} alt={preview.name} className="max-h-[50vh] w-full rounded-xl object-contain" />}<details open={!preview?.projectId && !preview?.imageUrl}><summary className="cursor-pointer text-xs text-muted-foreground">{t("agent.result")}</summary><pre className="agent-json max-h-[40vh] mt-2">{preview?.content}</pre></details></DialogContent></Dialog>
    <ActionConfirmDialog
      open={!!deleteId}
      onClose={() => setDeleteId(null)}
      onConfirm={() => { if (deleteId) guarded(() => deleteAgentChat(deleteId)) }}
      title={t("agent.deleteChat")}
      description={t("agent.deleteChatDescription")}
      confirmText={t("agent.delete")}
      cancelText={t("agent.cancel")}
      variant="danger"
      icon="trash"
    />
  </div>
}
