import { expect, test } from "bun:test"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { normalizeUpdateArtifacts } from "../../scripts/normalize-update-artifacts"

test("Hutch checksum metadata restores the signed v2 contract without changing archive bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xneon-hutch-"))
  try {
    const tar = Buffer.from("archive fixture")
    const archive = Bun.zstdCompressSync(tar)
    const prefix = "stable-win-x64"
    const file = prefix + "-XneonLauncher.tar.zst"
    const manifest = { schemaVersion: 1, identifier: "org.xneon.launcher", version: "1.0.8", channel: "stable", platform: "win", arch: "x64", hash: "abc123", artifact: { file } }
    await writeFile(path.join(root, file), archive)
    await writeFile(path.join(root, prefix + "-update.json"), JSON.stringify(manifest))
    await writeFile(path.join(root, prefix + "-checksum.json"), JSON.stringify({ hash: "abc123", tarSize: tar.length, tarSha256: createHash("sha256").update(tar).digest("hex") }))
    await normalizeUpdateArtifacts(root, "stable", "win", "x64", "1.0.8")
    const v2 = JSON.parse(await readFile(path.join(root, prefix + "-update-v2.json"), "utf8"))
    expect(v2.artifact.tarSize).toBe(tar.length)
    expect(await readFile(path.join(root, file))).toEqual(Buffer.from(archive))
    await writeFile(path.join(root, prefix + "-checksum.json"), JSON.stringify({ hash: "wrong", tarSize: tar.length, tarSha256: v2.artifact.tarSha256 }))
    await expect(normalizeUpdateArtifacts(root, "stable", "win", "x64", "1.0.8")).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const channel of ["stable", "canary"]) {
  for (const [platform, arch] of [["win", "x64"], ["linux", "x64"], ["macos", "arm64"]]) {
    test(`адаптер сохраняет исходные bytes и идемпотентен: ${channel}-${platform}-${arch}`, async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xneon-hutch-matrix-"))
      try {
        const prefix = `${channel}-${platform}-${arch}`
        const version = channel === "stable" ? "1.0.8" : "1.0.8-beta1"
        const file = prefix + "-XneonLauncher.tar.zst"
        const tar = Buffer.from("archive fixture")
        const archive = Buffer.from(Bun.zstdCompressSync(tar))
        const manifest = JSON.stringify({ schemaVersion: 1, identifier: "org.xneon.launcher", version, channel, platform, arch, hash: "abc123", artifact: { file } }, null, 2)
        const checksum = JSON.stringify({ hash: "abc123", tarSize: tar.length, tarSha256: createHash("sha256").update(tar).digest("hex") }, null, 2)
        await writeFile(path.join(root, file), archive)
        await writeFile(path.join(root, prefix + "-update.json"), manifest)
        await writeFile(path.join(root, prefix + "-checksum.json"), checksum)
        for (let pass = 0; pass < 2; pass++) await normalizeUpdateArtifacts(root, channel, platform, arch, version)
        expect(await readFile(path.join(root, file))).toEqual(archive)
        expect(await readFile(path.join(root, prefix + "-update.json"), "utf8")).toBe(manifest)
        expect(await readFile(path.join(root, prefix + "-checksum.json"), "utf8")).toBe(checksum)
        // Старый v2 без нового checksum также остаётся допустимым входом.
        await rm(path.join(root, prefix + "-checksum.json"))
        await normalizeUpdateArtifacts(root, channel, platform, arch, version)
        const v2 = JSON.parse(await readFile(path.join(root, prefix + "-update-v2.json"), "utf8"))
        expect(v2.artifact.tarSize).toBe(tar.length)
        await writeFile(path.join(root, file), Bun.zstdCompressSync(Buffer.from("corrupt")))
        await expect(normalizeUpdateArtifacts(root, channel, platform, arch, version)).rejects.toThrow()
        await writeFile(path.join(root, file), archive)
        v2.artifact.tarSha256 = "0".repeat(64)
        await writeFile(path.join(root, prefix + "-update-v2.json"), JSON.stringify(v2))
        await expect(normalizeUpdateArtifacts(root, channel, platform, arch, version)).rejects.toThrow()
      } finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}
