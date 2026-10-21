import type { AgentTimelineItem } from "@xnlc/types"
import { useTranslation } from "react-i18next"
import { IconCheck, IconListCheck, IconLoader2, IconChevronDown } from "@tabler/icons-react"
import { useAgentState } from "./store"

interface PlanSnapshot {
  steps: string[]
  completed: number
  explanation: string
  fromTool: boolean
}

function parseToolPlan(timeline: AgentTimelineItem[]): PlanSnapshot | null {
  const turnStart = timeline.findLastIndex(item => item.kind === "user")
  const turn = timeline.slice(Math.max(0, turnStart))
  const update = [...turn].reverse().find(item => item.kind === "tool" && item.toolName === "update_plan" && item.status === "done")
  if (!update) return null
  try {
    const plan = JSON.parse(update.output || "{}")
    if (!Array.isArray(plan.steps) || !plan.steps.length || plan.steps.some((step: unknown) => typeof step !== "string") || !Number.isInteger(plan.completedSteps) || plan.completedSteps < 0 || plan.completedSteps > plan.steps.length) return null
    return { steps: plan.steps, completed: plan.completedSteps, explanation: typeof plan.explanation === "string" ? plan.explanation : "", fromTool: true }
  } catch { return null }
}

/** Страховка для провайдеров, которые написали план обычным ответом вместо update_plan. */
function parseWrittenPlan(timeline: AgentTimelineItem[]): PlanSnapshot | null {
  const turnStart = timeline.findLastIndex(item => item.kind === "user")
  if (turnStart < 0) return null
  const messages = timeline.slice(turnStart + 1).filter(item => item.kind === "assistant" && item.text)
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const lines = messages[messageIndex].text.split(/\r?\n/)
    const heading = lines.findIndex(line => /план|plan/i.test(line) && line.trim().length < 140 && !/[.!?]$/.test(line.trim()))
    if (heading < 0) continue
    const numbered: string[] = []
    const bullets: string[] = []
    for (const line of lines.slice(heading + 1)) {
      if (!line.trim()) continue
      const item = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/) ?? line.match(/^\s*(-|\*)\s+(.+?)\s*$/)
      if (!item) continue
      const text = (item[2] ?? "").replace(/\*\*/g, "").trim().replace(/[:.]$/, "").trim()
      if (!text) continue
      if (/^\d+$/.test(item[1])) numbered.push(text)
      else if (!/^\s{2,}[-*]\s/.test(line)) bullets.push(text)
    }
    const steps = (numbered.length ? numbered : bullets).slice(0, 16)
    if (steps.length) return { steps, completed: 0, explanation: "", fromTool: false }
  }
  return null
}

/** Текущий план закреплён над прокручиваемой перепиской и обновляется вместе с ходом агента. */
export function AgentPlan({ timeline }: { timeline: AgentTimelineItem[] }) {
  const { t } = useTranslation()
  const state = useAgentState()
  const plan = parseToolPlan(timeline) ?? parseWrittenPlan(timeline)
  if (!plan) return null
  const active = plan.fromTool && state.running && !state.stopping
  return <div className="agent-plan-dock">
    <details className="agent-plan-card rounded-xl border border-border bg-card/95" aria-label={t("agent.plan.title")}>
      <summary className="agent-plan-summary">
        <IconListCheck size={18} className="shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{t("agent.plan.title")}</span><span className="block truncate text-[11px] text-muted-foreground">{plan.steps[Math.min(plan.completed, plan.steps.length - 1)]}</span></span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{t("agent.plan.progress", { completed: plan.completed, total: plan.steps.length })}</span>
        <IconChevronDown size={14} className="agent-plan-chevron shrink-0 text-muted-foreground" aria-hidden="true" />
      </summary>
      <div className="agent-plan-body"><ol className="space-y-2">
        {plan.steps.map((step, index) => {
          const status = index < plan.completed ? "completed" : index === plan.completed && active ? "inProgress" : "pending"
          return <li key={index} className="flex items-start gap-2 text-xs" aria-current={status === "inProgress" ? "step" : undefined}>
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-primary" aria-hidden="true">{status === "completed" ? <IconCheck size={16} /> : status === "inProgress" ? <IconLoader2 size={16} className="motion-safe:animate-spin" /> : <span className="h-2 w-2 rounded-full border border-muted-foreground/50" />}</span>
            <span className={status === "pending" ? "flex-1 text-muted-foreground" : "flex-1 text-foreground"}>{step}</span>
            <span className="text-[10px] text-muted-foreground">{t(`agent.plan.${status}`)}</span>
          </li>
        })}
      </ol>
      {plan.explanation && <p className="mt-3 text-xs text-muted-foreground">{plan.explanation}</p>}
      </div>
    </details>
  </div>
}
