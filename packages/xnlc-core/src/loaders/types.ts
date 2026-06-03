// ============================================================
// XNLC — Loader Handler Interface
// Common interface for all mod loader handlers
// ============================================================

import type { LoaderInstallResult, DownloadProgressCallback } from "../types/index.js";

/**
 * Common interface for all mod loader handlers.
 * Only `install` is required; other methods are optional
 * since different loaders expose different capabilities.
 */
export interface ILoaderHandler {
  install(mcVersion: string, loaderVersion: string, onProgress?: DownloadProgressCallback): Promise<LoaderInstallResult>;
  getVersions?(mcVersion: string): Promise<string[]>;
  getSupportedMinecraftVersions?(): Promise<string[]>;
  getRecommendedVersion?(mcVersion: string): Promise<string | null | undefined>;
}
