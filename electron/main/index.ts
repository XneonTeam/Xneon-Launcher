try { require("dotenv/config") } catch {}
import "./auth"

import { registerModsHandlers } from "./mods"
import { registerBuildHandlers } from "./builds"
import { registerCloudHandlers } from "./cloud/handlers"
import { registerP2PHandlers } from "./p2p"
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

registerWindowLifecycle()
registerSystemHandlers()
registerModsHandlers()
registerBuildHandlers()
registerCloudHandlers()
registerMinecraftHandlers()
registerWorldsHandlers()
registerServerHandlers()

registerP2PHandlers()
registerQuickPlayHandlers()
registerUpdater()
registerAiAgent()
registerSkinsHandlers()
registerMcServerHandlers()

import("@xnlc/mods").catch(() => {})
import("./discord-rpc.js").catch(() => {})

