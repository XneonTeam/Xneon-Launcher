/**
 * Compares two semver-like version strings, ignoring an optional leading "v".
 * Returns true if `remote` is strictly newer than `local`.
 *
 * Examples:
 *   isVersionNewer("1.2.3", "1.2.2")  // true
 *   isVersionNewer("v2.0.0", "1.9.9") // true
 *   isVersionNewer("1.0.0", "1.0.0")  // false
 */
export function isVersionNewer(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, "").split(".").map(Number)
  const l = local.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] ?? 0
    const b = l[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}
