try { require("dotenv/config") } catch {}
import "./auth"
import "./discord-rpc"

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

