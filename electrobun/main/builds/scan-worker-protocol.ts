import type { JarInspection } from "./jar-inspector"
export type ScanFile = { filePath: string; size: number; mtime: number }
export type ScanResult = ScanFile & { inspection: JarInspection }
export type ScanOutcome = {
  state: "success" | "partial" | "failed" | "cancelled"
  ok: boolean
  processedPaths: string[]
  errors: { filePath: string; message: string }[]
}
export type ScanWorkerMessage =
  | { type: "chunk"; results: ScanResult[] }
  | { type: "error"; filePath: string; message: string }
  | { type: "failed"; message: string }
  | { type: "done"; inspected: number }
