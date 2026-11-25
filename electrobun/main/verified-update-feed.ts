import { APP_USER_AGENT } from "../../lib/app-meta"
import { expectedUpdateBaseUrl, isAllowedUpdateRedirect } from "./repository-identity"
import { updatePublicKeys } from "./update-public-keys"
import { compareReleaseVersions, verifySignedWindowsUpdateManifest } from "./verified-update-manifest"

export type PackageChannel = "stable" | "canary"

export type VerifiedUpdate = {
  manifest: ReturnType<typeof verifySignedWindowsUpdateManifest>
  archiveUrl: string
  manifestBytes: Buffer
  signatureBytes: Buffer
}

const MANIFEST_BYTES = 64 * 1024
const SIGNATURE_BYTES = 1024

/**
 * `releases/latest/download/...` GitHub сначала перенаправляет на канонический
 * `github.com/<repo>/releases/download/<tag>/...`, и только затем — на asset-хост.
 * Промежуточный хоп остаётся внутри репозитория текущей сборки, поэтому он разрешён;
 * чужой репозиторий и посторонние хосты отвергаются (см. `repository-identity`).
 */
export { isAllowedUpdateRedirect }

export async function updateFeedGet(url: string, signal: AbortSignal, allowMissing = false): Promise<Response | null> {
  for (let hop = 0; hop <= 4; hop++) {
    const response = await fetch(url, { redirect: "manual", signal, headers: { "User-Agent": APP_USER_AGENT } })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (allowMissing && response.status === 404) {
        await response.body?.cancel()
        return null
      }
      if (response.ok) return response
      await response.body?.cancel()
      throw new Error(`Update server returned HTTP ${response.status}`)
    }
    const location = response.headers.get("location")
    await response.body?.cancel()
    if (!location) throw new Error("Unexpected update redirect without a location")
    const next = new URL(location, url)
    if (!isAllowedUpdateRedirect(next)) {
      throw new Error("Update redirect points outside GitHub release assets")
    }
    url = next.href
  }
  throw new Error("Too many update redirects")
}

export async function updateFeedReadBounded(response: Response, maximum: number): Promise<Buffer> {
  if (!response.body) throw new Error("Empty update response")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > maximum) throw new Error("Update metadata is oversized")
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Канал по имени версии (тег релиза `-preN`/`-betaN` публикуется как canary). */
export function releaseChannelOf(version: string): PackageChannel {
  return /-(?:pre|beta)\d+$/.test(version) ? "canary" : "stable"
}

/** Канал сборки → отображаемый канал в UI лаунчера. */
export function installedPreference(channel: PackageChannel): "stable" | "beta" {
  return channel === "canary" ? "beta" : "stable"
}

/** Плоские URL манифеста/подписи канала (SDK строит их из `baseUrl` точно так же). */
export function manifestUrls(channel: PackageChannel) {
  const base = expectedUpdateBaseUrl(channel)
  const name = `${channel}-win-x64-update-v2.json`
  return { base, manifestUrl: `${base}/${name}`, signatureUrl: `${base}/${name}.sig` }
}

/**
 * Опубликованная сборка считается обновлением только если она новее установленной.
 * Совпадение версий — обычное состояние «последняя версия уже стоит», а не ошибка:
 * иначе проверка обновлений на актуальной сборке показывала красный текст.
 */
export function isNewerRelease(candidate: string, currentVersion: string): boolean {
  return compareReleaseVersions(candidate, currentVersion) > 0
}

/**
 * Канал задаёт сама сборка (`Resources/version.json.channel`): stable-пакет читает
 * `releases/latest/download`, canary — `releases/download/canary`. Манифест и его
 * подпись проверяются нашим Ed25519-ключом до передачи в SDK. Сеть не нужна,
 * если релиза ещё нет: отсутствующий манифест (404) трактуется как «обновлений нет».
 */
export async function resolveVerifiedUpdate(currentVersion: string, channel: PackageChannel): Promise<VerifiedUpdate | null> {
  if (Object.keys(updatePublicKeys).length === 0) throw new Error("Trusted update signing keys are not configured")
  const signal = AbortSignal.timeout(45_000)
  const { base, manifestUrl, signatureUrl } = manifestUrls(channel)
  const manifestResponse = await updateFeedGet(manifestUrl, signal, true)
  if (!manifestResponse) return null
  const bytes = await updateFeedReadBounded(manifestResponse, MANIFEST_BYTES)
  const signatureResponse = await updateFeedGet(signatureUrl, signal)
  if (!signatureResponse) throw new Error("Update signature is missing")
  const signature = await updateFeedReadBounded(signatureResponse, SIGNATURE_BYTES)
  // "0.0.0" отключает сравнение версий внутри верификатора: подпись, канал и
  // артефакты проверяются здесь, а «новее ли это» решает isNewerRelease. Иначе
  // равная версия падала бы как ошибка, хотя обновления просто нет.
  const manifest = verifySignedWindowsUpdateManifest(bytes, signature, updatePublicKeys, "0.0.0", channel, channel)
  if (!isNewerRelease(manifest.version, currentVersion)) return null
  return { manifest, archiveUrl: `${base}/${manifest.artifact.file}`, manifestBytes: bytes, signatureBytes: signature }
}
