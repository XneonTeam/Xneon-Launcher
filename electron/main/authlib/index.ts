// ============================================================
// XNLC — Authlib-Injector module (main process)
// Внешний вход модуля: IPC + стартовый refresh метаданных.
// Внутренности: server.ts (resolve), yggdrasil.ts (API),
// service.ts (сессии), manager.ts (javaagent), errors.ts.
// ============================================================

export { registerAuthlibHandlers, refreshAuthServersInBackground } from "./handlers"
export { AuthlibInjectorManager, buildWorkerAuthlibPayload } from "./manager"
export { ensureSession } from "./service"
export {
  resolveAuthlibInjectorServer,
  refreshServer,
  fetchMetadata,
  normalizeServerUrl,
  makeServerId,
} from "./server"
export * from "./errors"
