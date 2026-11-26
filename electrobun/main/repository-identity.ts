/**
 * Идентичность репозитория текущей сборки.
 *
 * Значение встроено генератором `scripts/gen-repository-identity.ts` во время
 * сборки, поэтому runtime не запускает Git, не читает окружение и не угадывает
 * владельца. Отсюда же строятся URL каналов обновлений и allowlist редиректов.
 */
import packageJson from "../../package.json"
import {
  isAllowedUpdateRedirectFor,
  releaseDownloadPathFor,
  updateBaseUrlFor,
  updateBaseUrlsFor,
  type UpdateChannelKey,
} from "../../lib/repository-identity"
import { repositoryIdentity } from "../../lib/repository-identity.generated"

export type { UpdateChannelKey }

/** GitHub-репозиторий, из которого собрано это приложение. */
export const repository = repositoryIdentity

/**
 * Плоские URL-каталоги каналов для версии этой сборки. Stable читает latest-релиз,
 * canary — релиз конкретной версии: каждый prerelease публикуется отдельным
 * релизом, поэтому фиксированного тега `canary` больше нет.
 */
export const updateBaseUrls = Object.freeze(updateBaseUrlsFor(repository, packageJson.version))

/** База канала обновлений; у canary она версионная и зависит от конкретного релиза. */
export function updateBaseUrl(channel: UpdateChannelKey, version = packageJson.version): string {
  return updateBaseUrlFor(repository, channel, version)
}

/** База, которую обязана содержать `Resources/version.json` собранного канала. */
export function expectedUpdateBaseUrl(channel: UpdateChannelKey, version = packageJson.version): string {
  return updateBaseUrl(channel, version)
}

/** Путь `/<owner>/<repo>/releases/download/` для allowlist редиректов. */
export function updateReleaseDownloadPath(): string {
  return releaseDownloadPathFor(repository)
}

/** Разрешён ли редирект на этот URL цепочкой обновления текущего репозитория. */
export function isAllowedUpdateRedirect(url: URL): boolean {
  return isAllowedUpdateRedirectFor(url, repository)
}
