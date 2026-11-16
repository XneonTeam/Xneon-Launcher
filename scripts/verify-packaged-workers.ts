import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { packArchiveSync, readArchiveEntry } from "../packages/xnlc-archives/src/index"
import { runScanWorker, setScanWorkerEntry } from "../packages/xnlc-parser/src/index"
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "../electrobun/main/archives/protocol"

const app = path.resolve(process.argv[2] || "build-electrobun/windows-staging/app")
await fs.mkdir(path.resolve(".tmp"), { recursive: true })
const directory = await fs.mkdtemp(path.resolve(".tmp/packaged-workers-"))
const entry = (name: string) => path.join(app, "Resources/app/bun/workers", name)
try {
  for (const name of ["minecraft-launch-worker.js", "archive.worker.js", "scan-worker.js"]) {
    const stat = await fs.stat(entry(name))
    assert.ok(stat.isFile() && stat.size > 1024, "Missing packaged worker: " + name)
  }
  const bundledMain = await fs.readFile(path.join(app, "Resources/app/bun/index.js"), "utf8")
  assert.ok(bundledMain.includes("scan-worker") && bundledMain.includes("setScanWorkerEntry"), "Main did not include scan-worker setup")
  const bytes = packArchiveSync({ "fabric.mod.json": Buffer.from('{"id":"demo","name":"Packaged Demo","version":"1"}') })
  const files = await Promise.all(Array.from({ length: 48 }, async (_, index) => {
    const filePath = path.join(directory, index + ".jar")
    await fs.writeFile(filePath, bytes)
    return { filePath }
  }))
  setScanWorkerEntry(entry("scan-worker.js"))
  let received = 0
  await runScanWorker(files, { metadata: true, sha1: true }, result => {
    assert.equal(result.inspection?.metadata?.name, "Packaged Demo")
    assert.match(result.inspection?.sha1 ?? "", /^[a-f0-9]{40}$/)
    received++
  })
  assert.equal(received, 48)
  const controller = new AbortController()
  await assert.rejects(runScanWorker(files, { metadata: true }, () => controller.abort(), controller.signal), { name: "AbortError" })

  async function archive(request: ArchiveWorkerRequest): Promise<ArchiveWorkerResponse> {
    const worker = new Worker(entry("archive.worker.js"), { smol: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Packaged archive worker timed out")), 10_000)
        worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
          if (event.data.type === "error") reject(new Error(event.data.message))
          else if (event.data.type === "result") resolve(event.data)
        }
        worker.onerror = (event: ErrorEvent) => reject(new Error(event.message))
        worker.postMessage(request)
      })
    } finally { clearTimeout(timer); await worker.terminate() }
  }
  const outputPath = path.join(directory, "output.zip")
  await archive({ type: "pack", id: 1, outputPath, sources: [{ kind: "data", data: Buffer.from("packaged"), entryName: "config/test.txt" }] })
  assert.equal((await readArchiveEntry(outputPath, "config/test.txt"))?.toString(), "packaged")
  await archive({ type: "extract", id: 2, input: { path: outputPath }, destination: path.join(directory, "extracted"), entries: null })
  assert.equal(await fs.readFile(path.join(directory, "extracted/config/test.txt"), "utf8"), "packaged")
  console.log(JSON.stringify({ app, scanFiles: received, scanCancellation: "passed", archivePackExtract: "passed", workers: 3 }))
} finally {
  setScanWorkerEntry()
  await fs.rm(directory, { recursive: true, force: true })
}
