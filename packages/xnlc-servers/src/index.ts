// ============================================================
// @xnlc/servers — Entry Point
// Minecraft Server management library
// ============================================================

// Server process management
export { ServerManager, serverManager } from "./server-manager.js"

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
} from "./jar-downloader.js"
export type { DownloadProgress, LoaderVersionEntry, McVersionEntry } from "./jar-downloader.js"

// JAR analysis
export { analyzeServerJar } from "./jar-analyzer.js"
export type { JarAnalysisResult } from "./jar-analyzer.js"

// Server status (SLP ping)
export { pingServer, parseHost } from "./status.js"
export type { ServerStatusResult } from "./status.js"
