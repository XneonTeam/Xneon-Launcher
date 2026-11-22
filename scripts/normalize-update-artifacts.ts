import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import packageJson from "../package.json"
import { appIdentifier } from "../electrobun/main/app-identity"

/** Сохраняет контракт клиентов 2.0.6; исходные manifest/checksum/archive не изменяются. */
export async function normalizeUpdateArtifacts(directory: string, channel: string, platform: string, arch: string, version: string) {
  assert.ok(["stable", "canary"].includes(channel) && ["win", "linux", "macos"].includes(platform) && ["x64", "arm64"].includes(arch))
  const prefix = `${channel}-${platform}-${arch}`
  const manifest = JSON.parse(await readFile(path.join(directory, prefix + "-update.json"), "utf8"))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.identifier, appIdentifier)
  for (const [key, expected] of Object.entries({ channel, platform, arch, version })) assert.equal(manifest[key], expected, "Unexpected update " + key)
  assert.match(manifest.hash, /^[a-z0-9]{1,64}$/)
  assert.ok(typeof manifest.artifact?.file === "string" && manifest.artifact.file.startsWith(prefix + "-") && /^[a-zA-Z0-9_.-]+\.tar\.zst$/.test(manifest.artifact.file), "Invalid archive name")
  const v2File = path.join(directory, prefix + "-update-v2.json")
  const previous = await readFile(v2File, "utf8").then(text => JSON.parse(text), error => { if (error.code !== "ENOENT") throw error; return null })
  const checksum = await readFile(path.join(directory, prefix + "-checksum.json"), "utf8").then(text => JSON.parse(text), error => { if (error.code !== "ENOENT") throw error; return null })
  assert.ok(checksum || previous, "Neither Hutch checksum nor legacy v2 integrity metadata is available")
  const integrity = checksum ?? { hash: previous.hash, ...previous.artifact }
  assert.equal(integrity.hash, manifest.hash, "Checksum belongs to another build")
  assert.ok(Number.isSafeInteger(integrity.tarSize) && integrity.tarSize > 0 && integrity.tarSize <= 2 * 1024 ** 3)
  assert.match(integrity.tarSha256, /^[a-f0-9]{64}$/)
  const compressed = Bun.file(path.join(directory, manifest.artifact.file))
  assert.ok(compressed.size > 0 && compressed.size <= 2 * 1024 ** 3)
  const tar = Bun.zstdDecompressSync(await compressed.arrayBuffer())
  assert.equal(tar.length, integrity.tarSize, "Hutch tar size mismatch")
  assert.equal(createHash("sha256").update(tar).digest("hex"), integrity.tarSha256, "Hutch tar digest mismatch")
  const expected = { ...manifest, artifact: { ...manifest.artifact, tarSize: integrity.tarSize, tarSha256: integrity.tarSha256 } }
  if (previous) assert.deepEqual(previous, expected, "Existing v2 metadata conflicts with Hutch metadata")
  else await writeFile(v2File, JSON.stringify(expected), { flag: "wx" })
}

if (import.meta.main) {
  const channel = Bun.argv[2]
  await normalizeUpdateArtifacts(path.resolve("release-electrobun", channel), channel, process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : process.platform, process.arch, packageJson.version)
}
