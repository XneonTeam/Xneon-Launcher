import type { DatapackMetadata } from "./datapack.js"
import type { JarInspection, JarInspectionRequest } from "./jar-inspector.js"

export type ScanFile = { filePath: string; size?: number; mtimeMs?: number; bytes?: Uint8Array }
export type ScanRequest = Omit<JarInspectionRequest, "signal"> & { datapack?: boolean }
export type ScanResult = { filePath: string; size?: number; mtimeMs?: number } & (
  { inspection: JarInspection; datapack?: never; error?: never } |
  { datapack: DatapackMetadata; inspection?: never; error?: never } |
  { error: string; inspection?: never; datapack?: never }
)
export type ScanWorkerData = { files: ScanFile[]; request: ScanRequest }
export type ScanWorkerCommand = { type: "cancel" } | { type: "skip"; filePaths: string[] }
export type ScanWorkerMessage =
  | { type: "chunk"; results: ScanResult[] }
  | { type: "skipped"; filePaths: string[] }
  | { type: "done"; inspected: number }
  | { type: "cancelled" }
  | { type: "fatal"; message: string }
