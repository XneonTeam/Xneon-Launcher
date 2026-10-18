try { require("dotenv/config") } catch {}
import { app } from "electron"
import "./auth"

import { registerAvatarProtocolScheme, registerAvatarHandlers } from "./avatar"
import { registerModsHandlers } from "./mods"
import { registerBuildHandlers } from "./builds"
import { registerCloudHandlers } from "./cloud/handlers"
import { registerSystemHandlers } from "./system"
import { registerWindowLifecycle } from "./window"
import { registerMinecraftHandlers } from "./minecraft"
import { registerWorldsHandlers } from "./worlds"
import { registerServerHandlers } from "./servers"
import { registerQuickPlayHandlers } from "./quick-play"
import { registerUpdater } from "./updater"
import { registerAiAgent } from "./ai-agent"
import { registerSkinsHandlers } from "./skins"
import { registerMcServerHandlers } from "./mc-server-handlers"
import { registerStatsHandlers } from "./stats"
import { registerStorageHandlers } from "./storage"
import { xnConnectManager } from "./xn-connect-manager"
import { registerXnConnectHandlers } from "./xn-connect-handlers"
import { registerAuthlibHandlers } from "./authlib"

registerAvatarProtocolScheme()
registerWindowLifecycle()
registerSystemHandlers()
registerModsHandlers()
registerBuildHandlers()
registerCloudHandlers()
registerMinecraftHandlers()
registerWorldsHandlers()
registerServerHandlers()

registerQuickPlayHandlers()
registerUpdater()
registerAiAgent()
registerSkinsHandlers()
registerAvatarHandlers()
registerMcServerHandlers()
registerStatsHandlers()
registerStorageHandlers()
// XN-Connect: каналы в своём модуле (раньше жили внутри mc-server-handlers).
registerXnConnectHandlers()
registerAuthlibHandlers()

import("@xnlc/mods").catch(() => {})
import("./discord-rpc.js").catch(() => {})

/**
 * При выходе закрываем туннели XN-Connect: метод существовал, но не вызывался,
 * и relay-сессии оставались висеть после закрытия лаунчера.
 */
app.on("before-quit", () => {
  void xnConnectManager.stopAll().catch(() => {})
})

