import { APP_USER_AGENT } from "../../lib/app-meta"
import { repository } from "./repository-identity"
import { compareReleaseVersions } from "./verified-update-manifest"

/**
 * Новейший опубликованный prerelease этого репозитория. Ответ GitHub API —
 * недоверенная подсказка: он выбирает только тег (`vX.Y.Z-preN`/`-betaN`), а
 * содержимое релиза всё равно проверяется подписью Ed25519 закреплённым ключом в
 * `resolveVerifiedUpdate`/`resolveVerifiedUnixUpdate`. API не может внедрить
 * payload — максимум направить на другой легитимный тег, обновление оттуда
 * отвергнется, если подпись/канал/версия не совпадут.
 *
 * Порядок в ответе GitHub — по `created_at`, не по semver, поэтому кандидаты
 * сравниваются `compareReleaseVersions`. Сеть недоступна/лимит — возвращаем null
 * (клиент увидит «обновлений нет»), не бросая красную ошибку в UI.
 */
const PRERELEASE_TAG = /^v(\d+\.\d+\.\d+-(?:pre|beta)\d+)$/
const RELEASES_PER_PAGE = 20
const DISCOVERY_TIMEOUT_MS = 20_000

export async function newestPrereleaseVersion(signal?: AbortSignal): Promise<string | null> {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=${RELEASES_PER_PAGE}`, {
      redirect: "error",
      signal: combined,
      headers: { "User-Agent": APP_USER_AGENT, Accept: "application/vnd.github+json" },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  if (!Array.isArray(body)) return null
  let newest: string | null = null
  for (const entry of body) {
    if (!entry || typeof entry !== "object") continue
    const { draft, prerelease, tag_name: tag } = entry as Record<string, unknown>
    if (draft !== false || prerelease !== true || typeof tag !== "string") continue
    const match = PRERELEASE_TAG.exec(tag)
    if (!match) continue
    if (!newest || compareReleaseVersions(match[1]!, newest) > 0) newest = match[1]!
  }
  return newest
}
