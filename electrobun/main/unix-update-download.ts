import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, open, rename, rm, statfs } from "node:fs/promises"
import path from "node:path"
import { updateFeedGet } from "./verified-update-feed"
import { UPDATE_MAX_BYTES, type UnixUpdateFile } from "./update-manifest"
import { isTrustedUnixUpdateBase, type UnixFeedRequest } from "./unix-update-feed"

export async function assertUpdateFreeSpace(directory: string, required: number) {
  assert.ok(Number.isSafeInteger(required) && required > 0, "Invalid required update space")
  const info = await statfs(directory, { bigint: true })
  if (info.bavail * info.bsize < BigInt(required)) throw Object.assign(new Error("Insufficient free space for update"), { code: "ENOSPC" })
}

/** Выходной файл становится доступен только после проверки полного потока и fsync. */
export async function downloadUnixUpdateFile(base: string, artifact: UnixUpdateFile, root: string, options: {
  channel: "stable" | "canary"; version: string
  request?: UnixFeedRequest; signal?: AbortSignal
  onProgress?: (value: { percent: number; transferred: number; total: number }) => void
}) {
  assert.ok(isTrustedUnixUpdateBase(base, options.channel, options.version), "Untrusted update download origin")
  assert.ok(typeof artifact.file === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}$/.test(artifact.file) && artifact.file !== "..", "Unsafe update filename")
  assert.ok(Number.isSafeInteger(artifact.downloadSize) && artifact.downloadSize > 0 && artifact.downloadSize <= UPDATE_MAX_BYTES, "Invalid update download size")
  assert.match(artifact.downloadSha256, /^[a-f0-9]{64}$/)
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000)
  signal.throwIfAborted()
  await mkdir(root, { recursive: true, mode: 0o700 })
  assert.ok((await lstat(root)).isDirectory(), "Unsafe update download directory")
  await assertUpdateFreeSpace(root, artifact.downloadSize + 1024 ** 2)
  const directory = await mkdtemp(path.join(path.resolve(root), "download-"))
  const temporary = path.join(directory, "download.partial")
  try {
    options.onProgress?.({ percent: 0, transferred: 0, total: artifact.downloadSize })
    const response = await (options.request ?? updateFeedGet)(`${base}/${artifact.file}`, signal)
    assert.ok(response?.ok && response.body, "Update download failed")
    const reader = response.body.getReader()
    const abortReader = () => { void reader.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener("abort", abortReader, { once: true })
    let file: Awaited<ReturnType<typeof open>> | undefined
    const hash = createHash("sha256")
    let size = 0
    try {
      signal.throwIfAborted()
      file = await open(temporary, "wx", 0o600)
      for (;;) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        size += value.length
        assert.ok(size <= artifact.downloadSize, "Downloaded update exceeds signed size")
        hash.update(value)
        await file.writeFile(value)
        options.onProgress?.({ percent: Math.min(99, Math.floor(size / artifact.downloadSize * 100)), transferred: size, total: artifact.downloadSize })
      }
      assert.equal(size, artifact.downloadSize, "Downloaded update size differs from signed manifest")
      assert.equal(hash.digest("hex"), artifact.downloadSha256, "Downloaded update SHA-256 differs from signed manifest")
      signal.throwIfAborted()
      await file.sync()
    } finally {
      signal.removeEventListener("abort", abortReader)
      try { await file?.close() } finally { await reader.cancel().catch(() => {}) }
    }
    assert.equal((await lstat(temporary)).size, artifact.downloadSize)
    const destination = path.join(directory, artifact.file)
    await rename(temporary, destination)
    options.onProgress?.({ percent: 100, transferred: artifact.downloadSize, total: artifact.downloadSize })
    return { directory, path: destination, artifact }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
