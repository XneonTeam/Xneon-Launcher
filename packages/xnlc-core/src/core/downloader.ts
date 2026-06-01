// ============================================================
// XNLC — Downloader
// Robust task-oriented downloader inspired by Prism Launcher's NetJob
// Author: MAINER4IK
// ============================================================

import * as fs from "fs";
import * as path from "path";
import * as fsSync from "fs";
import { sha1Hash, ensureDirSync } from "../utils/index.js";
import { DownloadProgressCallback } from "../types/index.js";

export interface DownloadOptions {
  url: string;
  fallbackUrls?: string[];
  dest: string;
  sha1?: string;
  size?: number;
  onProgress?: DownloadProgressCallback;
  retries?: number;
  skipIfExists?: boolean;
}

export interface TaskStatus {
  fileName: string;
  downloaded: number;
  total: number;
  percent: number;
  status: "pending" | "downloading" | "completed" | "failed";
  error?: string;
}

/**
 * A single download task.
 */
export class DownloadTask {
  public status: TaskStatus;
  private currentAttempt = 0;

  constructor(public options: DownloadOptions) {
    this.status = {
      fileName: options.dest ? (fsSync.existsSync(options.dest) ? options.dest : "unknown") : "unknown",
      downloaded: 0,
      total: options.size ?? 0,
      percent: 0,
      status: "pending",
    };
    if (options.dest) {
      this.status.fileName = options.dest.split(/[\\/]/).pop() || "unknown";
    }
  }

  async execute(): Promise<void> {
    const { url, fallbackUrls = [], dest, sha1: expectedSha1, size: expectedSize, onProgress, retries = 3, skipIfExists = true } = this.options;
    
    if (!url) {
      this.status.status = "completed";
      return;
    }

    const candidateUrls = Array.from(new Set([url, ...fallbackUrls].filter(Boolean)));

    // Check if file already exists and is valid
    if (skipIfExists && fsSync.existsSync(dest)) {
      const stats = fsSync.statSync(dest);
      
      if (stats.isDirectory()) {
        // dest is a directory; remove it so we can download the file
        fsSync.rmSync(dest, { recursive: true, force: true });
      } else {
        let isValid = true;
        
        if (expectedSha1) {
          let actualSha1: string;
          try {
            actualSha1 = sha1Hash(fsSync.readFileSync(dest));
          } catch {
            isValid = false;
          }
          if (actualSha1! !== expectedSha1) isValid = false;
        } else if (typeof expectedSize === "number" && expectedSize > 0 && stats.size !== expectedSize) {
          isValid = false;
        }

        if (isValid) {
          this.status.status = "completed";
          this.status.downloaded = stats.size;
          this.status.total = stats.size;
          this.status.percent = 100;
          return;
        }
      }
    }

    ensureDirSync(path.dirname(dest));

    this.status.status = "downloading";
    let lastError: Error | null = null;

    for (const candidateUrl of candidateUrls) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        this.currentAttempt = attempt;
        try {
          await this.downloadOnce(candidateUrl, dest, expectedSha1, onProgress);
          this.status.status = "completed";
          this.status.percent = 100;
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      }
    }

    this.status.status = "failed";
    this.status.error = lastError?.message;
    throw lastError ?? new Error(`Failed to download ${url} after ${retries} attempts`);
  }

  private async downloadOnce(
    url: string,
    dest: string,
    expectedSha1: string | undefined,
    onProgress: DownloadProgressCallback | undefined,
  ): Promise<void> {
    if (url.startsWith("file://")) {
      const sourcePath = url.slice(7);
      if (!fsSync.existsSync(sourcePath)) throw new Error(`File not found: ${sourcePath}`);
      ensureDirSync(path.dirname(dest));
      fsSync.copyFileSync(sourcePath, dest);
      return;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

    const totalSize = parseInt(res.headers.get("content-length") ?? "0", 10);
    this.status.total = totalSize > 0 ? totalSize : this.status.total;
    
    const tempPath = `${dest}.tmp`;
    // Remove any stale .tmp file/dir
    if (fsSync.existsSync(tempPath)) {
      const s = fsSync.statSync(tempPath);
      if (s.isDirectory())
        fsSync.rmSync(tempPath, { recursive: true, force: true });
      else
        fsSync.rmSync(tempPath);
    }
    ensureDirSync(path.dirname(tempPath));
    
    const writeStream = fsSync.createWriteStream(tempPath);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No reader for response body");

    let downloaded = 0;
    let rejectStream: ((err: Error) => void) | undefined;
    const streamError = new Promise<void>((_, reject) => {
      rejectStream = reject;
    });
    writeStream.on("error", rejectStream!);

    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), streamError]) as any;
        if (done) break;

        downloaded += value.length;
        this.status.downloaded = downloaded;
        if (this.status.total > 0) {
          this.status.percent = Math.round((downloaded / this.status.total) * 100);
        }

        if (onProgress) {
          onProgress({
            fileName: this.status.fileName,
            file: dest,
            downloaded,
            total: this.status.total,
            percent: this.status.percent,
          });
        }

        await new Promise<void>((resolve, reject) => {
          writeStream.write(Buffer.from(value), (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      await new Promise<void>((resolve) => writeStream.end(resolve));

      if (expectedSha1) {
        const actualSha1 = sha1Hash(fsSync.readFileSync(tempPath));
        if (actualSha1 !== expectedSha1) {
          throw new Error(`SHA1 mismatch: expected ${expectedSha1}, got ${actualSha1}`);
        }
      }

      if (fsSync.existsSync(dest)) {
        const s = fsSync.statSync(dest);
        if (s.isDirectory())
          fsSync.rmSync(dest, { recursive: true, force: true });
        else
          fsSync.rmSync(dest);
      }
      fsSync.renameSync(tempPath, dest);
    } finally {
      if (fsSync.existsSync(tempPath)) {
        try {
          const s = fsSync.statSync(tempPath);
          if (s.isDirectory())
            fsSync.rmSync(tempPath, { recursive: true, force: true });
          else
            fsSync.rmSync(tempPath);
        } catch {}
      }
      writeStream.removeListener("error", rejectStream!);
    }
  }
}

/**
 * A job containing multiple tasks, executing them in parallel with a concurrency limit.
 */
export class DownloadJob {
  private tasks: DownloadTask[] = [];
  private concurrency: number;

  constructor(public name: string, concurrency = 5) {
    this.concurrency = concurrency;
  }

  addTask(options: DownloadOptions): DownloadTask {
    const task = new DownloadTask(options);
    this.tasks.push(task);
    return task;
  }

  async execute(): Promise<void> {
    const queue = [...this.tasks];
    const workers: Promise<void>[] = [];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (task) {
          try {
            await task.execute();
          } catch (e) {
            console.error(`[DownloadJob:${this.name}] Task failed: ${task.options.url}`, e);
          }
        }
      }
    };

    for (let i = 0; i < Math.min(this.concurrency, this.tasks.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    const failed = this.tasks.filter(t => t.status.status === "failed");
    if (failed.length > 0) {
      throw new Error(`Job "${this.name}" failed with ${failed.length} errors. First error: ${failed[0].status.error}`);
    }
  }

  get stats() {
    const total = this.tasks.length;
    const completed = this.tasks.filter(t => t.status.status === "completed").length;
    const failed = this.tasks.filter(t => t.status.status === "failed").length;
    const downloading = this.tasks.filter(t => t.status.status === "downloading").length;
    
    return { total, completed, failed, downloading };
  }
}

/**
 * Legacy Downloader class for backward compatibility.
 */
export class Downloader {
  async download(options: DownloadOptions): Promise<void> {
    const task = new DownloadTask(options);
    await task.execute();
  }

  async downloadMultiple(items: DownloadOptions[], concurrency = 5): Promise<void> {
    const job = new DownloadJob("LegacyMulti", concurrency);
    for (const item of items) {
      job.addTask(item);
    }
    await job.execute();
  }
}
