/**
 * Идентичность репозитория текущей сборки.
 *
 * Значение встроено генератором `scripts/gen-repository-identity.ts` во время
 * сборки, поэтому runtime не запускает Git, не читает окружение и не угадывает
 * владельца. Отсюда же строятся URL каналов обновлений и allowlist редиректов.
 */
import {
  isAllowedUpdateRedirectFor,
  releaseDownloadPathFor,
  updateBaseUrlsFor,
  type UpdateChannelKey,
} from "../../lib/repository-identity"
import { repositoryIdentity } from "../../lib/repository-identity.generated"

export type { UpdateChannelKey }

/** GitHub-репозиторий, из которого собрано это приложение. */
export const repository = repositoryIdentity

/**
 * Плоские URL-каталоги обновлений текущего репозитория. Stable читает latest-релиз
 * (prereleases исключены GitHub'ом), canary — rolling-релиз с тегом `canary`.
 */
export const updateBaseUrls = Object.freeze(updateBaseUrlsFor(repository))

/** База, которую обязана содержать `Resources/version.json` собранного канала. */
export function expectedUpdateBaseUrl(channel: UpdateChannelKey): string {
  const base = updateBaseUrls[channel]
  if (!base) throw new Error(`Unknown update channel: ${channel}`)
  return base
}

/** Путь `/<owner>/<repo>/releases/download/` для allowlist редиректов. */
export function updateReleaseDownloadPath(): string {
  return releaseDownloadPathFor(repository)
}

/** Разрешён ли редирект на этот URL цепочкой обновления текущего репозитория. */
export function isAllowedUpdateRedirect(url: URL): boolean {
  return isAllowedUpdateRedirectFor(url, repository)
}
