import assert from "node:assert/strict"
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import packageJson from "../package.json"
import { inspectElectrobunRelease, nativeArtifactNames } from "./electrobun-artifacts"
import { linuxPackageNames } from "./package-linux"
import { checksumText, verifyChecksums } from "./artifact-checksums"
export { checksumText, verifyChecksums }

const repository = "MAINER4IK/Xneon-Launcher-bun"
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-(?:pre|beta)[1-9]\d{0,8})?$/
const targets = [
  { platform: "win", arch: "x64" },
  { platform: "linux", arch: "x64" },
  { platform: "macos", arch: "arm64" },
  { platform: "macos", arch: "x64" },
] as const

export type ReleaseChannel = "stable" | "canary"

/** Канал определяется самим релизом: -preN/-betaN — canary, обычная версия — stable. */
export function releaseChannel(version: string): ReleaseChannel {
  assert.match(version, versionPattern, "Use a stable version, <version>-preN or <version>-betaN")
  return version.includes("-") ? "canary" : "stable"
}

/** Отдельный скрипт канала не должен собирать чужой релиз. */
export function assertReleaseChannel(version: string, expected: ReleaseChannel) {
  assert.equal(releaseChannel(version), expected,
    `The ${expected} pipeline cannot build ${version}; bump the version or run the ${releaseChannel(version)} pipeline`)
}

/** Формат prerelease согласован с существующим trusted update verifier. */
export function releaseIdentity(ref: string, version: string, repo: string) {
  assert.equal(repo, repository, "Releases require the canonical repository")
  assert.match(version, versionPattern, "Use a stable version, <version>-preN or <version>-betaN")
  assert.equal(ref, "refs/tags/v" + version, "Tag must match the actual package version")
  return { tag: "v" + version, version, prerelease: version.includes("-") }
}

async function api(resource: string) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${resource}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GH_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" },
  })
  assert.ok(response.ok, `GitHub API failed: ${response.status} ${resource}`)
  return response.json() as Promise<any>
}

async function tagCommit(tag: string) {
  assert.ok(tag.startsWith("v") && versionPattern.test(tag.slice(1)), "Invalid version tag")
  let object = (await api("git/ref/tags/" + encodeURIComponent(tag))).object
  for (let depth = 0; object.type === "tag" && depth < 8; depth++) object = (await api("git/tags/" + object.sha)).object
  assert.equal(object.type, "commit", "Tag must resolve to a commit")
  assert.match(object.sha, /^[a-f0-9]{40}$/)
  // Поддерживаются lightweight и annotated tags; commit обязан принадлежать main.
  const comparison = await api(`compare/${object.sha}...main`)
  assert.ok(["ahead", "identical"].includes(comparison.status), "Release commit must be reachable from main")
  return object.sha as string
}

async function outputs(values: Record<string, unknown>) {
  const text = Object.entries(values).map(([key, value]) => key + "=" + (typeof value === "object" ? JSON.stringify(value) : String(value))).join("\n") + "\n"
  assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required")
  await appendFile(process.env.GITHUB_OUTPUT, text)
}

export async function guardReleaseTag() {
  const release = releaseIdentity(process.env.GITHUB_REF!, packageJson.version, process.env.GITHUB_REPOSITORY!)
  assert.equal(await tagCommit(release.tag), process.env.GITHUB_SHA, "Release tag moved after validation")
  const existing = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(release.tag)}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
  })
  // Не удаляем чужие assets и не оставляем старые непроверенные вложения в релизе.
  assert.equal(existing.status, 404, "Release already exists or cannot be inspected; refusing to overwrite its assets")
}

const nativeSets = (version: string) => {
  const channel = releaseChannel(version)
  return targets.map(target => ({
    platform: target.platform,
    arch: target.arch,
    channel,
    version,
    // NSIS-установщик собирается только для стабильного Windows-канала.
    nsis: target.platform === "win" && channel === "stable",
  }))
}
const portableName = (version: string) => `xneon-launcher-${version}-win-x64-portable.zip`
/** Portable — независимый профиль, доступный в обоих каналах. */
const hasPortable = (version: string) => { releaseChannel(version); return true }
const linuxPackagesDirectory = "native-linux-x64-packages"
/** Системные Linux-пакеты собираются в обоих каналах: stable и canary. */

const packageMagic: Record<string, (head: Buffer) => void> = {
  deb: head => assert.equal(head.subarray(0, 21).toString(), "!<arch>\ndebian-binary", "Expected a deb archive"),
  rpm: head => assert.deepEqual([...head.subarray(0, 4)], [0xed, 0xab, 0xee, 0xdb], "Expected an rpm archive"),
  pacman: head => assert.deepEqual([...head.subarray(0, 4)], [0x28, 0xb5, 0x2f, 0xfd], "Expected a zstd pacman archive"),
  AppImage: head => {
    assert.equal(head.subarray(1, 4).toString(), "ELF", "Expected an AppImage runtime")
    assert.deepEqual([...head.subarray(8, 11)], [0x41, 0x49, 0x02], "Expected an AppImage type-2 header")
  },
  xz: head => assert.deepEqual([...head.subarray(0, 6)], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], "Expected an xz tarball"),
}

/** Перепроверка Linux-пакетов: allowlist, checksums и формат каждого файла. */
export async function verifyLinuxPackages(directory: string, version: string) {
  const names = linuxPackageNames(version)
  await verifyChecksums(directory, names)
  for (const name of names) {
    const file = Bun.file(path.join(directory, name))
    assert.ok(file.size > 1024 ** 2, "Linux package is too small: " + name)
    packageMagic[name.split(".").pop()!]?.(Buffer.from(await file.slice(0, 21).arrayBuffer()))
  }
}

/** Перепроверка скачанных artifacts перед передачей в signing step. */
export async function checkCandidates(input: string, version: string) {
  const sets = nativeSets(version)
  const directories = sets.map(options => `native-${options.platform}-${options.arch}-${options.channel}`)
  assert.deepEqual((await readdir(input)).sort(), [...directories,
    ...(hasPortable(version) ? ["native-win-x64-portable"] : []),
    linuxPackagesDirectory].sort(), "Unexpected artifact containers")
  for (const [index, options] of sets.entries()) {
    await inspectElectrobunRelease(path.join(input, directories[index]), { ...options, requireChecksums: true })
  }
  if (hasPortable(version)) await verifyChecksums(path.join(input, "native-win-x64-portable"), [portableName(version)])
  await verifyLinuxPackages(path.join(input, linuxPackagesDirectory), version)
}

export function publishedArtifactName(file: string, version: string): string {
  for (const options of nativeSets(version)) {
    if (file !== nativeArtifactNames(options)[3]) continue
    const platform = options.platform === "macos" ? "mac" : options.platform
    const extension = options.platform === "macos" ? ".dmg" : options.platform === "win" ? "-setup.zip" : "-setup.tar.gz"
    return `xneon-launcher-${version}-${platform}-${options.arch}${extension}`
  }
  return file
}

export function publicationNames(version: string, patches: string[] = []) {
  const channel = releaseChannel(version)
  for (const name of patches) assert.match(name, new RegExp(`^${channel}-(?:win-x64|linux-x64|macos-arm64|macos-x64)-[a-z0-9]+\\.patch$`))
  return [...nativeSets(version).flatMap(options => nativeArtifactNames(options).map(file => publishedArtifactName(file, version))),
    ...(hasPortable(version) ? [portableName(version)] : []),
    ...linuxPackageNames(version),
    ...patches].sort()
}

/** Повторно проверяет плоский release allowlist, trusted signatures и исходный SDK payload. */
export async function verifyPublication(directory: string, version: string) {
  const files = await readdir(directory)
  const names = publicationNames(version, files.filter(file => file.endsWith(".patch")))
  await verifyChecksums(directory, names)
  await mkdir(".tmp", { recursive: true })
  const scratch = await mkdtemp(path.resolve(".tmp/ci-publication-"))
  try {
    for (const [index, options] of nativeSets(version).entries()) {
      const subset = path.join(scratch, String(index))
      await mkdir(subset)
      const prefix = `${options.channel}-${options.platform}-${options.arch}-`
      for (const name of [...nativeArtifactNames(options), ...names.filter(file => file.startsWith(prefix) && file.endsWith(".patch"))]) await copyFile(path.join(directory, publishedArtifactName(name, version)), path.join(subset, name))
      await inspectElectrobunRelease(subset, options)
    }
  } finally { await rm(scratch, { recursive: true, force: true }) }
  return names
}

/** Сборка release-каталога не допускает произвольного glob и подмены исходного payload при signing. */
export async function assemblePublication(input: string, output: string, version: string) {
  const sets = nativeSets(version)
  const directories = sets.map(options => `native-${options.platform}-${options.arch}-${options.channel}`)
  assert.deepEqual((await readdir(input)).sort(), [...directories,
    ...(hasPortable(version) ? ["native-win-x64-portable"] : []),
    linuxPackagesDirectory].sort(), "Unexpected artifact containers")
  await mkdir(output)
  for (const [index, options] of sets.entries()) {
    const source = path.join(input, directories[index])
    const inspected = await inspectElectrobunRelease(source, { ...options, requireChecksums: true })
    for (const file of inspected.files) await copyFile(path.join(source, file), path.join(output, publishedArtifactName(file, version)))
  }
  if (hasPortable(version)) {
    const portable = path.join(input, "native-win-x64-portable")
    await verifyChecksums(portable, [portableName(version)])
    await copyFile(path.join(portable, portableName(version)), path.join(output, portableName(version)))
  }
  const packages = path.join(input, linuxPackagesDirectory)
  await verifyLinuxPackages(packages, version)
  for (const name of linuxPackageNames(version)) await copyFile(path.join(packages, name), path.join(output, name))
  const files = await readdir(output)
  await writeFile(path.join(output, "SHA256SUMS.txt"), await checksumText(output, files), { flag: "wx" })
  await verifyPublication(output, version)
}

/**
 * Общий CLI для двух отдельных входных скриптов: release (stable) и pre-release (canary).
 * Канал фиксирован скриптом, а версия пакета обязана ему соответствовать.
 */
export async function releaseCli(expected: ReleaseChannel) {
  const version = packageJson.version
  assertReleaseChannel(version, expected)
  const [action, input, output] = Bun.argv.slice(2)
  if (action === "channel") console.log(expected)
  else if (action === "identity") {
    await outputs(releaseIdentity(process.env.GITHUB_REF!, version, process.env.GITHUB_REPOSITORY!))
  }
  else if (action === "guard-tag") await guardReleaseTag()
  else if (action === "check") await checkCandidates(input, version)
  else if (action === "assemble") await assemblePublication(input, output, version)
  else if (action === "verify") await verifyPublication(input, version)
  else throw new Error(`Usage: ci-${expected === "stable" ? "release" : "pre-release"} <channel|identity|guard-tag|check input|assemble input output|verify input>`)
}
