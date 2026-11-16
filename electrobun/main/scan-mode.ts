import fs from "node:fs"
import { setScanWorkerEntry } from "@xnlc/parser"
import { bundledWorker } from "../platform/resources"

/** Inline по умолчанию: benchmark не допускает незаметного роста CPU/RSS. */
export function configureLauncherScan(environment = process.env): "inline" | "worker" {
  const entry = bundledWorker("scan-worker")
  if (environment.XNLC_SCAN_WORKER === "1" && fs.existsSync(entry)) {
    setScanWorkerEntry(entry)
    return "worker"
  }
  setScanWorkerEntry()
  if (environment.XNLC_SCAN_WORKER === "1") console.warn("[Scan] Requested worker is missing; using inline scan")
  return "inline"
}
