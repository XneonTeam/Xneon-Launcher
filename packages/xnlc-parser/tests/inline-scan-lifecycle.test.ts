import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { pauseScanFiles, runScanWorker, setScanWorkerEntry } from "../src/scan-worker-client"

test("inline fallback ждёт закрытия читаемого файла перед удалением и не публикует устаревший результат", async () => {
  setScanWorkerEntry()
  const directory = await fs.mkdtemp(path.join(tmpdir(), "xnlc-inline-scan-"))
  const file = path.join(directory, "large.jar")
  try {
    await fs.writeFile(file, Buffer.alloc(64 * 1024 * 1024, 42))
    const started = Promise.withResolvers<void>()
    const results: { filePath: string; error?: string }[] = []
    const scanning = runScanWorker([{ filePath: file }], { sha1: true }, value => results.push(value))
    const timer = setTimeout(() => started.resolve(), 2)
    await started.promise
    clearTimeout(timer)
    await pauseScanFiles([file], async () => { await fs.rm(file) })
    await scanning
    expect(results).toHaveLength(1)
    expect(results[0].error).toBe("Content is being deleted")
    await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
