// ============================================================
// XNLC — клиент worker'а холодного сканирования JAR
// ============================================================
//
// Запускает `scan-worker.js` в отдельном потоке (аналог upload-worker.ts),
// собирает результаты чанками и гарантированно завершает поток: если worker
// почему-то не ответит, сканирование продолжится в main-процессе — падение
// потока не должно ломать открытие сборки.

import path from "path"
import { Worker } from "worker_threads"
import type { JarInspection } from "./jar-inspector"

type ScanFile = { filePath: string; size: number; mtime: number }

type ScanResult = {
  filePath: string
  size: number
  mtime: number
  inspection: JarInspection
}

type ScanMessage =
  | { type: "chunk"; results: ScanResult[] }
  | { type: "done"; inspected: number }
  | { type: "error"; filePath: string; message: string }

/** Таймаут на весь скан: воркер не должен подвешивать открытие сборки. */
const SCAN_TIMEOUT_MS = 120_000

/**
 * Инспектирует файлы в worker-потоке, вызывая `onResult` по мере готовности
 * чанков, и сообщает, какие файлы удалось обработать.
 *
 * `ok === false` означает, что воркер упал или не уложился в таймаут: часть
 * файлов уже обработана (их переразбирать нельзя — будут дубли), остаток
 * вызывающий код добирает локально.
 */
export async function runJarScanWorker(
  files: ScanFile[],
  onResult: (result: ScanResult) => void,
): Promise<{ ok: boolean; processedPaths: string[] }> {
  if (files.length === 0) return { ok: true, processedPaths: [] }

  const workerPath = path.join(__dirname, "scan-worker.js")

  return new Promise((resolve) => {
    let settled = false
    const processedPaths: string[] = []
    let worker: Worker
    let timer: NodeJS.Timeout | null = null

    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // terminate() не ждём: поток уже прислал done либо мы уходим в fallback.
      void worker.terminate().catch(() => {})
      resolve({ ok, processedPaths })
    }

    try {
      worker = new Worker(workerPath, { workerData: { files } })
    } catch {
      resolve({ ok: false, processedPaths: [] })
      return
    }

    timer = setTimeout(() => finish(false), SCAN_TIMEOUT_MS)
    timer.unref?.()

    worker.on("message", (message: ScanMessage) => {
      if (message.type === "chunk") {
        for (const result of message.results) {
          try {
            onResult(result)
            processedPaths.push(result.filePath)
          } catch {
            /* один битый файл не должен ронять весь скан */
          }
        }
        return
      }
      if (message.type === "done") {
        finish(true)
        return
      }
      if (message.type === "error") {
        // Ошибка отдельного файла: скан продолжается, файл просто пропущен.
        return
      }
    })

    worker.on("error", () => finish(false))
    // Выход без сообщения "done" — воркер упал: отдаём уже собранное, остаток
    // вызывающий код доберёт локально.
    worker.on("exit", () => finish(false))
  })
}