/** После IPC заново создаются объекты. Не заменяем ими неизменившиеся строки. */
export function reconcileContentRows<T extends { slug: string }>(current: T[], incoming: T[]): T[] {
  const previous = new Map(current.map(item => [item.slug, item]))
  const result = incoming.map(item => {
    const old = previous.get(item.slug)
    if (!old) return item
    const keys = new Set([...Object.keys(old), ...Object.keys(item)])
    return [...keys].every(key => Object.is(old[key as keyof T], item[key as keyof T])) ? old : item
  })
  return result.length === current.length && result.every((item,i) => item === current[i]) ? current : result
}

export function reconcileContentPaths(current: Record<string, string>, incoming: Record<string, string>): Record<string, string> {
  const keys = Object.keys(incoming)
  return keys.length === Object.keys(current).length && keys.every(key => current[key] === incoming[key]) ? current : incoming
}

/** Main уже нормализовал превью; старый снимок не должен возвращать оригинал. */
export function reconcileContentIcon(previous: string | undefined, scanned: string | undefined): string | undefined {
  return scanned || previous
}
/** Идентификатор чужой площадки не часть DTO; пустой автор равен отсутствующему. */
export function normalizeContentDto<T extends { slug: string; source?: unknown; modId?: unknown; author?: unknown }>(item: T): T {
  const author = typeof item.author === "string" ? item.author.trim() || undefined : item.author
  if ((item.source !== "modrinth" || item.modId === undefined) && author === item.author) return item
  return { ...item, ...(item.source === "modrinth" ? { modId: undefined } : {}), author }
}
