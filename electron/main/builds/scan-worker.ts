// ============================================================
// XNLC — worker холодного сканирования JAR
// ============================================================
//
// Разбор нового JAR (чтение файла, ZIP, метаданные, отпечаток CurseForge,
// murmur по всем байтам) — CPU- и IO-тяжёлая работа, которая выполнялась в
// main-процессе и морозила интерфейс: на сборке в 163 мода холодный скан
// занимал около 4 секунд, и всё это время event loop был занят.
//
// Здесь та же инспекция выполняется в отдельном потоке (worker_threads), а main
// получает готовые результаты и только пишет их в SQLite (better-sqlite3
// остаётся в main — синхронный движок в потоке дал бы больше накладных
// расходов, чем выигрыша).
//
// Модули инспекции намеренно не тянут electron (см. archive-utils.ts), иначе
// worker не смог бы их загрузить.

import { parentPort, workerData } from "worker_threads"
import { inspectJar, type JarInspection } from "./jar-inspector"

type ScanWorkerFile = { filePath: string; size: number; mtime: number }

type ScanWorkerData = {
  files: ScanWorkerFile[]
  /** Сколько файлов обрабатывать за раз, прежде чем отправить промежуточный результат. */
  chunkSize?: number
}

type ScanWorkerResult = {
  filePath: string
  size: number
  mtime: number
  inspection: JarInspection
}

type ScanWorkerMessage =
  | { type: "chunk"; results: ScanWorkerResult[] }
  | { type: "done"; inspected: number }
  | { type: "error"; filePath: string; message: string }

async function run(): Promise<void> {
  const port = parentPort
  if (!port) return

  const { files, chunkSize = 8 } = workerData as ScanWorkerData
  let inspected = 0

  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    // Внутри чанка — параллельно (как и в main-версии): это IO-bound чтение.
    const settled = await Promise.all(chunk.map(async (file): Promise<ScanWorkerResult | null> => {
      try {
        const inspection = await inspectJar(file.filePath, {
          sha1: true,
          metadata: true,
          curseforgeFingerprint: true,
        }, { size: file.size, mtimeMs: file.mtime })
        return { filePath: file.filePath, size: file.size, mtime: file.mtime, inspection }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        port.postMessage({ type: "error", filePath: file.filePath, message } satisfies ScanWorkerMessage)
        return null
      }
    }))

    const results = settled.filter((entry): entry is ScanWorkerResult => entry !== null)
    inspected += results.length
    if (results.length > 0) {
      port.postMessage({ type: "chunk", results } satisfies ScanWorkerMessage)
    }
  }

  port.postMessage({ type: "done", inspected } satisfies ScanWorkerMessage)
}

run().catch((error) => {
  try {
    parentPort?.postMessage({ type: "error", filePath: "", message: error instanceof Error ? error.message : String(error) } satisfies ScanWorkerMessage)
    parentPort?.postMessage({ type: "done", inspected: 0 } satisfies ScanWorkerMessage)
  } catch {
    /* поток уже завершается */
  }
})

export type { ScanWorkerData, ScanWorkerResult, ScanWorkerMessage }