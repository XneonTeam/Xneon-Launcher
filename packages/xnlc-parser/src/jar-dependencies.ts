export interface JarDeclaredDependency {
  /** Идентификатор мода из метаданных (например, `fabric-api`). */
  modId: string
  /** Диапазон версий, как его объявил автор мода. */
  versionRange?: string
}

export function stringifyVersionRange(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (Array.isArray(value)) {
    const parts = value.map(item => stringifyVersionRange(item)).filter(Boolean)
    return parts.length > 0 ? parts.join(" || ") : undefined
  }
  // Объектные выражения не представимы строкой диапазона в контракте лаунчера.
  return undefined
}
