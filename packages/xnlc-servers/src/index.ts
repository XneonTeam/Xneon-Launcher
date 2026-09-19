// ============================================================
// @xnlc/servers — Entry Point
// Minecraft Server management library
// ============================================================

// Server process management
export { ServerManager, serverManager } from "./server-manager.js"

// Детект готовности сервера по маркеру в консоли (startup-детект)
export {
  STARTUP_DONE_PATTERNS,
  STOPPING_PATTERNS,
  EULA_PROMPT_PATTERN,
  isStartupDoneLine,
  isStoppingLine,
} from "./startup-detection.js"

// JAR downloading & installation
export {
  ensureServerJar,
  getPaperVersions,
  getPaperBuilds,
  getPurpurVersions,
  getPurpurBuilds,
  getFoliaVersions,
  getFoliaBuilds,
  getVelocityVersions,
  getVelocityBuilds,
  getWaterfallVersions,
  getWaterfallBuilds,
  getSpongeSupportedVersions,
  getSpongeBuilds,
} from "./jar-downloader.js"
export type { DownloadProgress, LoaderVersionEntry, McVersionEntry, SpongeType } from "./jar-downloader.js"

// JAR analysis
export { analyzeServerJar } from "./jar-analyzer.js"
export type { JarAnalysisResult } from "./jar-analyzer.js"

// Server status (SLP ping)
export { pingServer, parseHost } from "./status.js"
export type { ServerStatusResult } from "./status.js"
