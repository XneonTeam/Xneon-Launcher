import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { packArchiveSync, readArchiveEntry } from "../../packages/xnlc-archives/src/index"
import { bundledWorker } from "../../electrobun/platform/resources"
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "../../electrobun/main/archives/protocol"

async function runWorker(request: ArchiveWorkerRequest, cancelOnProgress = false): Promise<ArchiveWorkerResponse> {
  const worker = new Worker(new URL("../../electrobun/main/archives/archive.worker.ts", import.meta.url).href, { smol: true })
  try {
    return await new Promise<ArchiveWorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Archive worker response timeout")), 5000)
      worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
        if (event.data.type === "progress") {
          if (cancelOnProgress) worker.postMessage({ type: "abort", id: request.id })
          return
        }
        clearTimeout(timeout)
        resolve(event.data)
      }
      worker.onerror = (event: ErrorEvent) => {
        clearTimeout(timeout)
        reject(new Error(event.message))
      }
      worker.postMessage(request)
    })
  } finally {
    await worker.terminate()
  }
}

test("имя упакованного archive worker совпадает с путём фасада", () => {
  // Сборщик использует --entry-naming=[name].js и исходник archive.worker.ts.
  expect(path.basename(bundledWorker("archive-worker"))).toBe("archive.worker.js")
})

test("smol-воркер обрабатывает AbortController и сохраняет прежний файл", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-worker-abort-"))
  try {
    const outputPath = path.join(root, "archive.zip")
    const { writeFile, readdir } = await import("node:fs/promises")
    await writeFile(outputPath, "previous archive")
    const response = await runWorker({ type: "pack", id: 3, outputPath,
      sources: Array.from({ length: 1000 }, (_, index) => ({ kind: "data", entryName: `entry-${index}`, data: Buffer.alloc(4096, index % 256) })),
    }, true)
    expect(response).toMatchObject({ type: "error", code: "ABORTED" })
    expect(await readFile(outputPath, "utf8")).toBe("previous archive")
    expect(await readdir(root)).toEqual(["archive.zip"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("smol-воркер упаковывает архив и возвращает result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-worker-pack-"))
  try {
    const outputPath = path.join(root, "archive.zip")
    expect(await runWorker({ type: "pack", id: 1, outputPath, sources: [
      { kind: "data", entryName: "config/мод.txt", data: Buffer.from("привет") },
    ] })).toMatchObject({ type: "result", files: 1 })
    expect((await readArchiveEntry(outputPath, "config/мод.txt"))?.toString()).toBe("привет")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("smol-воркер извлекает только выбранные записи и срезает префикс", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xnlc-worker-extract-"))
  try {
    const data = packArchiveSync({ "overrides/config/a.txt": Buffer.from("selected"), "ignored.txt": Buffer.from("ignored") })
    expect(await runWorker({ type: "extract", id: 2, destination: root, input: { data },
      entries: ["overrides/config/a.txt"], stripPrefix: "overrides/",
    })).toMatchObject({ type: "result", files: 1 })
    expect(await readFile(path.join(root, "config/a.txt"), "utf8")).toBe("selected")
    await expect(readFile(path.join(root, "ignored.txt"))).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
