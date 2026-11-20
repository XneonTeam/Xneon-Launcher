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
