import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { IpcEventMap } from "@xnlc/types"
import { newestPrereleaseVersion } from "./canary-release-discovery"
import { updatePublicKeys } from "./update-public-keys"
import { manifestUrls, updateFeedGet, updateFeedReadBounded, type PackageChannel } from "./verified-update-feed"
import { verifySignedWindowsUpdateManifest } from "./verified-update-manifest"

const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_SIGNATURE_BYTES = 1024
const MAX_INSTALLER_BYTES = 512 * 1024 ** 2

const installerName = (version: string) => `xneon-launcher-${version}-win-x64.exe`

export type ChannelInstaller = { channel: PackageChannel; version: string; file: string; path: string }

/**
 * Смена канала — это установка сборки другого канала, а не обновление:
 * SDK отклоняет манифест, канал которого не совпадает с установленным.
 * Поэтому качаем NSIS-установщик целевого канала и сверяем его с подписанным
 * манифестом (Ed25519), а не полагаемся только на TLS GitHub.
 */
export async function downloadChannelInstaller(
  channel: PackageChannel,
  onProgress?: (progress: IpcEventMap["update:progress"]) => void,
  expected?: { version: string; hash: string },
): Promise<ChannelInstaller> {
  const signal = AbortSignal.timeout(180_000)
  const discovered = channel === "canary" ? expected?.version ?? await newestPrereleaseVersion(signal) : undefined
  if (channel === "canary" && !discovered) throw new Error("No canary release found")
  const { base, manifestUrl, signatureUrl } = manifestUrls(channel, discovered ?? undefined)
  const manifestResponse = await updateFeedGet(manifestUrl, signal)
  if (!manifestResponse) throw new Error("Update manifest is missing")
  const bytes = await updateFeedReadBounded(manifestResponse, MAX_MANIFEST_BYTES)
  const signatureResponse = await updateFeedGet(signatureUrl, signal)
  if (!signatureResponse) throw new Error("Update signature is missing")
  const signature = await updateFeedReadBounded(signatureResponse, MAX_SIGNATURE_BYTES)
  // currentVersion "0.0.0" отключает сравнение версий: переход возможен и назад по номеру.
  const manifest = verifySignedWindowsUpdateManifest(bytes, signature, updatePublicKeys, "0.0.0", channel, channel)
  if (expected) {
    assert.equal(manifest.version, expected.version, "Update changed after checking; check for updates again")
    assert.equal(manifest.hash, expected.hash, "Update changed after checking; check for updates again")
  }

  const document = JSON.parse(bytes.toString("utf8"))
  const installer = document.installer
  assert.ok(installer && installer.file === installerName(manifest.version), "Signed manifest does not describe this installer")
  assert.match(installer.sha256, /^[a-f0-9]{64}$/, "Invalid installer hash")
  assert.ok(Number.isSafeInteger(installer.size) && installer.size > 0 && installer.size <= MAX_INSTALLER_BYTES, "Invalid installer size")

  const url = `${base}/${encodeURIComponent(installer.file)}`
  const response = await updateFeedGet(url, signal)
  if (!response?.body) throw new Error("Installer download failed")

  const directory = path.join(os.tmpdir(), "xneon-channel-installer")
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, installer.file)
  await rm(file, { force: true })

  const hash = createHash("sha256")
  let size = 0
  let lastPercent = -1
  const report = (percent: number) => {
    if (percent === lastPercent) return
    lastPercent = percent
    onProgress?.({ percent, transferred: size, total: installer.size })
  }
  report(0)
  const reader = response.body.getReader()
  async function* chunks() {
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > installer.size) throw new Error("Downloaded installer size exceeds the signed manifest")
        hash.update(chunk.value)
        // Размер берём из подписи, а не из необязательного Content-Length.
        // 100% означает завершённую запись и успешную проверку файла.
        report(Math.min(99, Math.floor(size / installer.size * 100)))
        yield Buffer.from(chunk.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
  }
  // pipeline обслуживает backpressure и ошибки диска без слушателя на каждый чанк.
  await pipeline(Readable.from(chunks()), createWriteStream(file), { signal })

  assert.equal(size, installer.size, "Downloaded installer size differs from the signed manifest")
  assert.equal(hash.digest("hex"), installer.sha256, "Downloaded installer hash differs from the signed manifest")
  assert.equal((await stat(file)).size, installer.size)
  report(100)

  return { channel, version: manifest.version, file: installer.file, path: file }
}
