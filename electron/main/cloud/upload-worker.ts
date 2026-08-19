import { parentPort, workerData } from "worker_threads"
import path from "path"
import fs from "fs/promises"
import AdmZip from "adm-zip"

interface ZipWorkerData {
  intentPath: string
  archivePath: string
}

interface ZipWorkerResult {
  ok: boolean
  archivePath?: string
  error?: string
}

async function run(): Promise<void> {
  const { intentPath, archivePath } = workerData as ZipWorkerData
  const post = (stage: "scan" | "compress", percent: number) => {
    parentPort?.postMessage({ type: "zip-progress", stage, percent } satisfies ZipProgressMessage)
  }

  try {
    post("scan", 5)
    const entries = await walkFiles(intentPath)
    const total = entries.length
    post("scan", 15)

    const zip = new AdmZip()
    for (let i = 0; i < total; i++) {
      const relPath = path.relative(intentPath, entries[i])
      zip.addLocalFile(entries[i], path.dirname(relPath).replace(/\\/g, "/"))
      const phase = (15 + Math.round((i + 1) / total * 70))
      post("compress", phase)
    }
    await fs.mkdir(path.dirname(archivePath), { recursive: true })
    zip.writeZip(archivePath)
    post("compress", 100)

    const result: ZipWorkerResult = { ok: true, archivePath }
    parentPort?.postMessage({ type: "zip-done", result } satisfies ZipDoneMessage)
  } catch (e) {
    const result: ZipWorkerResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
    parentPort?.postMessage({ type: "zip-done", result } satisfies ZipDoneMessage)
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await walkFiles(fullPath))
    } else {
      results.push(fullPath)
    }
  }
  return results
}

export type ZipProgressMessage = {
  type: "zip-progress"
  stage: "scan" | "compress"
  percent: number
}

export type ZipDoneMessage = {
  type: "zip-done"
  result: ZipWorkerResult
}

void run()