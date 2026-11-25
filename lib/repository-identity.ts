/**
 * Чистые правила идентичности GitHub-репозитория.
 *
 * Модуль не читает окружение, Git и файлы: его используют renderer, main и
 * build-скрипты. Единственный источник истины — строка `owner/repo`, полученная
 * снаружи (`GITHUB_REPOSITORY`, git remote или сгенерированный build-time файл).
 */

export type UpdateChannelKey = "stable" | "canary"

/** GitHub отдаёт ассеты релиза с этих хостов после редиректа с `releases/download/...`. */
export const UPDATE_ASSET_HOSTS: ReadonlySet<string> = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
])

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

/**
 * Приводит `owner/repo` (можно с суффиксом `.git` и обрамляющими слэшами)
 * к каноническому виду. Бросает на пустом или неверном значении.
 */
export function normalizeRepositoryIdentity(value: unknown): string {
  if (typeof value !== "string") throw new Error("Repository identity must be a string")
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")
  const parts = trimmed.split("/")
  if (parts.length !== 2) throw new Error(`Invalid GitHub repository identity: ${String(value)}`)
  const [owner, repo] = parts
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    throw new Error(`Invalid GitHub repository identity: ${String(value)}`)
  }
  return `${owner}/${repo}`
}

/**
 * Достаёт `owner/repo` из GitHub remote: HTTPS, SSH (`ssh://git@github.com/...`)
 * и SCP-подобного (`git@github.com:owner/repo.git`). Для не-GitHub хоста — null.
 */
export function repositoryFromGitRemoteUrl(remote: unknown): string | null {
  if (typeof remote !== "string") return null
  const value = remote.trim()
  if (!value) return null
  let pathname: string
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(value)
  if (scp) {
    if (scp[1].toLowerCase() !== "github.com") return null
    pathname = scp[2]
  } else {
    let url: URL
    try { url = new URL(value) } catch { return null }
    if (url.hostname.toLowerCase() !== "github.com") return null
    pathname = url.pathname
  }
  const cleaned = pathname.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "")
  const parts = cleaned.split("/").filter(Boolean)
  if (parts.length !== 2) return null
  try { return normalizeRepositoryIdentity(parts.join("/")) } catch { return null }
}

/** Принимает `owner/repo` или GitHub-URL; на мусоре возвращает null, а не бросает. */
export function parseRepositoryIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null
  return repositoryFromGitRemoteUrl(value) ?? tryNormalize(value)
}

function tryNormalize(value: string): string | null {
  try { return normalizeRepositoryIdentity(value) } catch { return null }
}

/** Плоские URL-каталоги обновлений конкретного репозитория. */
export function updateBaseUrlsFor(repository: unknown): Readonly<Record<UpdateChannelKey, string>> {
  const identity = normalizeRepositoryIdentity(repository)
  return Object.freeze({
    stable: `https://github.com/${identity}/releases/latest/download`,
    canary: `https://github.com/${identity}/releases/download/canary`,
  })
}

/** База, которую обязана содержать `Resources/version.json` собранного канала. */
export function expectedUpdateBaseUrlFor(repository: unknown, channel: UpdateChannelKey): string {
  const base = updateBaseUrlsFor(repository)[channel]
  if (!base) throw new Error(`Unknown update channel: ${channel}`)
  return base
}

/** Путь `/<owner>/<repo>/releases/download/` для allowlist редиректов. */
export function releaseDownloadPathFor(repository: unknown): string {
  return `/${normalizeRepositoryIdentity(repository)}/releases/download/`
}

/**
 * `releases/latest/download/...` GitHub сначала перенаправляет на канонический
 * `github.com/<repo>/releases/download/<tag>/...`, и только затем — на asset-хост.
 * Промежуточный хоп остаётся внутри репозитория текущей сборки, поэтому он разрешён.
 */
export function isAllowedUpdateRedirectFor(url: URL, repository: unknown): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false
  if (UPDATE_ASSET_HOSTS.has(url.hostname)) return true
  return url.hostname === "github.com" && url.pathname.startsWith(releaseDownloadPathFor(repository))
}
