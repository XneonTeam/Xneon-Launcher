import assert from "node:assert/strict"
import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../package.json"
import type { UpdateTarget } from "../electrobun/main/update-manifest"
import { updatePublicKeys } from "../electrobun/main/update-public-keys"
import { verifyUpdateFeed } from "./update-feed"
import { artifactChecksums, formatChecksums } from "./artifact-checksums"
import { releaseTargets } from "./release-targets"

/** Все цели канала: релиз публикует Windows x64, Linux x64 и macOS arm64. */
export function releaseChannelTargets(channel: "stable" | "canary"): UpdateTarget[] {
  return releaseTargets.map(({ platform, arch }) => ({ channel, platform, arch }))
}

/**
 * Проверяет подписанные Manifest v1 всех запрошенных target-ов. По умолчанию —
 * весь опубликованный набор текущего канала (Windows x64, Linux x64, macOS arm64).
 * Оба имени (`-update.json` и `-update-v2.json`) обязаны совпадать байт-в-байт.
 */
export async function verifySignedUpdateFeed(directory: string, version = packageJson.version,
  targets: ReadonlyArray<UpdateTarget> = releaseChannelTargets(version.includes("-") ? "canary" : "stable")) {
  assert.ok(directory, "Usage: verify-signed-update-feed <candidate> [targets]")
  const channel = version.includes("-") ? "canary" : "stable"
  const expected = new Set<string>()
  for (const target of targets) {
    assert.equal(target.channel, channel, "Signed update target channel differs from the version")
    // Итоговый allowlist ниже — объединение всех целей; per-target listing
    // проверяет только файлы своей цели, иначе соседние target-ы выглядят лишними.
    const { files } = await verifyUpdateFeed(directory, target, version, updatePublicKeys, { strictListing: false })
    for (const file of files) expected.add(file)
  }
  const files = await readdir(directory)
  const hasChecksums = files.includes("SHA256SUMS.txt")
  assert.deepEqual(files.sort(), [...expected, ...(hasChecksums ? ["SHA256SUMS.txt"] : [])].sort(), "Unexpected release attachments")
  const checksums = await artifactChecksums(directory, [...expected])
  const text = formatChecksums(checksums)
  // Повторная проверка никогда не перегенерирует уже существующий checksum-файл.
  if (hasChecksums) assert.equal(await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8"), text, "Signed transport checksum mismatch")
  else await writeFile(path.join(directory, "SHA256SUMS.txt"), text, { flag: "wx" })
  console.log("Verified trusted Manifest v1 signatures and release attachment hashes")
  return [...expected].sort()
}

if (import.meta.main) {
  const [directory, ...rest] = Bun.argv.slice(2)
  assert.ok(directory, "Usage: verify-signed-update-feed <candidate> [platform arch ...]")
  assert.ok(rest.length % 2 === 0, "Usage: verify-signed-update-feed <candidate> [platform arch ...]")
  const channel = packageJson.version.includes("-") ? "canary" : "stable"
  const requested: UpdateTarget[] = []
  for (let index = 0; index < rest.length; index += 2) {
    const [platform, arch] = rest.slice(index, index + 2)
    assert.ok(platform === "win" && arch === "x64" || platform === "linux" && arch === "x64" || platform === "macos" && arch === "arm64",
      "Unsupported update target: " + platform + " " + arch)
    requested.push({ platform, arch, channel } as UpdateTarget)
  }
  verifySignedUpdateFeed(directory, packageJson.version, requested.length ? requested : releaseChannelTargets(channel))
    .catch(error => { console.error(error); process.exitCode = 1 })
}