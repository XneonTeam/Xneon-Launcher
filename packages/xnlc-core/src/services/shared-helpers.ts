// ============================================================
// XNLC — Shared internal helpers for services
// ============================================================

import * as path from "path";
import {
  VersionJson,
  DownloadProgress,
  DownloadProgressCallback,
} from "../types/index.js";
import { getVersionDir } from "../utils/index.js";

// ---------- Preparation Plan ----------

export type PreparationPlan = {
  totalFiles: number;
  totalBytes: number;
};

// ---------- Progress Tracker ----------

export class ProgressTracker {
  private completedFiles = 0;
  private completedBytes = 0;
  private activeBytes = new Map<string, number>();
  private finishedFiles = new Set<string>();

  constructor(
    private readonly plan: PreparationPlan,
    private readonly emit?: DownloadProgressCallback,
  ) {}

  onProgress = (progress: DownloadProgress): void => {
    if (!this.emit) return;

    const fileId = progress.file ?? progress.fileName ?? "__unknown__";
    const downloaded = progress.downloaded ?? progress.downloadedBytes ?? 0;
    const total = progress.total ?? 0;

    if (!this.finishedFiles.has(fileId)) {
      this.activeBytes.set(fileId, downloaded);
      if (total > 0 && downloaded >= total) {
        this.finishedFiles.add(fileId);
        this.completedFiles += 1;
        this.completedBytes += total;
        this.activeBytes.delete(fileId);
      }
    }

    const activeBytes = [...this.activeBytes.values()].reduce((sum, value) => sum + value, 0);
    const downloadedBytes = Math.min(this.plan.totalBytes, this.completedBytes + activeBytes);
    const percent = this.plan.totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / this.plan.totalBytes) * 100))
      : progress.percent;

    this.emit({
      ...progress,
      downloadedBytes,
      currentFile: Math.min(this.plan.totalFiles, this.completedFiles + this.activeBytes.size),
      totalFiles: this.plan.totalFiles,
      percent,
    });
  };
}

// ---------- Utility functions ----------

export function withStage(stage: string, callback?: DownloadProgressCallback): DownloadProgressCallback | undefined {
  if (!callback) return undefined;
  return (progress) => callback({ ...progress, type: stage });
}

export function resolveVersionId(versionJson: VersionJson, versionIdOverride?: string): string {
  return versionIdOverride ?? versionJson.inheritsFrom ?? versionJson.id;
}

export function formatLibrarySummary(versionJson: VersionJson): string {
  const total = versionJson.libraries.length;
  const nativeCandidates = versionJson.libraries.filter((lib) => !!lib.natives).length;
  const classifierDownloads = versionJson.libraries.filter((lib) => !!lib.downloads?.classifiers).length;
  return `libraries=${total} nativeCandidates=${nativeCandidates} classifierDownloads=${classifierDownloads}`;
}

export function compareVersionParts(a: string, b: string): number {
  const aParts = a.split(/[^0-9]+/).filter(Boolean).map((part) => parseInt(part, 10));
  const bParts = b.split(/[^0-9]+/).filter(Boolean).map((part) => parseInt(part, 10));
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return 0;
}
