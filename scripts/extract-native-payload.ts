import assert from "node:assert/strict"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { inspectElectrobunRelease } from "./electrobun-artifacts"
import { nativeTarExecutable } from "./native-tar"

/** Release build-каталог содержит installer wrapper. Проверяется именно payload архива. */
export async function extractNativePayload(input: string, output: string, channel: "stable" | "canary", platform: "linux" | "macos", arch: "x64" | "arm64") {
  const checked = await inspectElectrobunRelease(input, { channel, platform, arch, requireChecksums: true })
  await mkdir(output)
  const tar = path.resolve(output, "payload.tar")
  try {
    await writeFile(tar, Bun.zstdDecompressSync(await readFile(path.join(input, checked.manifest.artifact.file))))
    const result = spawnSync(nativeTarExecutable(), ["-xf", tar, "-C", path.resolve(output)], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
  } finally { await rm(tar, { force: true }) }
  return path.join(output, platform === "macos" ? `Xneon Launcher${channel === "stable" ? "" : "-canary"}.app` : `XneonLauncher${channel === "stable" ? "" : "-canary"}`)
}

if (import.meta.main) {
  const [input, output, channel, platform, arch] = Bun.argv.slice(2)
  assert.ok(input && output && ["stable", "canary"].includes(channel) && ["linux", "macos"].includes(platform) && ["x64", "arm64"].includes(arch))
  const bundle = await extractNativePayload(input, output, channel as "stable" | "canary", platform as "linux" | "macos", arch as "x64" | "arm64")
  if (process.env.GITHUB_ENV) await Bun.write(Bun.file(process.env.GITHUB_ENV), (await Bun.file(process.env.GITHUB_ENV).text()) + `UNIX_PAYLOAD=${path.resolve(bundle)}\n`)
  console.log(bundle)
}
