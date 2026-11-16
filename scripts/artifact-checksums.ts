import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { lstat, readFile, readdir } from "node:fs/promises"
import path from "node:path"

type ArtifactChecksum = { file: string; size: number; sha256: string }

/** Один поток на файл; одинаковые path/file guards для staging, signing и публикации. */
export async function artifactChecksums(directory: string, files: string[]): Promise<ArtifactChecksum[]> {
  assert.equal(new Set(files).size, files.length, "Duplicate checksum paths")
  const entries: ArtifactChecksum[] = []
  for (const file of [...files].sort()) {
    assert.ok(path.basename(file) === file && !/[\r\n\\]/.test(file), "Invalid checksum path")
    const info = await lstat(path.join(directory, file))
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0, "Invalid artifact: " + file)
    const hash = createHash("sha256")
    for await (const chunk of Bun.file(path.join(directory, file)).stream()) hash.update(chunk)
    entries.push({ file, size: info.size, sha256: hash.digest("hex") })
  }
  return entries
}

export function formatChecksums(entries: ArtifactChecksum[]): string {
  return entries.map(entry => `${entry.sha256}  ${entry.file}`).join("\n") + "\n"
}

export async function checksumText(directory: string, files: string[]): Promise<string> {
  return formatChecksums(await artifactChecksums(directory, files))
}

export async function verifyChecksums(directory: string, files: string[]): Promise<void> {
  assert.deepEqual((await readdir(directory)).sort(), [...files, "SHA256SUMS.txt"].sort(), "Unexpected publication files")
  assert.equal(await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8"), await checksumText(directory, files), "Publication checksum mismatch")
}
