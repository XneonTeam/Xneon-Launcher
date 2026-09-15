// ============================================================
// Xneon Launcher — Version ranges for modloader requirements
// ============================================================
//
// Чистые функции без зависимостей: сравнение версий и проверка диапазонов в тех
// форматах, что встречаются в метаданных модов.
//   • Maven-диапазоны Forge/NeoForge: `[47,)`, `[21.1,21.2)`, `[1.2.3]`
//   • Fabric/Quilt компараторы:       `>=0.16.0`, `*`, `>=0.14.0 <0.17.0`

function versionParts(value: string): number[] {
  return String(value ?? "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
}

/** Числовое сравнение версий: -1 — меньше, 0 — равно, 1 — больше. */
export function compareLoaderVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

function satisfiesComparator(version: string, token: string): boolean {
  const value = token.trim()
  if (!value || value === "*" || value === "+" || value.toLowerCase() === "any") return true
  if (value.startsWith(">=")) return compareLoaderVersions(version, value.slice(2)) >= 0
  if (value.startsWith("<=")) return compareLoaderVersions(version, value.slice(2)) <= 0
  if (value.startsWith(">")) return compareLoaderVersions(version, value.slice(1)) > 0
  if (value.startsWith("<")) return compareLoaderVersions(version, value.slice(1)) < 0
  if (value.startsWith("=")) return compareLoaderVersions(version, value.slice(1)) === 0
  // ^ и ~ — «не ниже указанной»: точную верхнюю границу не угадываем
  if (value.startsWith("^") || value.startsWith("~")) {
    return compareLoaderVersions(version, value.slice(1)) >= 0
  }
  return compareLoaderVersions(version, value) === 0
}

/** Один диапазон: `[47,)`, `[21.1,21.2)`, `>=0.16.0`, `1.2.3`, `*`. */
export function satisfiesLoaderRange(version: string, range: string): boolean {
  const value = (range ?? "").trim()
  if (!value) return true

  const bracket = value.match(/^([\[(])\s*([^,)\]]*)\s*(?:,\s*([^)\]]*))?\s*([\])])$/)
  if (bracket) {
    const lowerInclusive = bracket[1] === "["
    const upperInclusive = bracket[4] === "]"
    const lower = (bracket[2] ?? "").trim()
    const upper = (bracket[3] ?? "").trim()

    // `[1.2.3]` без запятой — точная версия
    if (!value.includes(",") && lower && lowerInclusive && upperInclusive) {
      return compareLoaderVersions(version, lower) === 0
    }

    if (lower) {
      const cmp = compareLoaderVersions(version, lower)
      if (cmp < 0 || (cmp === 0 && !lowerInclusive)) return false
    }
    if (upper) {
      const cmp = compareLoaderVersions(version, upper)
      if (cmp > 0 || (cmp === 0 && !upperInclusive)) return false
    }
    return true
  }

  return value.split(/[,\s]+/).filter(Boolean).every(token => satisfiesComparator(version, token))
}

/** Удовлетворяет ли версия требованию (строка или список альтернатив). */
export function satisfiesLoaderRequirement(version: string, requirement: string | string[]): boolean {
  if (Array.isArray(requirement)) {
    if (requirement.length === 0) return true
    return requirement.some(item => satisfiesLoaderRange(version, String(item)))
  }
  return satisfiesLoaderRange(version, requirement)
}