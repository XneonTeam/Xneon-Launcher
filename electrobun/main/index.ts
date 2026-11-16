import { registerStagedFileCleanup } from "../platform/staged-files"
import { configureLauncherScan } from "./scan-mode"
try { require("dotenv/config") } catch {}
import { app, safeStorage } from "../platform/desktop"
import { configureAccountSecrets } from "../db/account-secrets"
import { registerShutdownTask, SHUTDOWN_PRIORITY } from "../platform/shutdown"
import { registerThemeFiles } from "./theme-files.js"
import "./auth"

import { registerAvatarHandlers } from "./avatar"
import { registerModsHandlers } from "./mods"
import { registerBuildHandlers } from "./builds"
import { registerCloudHandlers } from "./cloud/handlers"
import { registerSystemHandlers } from "./system"
import { registerWindowLifecycle } from "./window"
import { registerMinecraftHandlers } from "./minecraft"
import { registerWorldsHandlers } from "./worlds"
import { registerServerHandlers } from "./servers"
import { registerQuickPlayHandlers } from "./quick-play"
import { registerAiAgent } from "./ai-agent"
import { registerSkinsHandlers } from "./skins"
import { registerShareHandlers } from "./share"
import { registerMcServerHandlers } from "./mc-server-handlers"
import { registerRemoteServerHandlers } from "./remote-servers"
import { registerServerHistoryHandlers } from "./remote-servers/history-handlers"
import { registerServerHostSettingsHandlers } from "./remote-servers/host-settings"
import { registerStatsHandlers } from "./stats"
import { registerStorageHandlers } from "./storage"
import { xnConnectManager } from "./xn-connect-manager"
import { registerXnConnectHandlers } from "./xn-connect-handlers"
import { registerAuthlibHandlers } from "./authlib"
import { registerLiveopsHandlers } from "./liveops"

configureLauncherScan()

configureAccountSecrets(safeStorage)
registerStagedFileCleanup()
registerThemeFiles()
registerWindowLifecycle()
registerSystemHandlers()
registerModsHandlers()
registerBuildHandlers()
registerCloudHandlers()
registerMinecraftHandlers()
registerWorldsHandlers()
registerServerHandlers()

registerQuickPlayHandlers()
registerAiAgent()
registerSkinsHandlers()
registerShareHandlers()
registerAvatarHandlers()
registerMcServerHandlers()
registerRemoteServerHandlers()
registerServerHistoryHandlers()
registerServerHostSettingsHandlers()
registerStatsHandlers()
registerStorageHandlers()
// XN-Connect: каналы в своём модуле (раньше жили внутри mc-server-handlers).
registerXnConnectHandlers()
registerAuthlibHandlers()
registerLiveopsHandlers()

import("@xnlc/mods").catch(() => {})
import("./discord-rpc.js").catch(() => {})

/**
 * При выходе закрываем туннели XN-Connect: метод существовал, но не вызывался,
 * и relay-сессии оставались висеть после закрытия лаунчера.
 */
registerShutdownTask("xn-connect", () => xnConnectManager.stopAll(), { priority: SHUTDOWN_PRIORITY.network, timeoutMs: 2500 })

