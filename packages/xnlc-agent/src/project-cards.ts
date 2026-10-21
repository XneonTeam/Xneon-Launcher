import type { AgentAttachment, AgentTimelineItem } from "@xnlc/types"

/** Карточка строится и для локального контента без обращения к каталогу. */
export function attachedProjectCards(attachments: AgentAttachment[]): Array<Record<string, unknown>> {
  return attachments.filter(item => item.kind === "project").map(item => {
      let data: Record<string, unknown> = {}
      try { const parsed = JSON.parse(item.content); if (parsed && typeof parsed === "object") data = parsed } catch { /* Остаётся карточка с данными самого вложения. */ }
      return { ...data, attachmentId: item.id, name: item.name, source: item.source || data.source || "local", projectId: item.projectId || data.projectId, iconUrl: item.iconUrl || data.iconUrl || data.icon_url, summary: data.summary || data.description, contentType: data.contentType || (item.id.startsWith("content:") ? item.id.split(":")[1] : "mod") }
    })
}

/** Вложения показываются у первого содержательного ответа на сообщение. */
export function assistantProjectContext(timeline: AgentTimelineItem[], index: number): AgentAttachment[] {
  if (timeline[index]?.kind !== "assistant" || !timeline[index].text) return []
  for (let previous = index - 1; previous >= 0; previous--) {
    const entry = timeline[previous]
    if (entry.kind === "assistant" && entry.text) return []
    if (entry.kind === "user") return entry.attachments || []
  }
  return []
}

/** Собираем проекты всего хода, а не только первый результат последнего инструмента. */
export function assistantResultCards(timeline: AgentTimelineItem[], index: number): Array<Record<string, unknown>> {
  const answer = timeline[index]
  if (answer?.kind !== "assistant" || !answer.text) return []
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  const text = answer.text.toLocaleLowerCase()
  const candidates: Array<{ project: Record<string, unknown>; position: number; explicit: boolean }> = []
  const isQuestionMention = (position: number) => {
    const suffix = answer.text.slice(position)
    const endings = [suffix.indexOf("."), suffix.indexOf("?"), suffix.indexOf("？"), suffix.indexOf("!"), suffix.indexOf("\n")].filter(index => index >= 0)
    const end = endings.length ? Math.min(...endings) : suffix.length
    return end < suffix.length && (suffix[end] === "?" || suffix[end] === "？")
  }
  const mentionPosition = (name: string) => {
    const words = name.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)
    if (!words?.length) return -1
    // Ищем целые слова, сохраняя поддержку Markdown и знаков в названии.
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[^\\p{L}\\p{N}]*")}(?![\\p{L}\\p{N}])`, "u")
    return text.search(pattern)
  }
  for (let previous = index - 1; previous >= 0; previous--) {
    const item = timeline[previous]
    if (item.kind === "user" || item.kind === "assistant" && item.text) break
    if (item.kind !== "tool" || item.status !== "done" || !item.output || !["get_project", "search_projects"].includes(item.toolName || "")) continue
    try {
      const output = JSON.parse(item.output)
      const projects: Array<Record<string, unknown>> = item.toolName === "search_projects" ? output.results : [output]
      if (!Array.isArray(projects)) continue
      const valid = projects.filter(project => project && typeof project.name === "string" && ["modrinth", "curseforge", "ftb"].includes(String(project.source)))
      candidates.push(...valid.map(project => ({ project, position: mentionPosition(String(project.name)), explicit: item.toolName === "get_project" })))
    } catch { /* Повреждённый результат не должен ломать историю. */ }
  }
  const selected = candidates.filter(item => item.explicit || item.position >= 0 && !isQuestionMention(item.position))
  // Если название в ответе отсутствует, сохраняем прежний показ основного результата.
  if (!selected.length && candidates.length) selected.push(candidates[0])
  selected.sort((a, b) => (a.position < 0 ? Infinity : a.position) - (b.position < 0 ? Infinity : b.position))
  const seen = new Set<string>()
  return selected.flatMap(({ project }) => {
    const key = `${project.source}:${project.projectId || project.id || project.slug || normalize(String(project.name))}`
    if (seen.has(key)) return []
    seen.add(key)
    return [project]
  })
}

/** Название и логотип уже есть в карточке; описание и подзаголовки сохраняем. */
export function projectAnswerText(text: string, names: string[]): string {
  if (!names.length) return text
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  const titles = new Set(names.map(normalize))
  const lines = text.split("\n")
  while (lines.length) {
    const line = lines[0].trim()
    const title = normalize(line.replace(/[*_`]/g, "").replace(/^#{1,6}\s*/, "").replace(/^\d+[.)]\s*/, ""))
    if (!line || titles.has(title) || /^!\[[^\]]*\]\([^\n]+\)$/.test(line) || [...titles].some(name => title === `иконка${name}` || title === `${name}icon`)) lines.shift()
    else break
  }
  return lines.join("\n")
}

/** Карточку вставляем у раздела проекта, сохраняя вступление и весь Markdown описания. */
export function projectAnswerSections(text: string, projects: Array<Record<string, unknown>>): Array<{ project?: Record<string, unknown>; text: string }> {
  if (!projects.length) return [{ text }]
  const lines = text.split("\n")
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  let fence = ""
  const searchable = lines.map(line => {
    const marker = line.trim().match(/^(`{3,}|~{3,})/)?.[1]
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = ""; return false }
    return !fence
  })
  const placed = projects.map(project => {
    const name = String(project.name || "")
    const names = [name, name.replace(/\s*\([^)]*\)\s*$/, "")].filter(Boolean)
    const titles = new Set(names.map(normalize))
    const mentions = (line: string) => names.some(value => {
      const words = value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)
      return words?.length && new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[^\\p{L}\\p{N}]*")}(?![\\p{L}\\p{N}])`, "u").test(line.toLocaleLowerCase())
    })
    let line = lines.findIndex((value, index) => searchable[index] && (titles.has(normalize(value.replace(/[*_`]/g, "").replace(/^#{1,6}\s*/, "").replace(/^\d+[.)]\s*/, ""))) || /^(?:#{1,6}\s+|\d+[.)]\s+)/.test(value.trim()) && mentions(value)))
    if (line < 0) line = lines.findIndex((value, index) => searchable[index] && mentions(value))
    // Для единственного проекта без заголовка карточка остаётся над описанием.
    if (line < 0) line = projects.length === 1 ? 0 : lines.length
    return { project, line, names }
  }).sort((a, b) => a.line - b.line)
  const sections: Array<{ project?: Record<string, unknown>; text: string }> = []
  if (placed[0].line > 0) sections.push({ text: lines.slice(0, placed[0].line).join("\n") })
  placed.forEach((item, index) => {
    const end = placed[index + 1]?.line ?? lines.length
    sections.push({ project: item.project, text: projectAnswerText(lines.slice(item.line, end).join("\n"), item.names) })
  })
  return sections
}
