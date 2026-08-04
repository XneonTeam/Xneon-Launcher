import type { AuthSession, VersionInfo } from "@xnlc/core" with { "resolution-mode": "import" }
import type { MinecraftLaunchParams } from "@xnlc/types" with { "resolution-mode": "import" }
import {
  clearLaunchState,
  getGameDir,
  isLaunchActive,
  loadXnlcModule,
  resolveLaunchAccount,
  runLaunchWorker,
  stopLaunchWorker,
} from "./minecraft-core"
import { logRuntimeDebug } from "./runtime"
import { registerIpcHandlers, ctxHandler, rawHandler, type IpcHandlerDef } from "./ipc-router"

type LaunchResultPayload = {
  success: boolean
  pid?: number
  error?: string
}

// ---------- Version Handlers ----------

const versionHandlers: IpcHandlerDef[] = [
  ctxHandler("minecraft:get-versions", "get versions", [], async (handler) => {
    const versions = await handler.getVersions()
    return versions.map((version: VersionInfo) => ({
      version: version.id,
      stable: version.type === "release",
      type: version.type,
    }))
  }),

  ctxHandler("minecraft:get-latest-release", "get latest release", null,
    (handler) => handler.getLatestRelease()),

  ctxHandler("minecraft:get-latest-snapshot", "get latest snapshot", null,
    (handler) => handler.getLatestSnapshot()),

  // Fabric / LiteLoader / Quilt / NeoForge / Forge / OptiFine version queries (with mcVersion arg)
  ctxHandler("minecraft:get-fabric-versions", "get Fabric versions", [],
    (handler, mcVersion) => handler.getFabricVersions(mcVersion as string)),

  ctxHandler("minecraft:get-liteloader-versions", "get LiteLoader versions", [],
    (handler, mcVersion) => handler.getLiteLoaderVersions(mcVersion as string)),

  ctxHandler("minecraft:get-quilt-versions", "get Quilt versions", [],
    (handler, mcVersion) => handler.getQuiltVersions(mcVersion as string)),

  ctxHandler("minecraft:get-neoforge-versions", "get NeoForge versions", [], async (handler, mcVersion) => {
    const versions = await handler.getNeoForgeVersions(mcVersion as string)
    return versions.map(v => ({ version: v, stable: !v.includes("beta") && !v.includes("alpha") && !v.includes("rc") }))
  }),

  ctxHandler("minecraft:get-forge-versions", "get Forge versions", [], async (handler, mcVersion) => {
    const versions = await handler.getForgeVersions(mcVersion as string)
    return versions.map(v => ({ version: v, stable: true }))
  }),

  ctxHandler("minecraft:get-optifine-versions", "get OptiFine versions", [],
    (handler, mcVersion) => handler.getOptifineVersions(mcVersion as string)),

  // No-arg version queries
  ctxHandler("minecraft:get-fabric-game-versions", "get Fabric game versions", [],
    (handler) => handler.getFabricGameVersions()),

  ctxHandler("minecraft:get-fabric-supported", "get supported Fabric versions", [],
    (handler) => handler.getFabricSupportedVersions()),

  ctxHandler("minecraft:get-quilt-game-versions", "get Quilt game versions", [],
    (handler) => handler.getQuiltGameVersions()),

  ctxHandler("minecraft:get-neoforge-supported", "get supported NeoForge versions", [],
    (handler) => handler.getNeoForgeSupportedVersions()),

  ctxHandler("minecraft:get-forge-supported", "get supported Forge versions", [],
    (handler) => handler.getForgeSupportedVersions()),

  ctxHandler("minecraft:get-custom-versions", "get custom versions", [],
    (handler) => handler.getCustomVersions()),

  ctxHandler("minecraft:get-quilt-supported", "get supported Quilt versions", [],
    (handler) => handler.getQuiltSupportedVersions()),

  // Recommended version handlers (with mcVersion arg, return string | null)
  ctxHandler("minecraft:get-liteloader-recommended", "get recommended LiteLoader", null,
    async (handler, mcVersion) => await handler.getLiteLoaderRecommended(mcVersion as string) ?? null),

  ctxHandler("minecraft:get-neoforge-recommended", "get recommended NeoForge", null,
    async (handler, mcVersion) => await handler.getNeoForgeRecommended(mcVersion as string) ?? null),

  ctxHandler("minecraft:get-forge-recommended", "get recommended Forge", null,
    async (handler, mcVersion) => await handler.getForgeRecommended(mcVersion as string) ?? null),

  ctxHandler("minecraft:get-optifine-recommended", "get recommended OptiFine", null,
    async (handler, mcVersion) => {
      const result = await handler.getOptifineRecommended(mcVersion as string)
      return result?.filename ?? null
    }),

  // Supported MC versions for loaders
  ctxHandler("minecraft:get-liteloader-supported", "get supported LiteLoader versions", [],
    (handler) => handler.getLiteLoaderSupportedVersions()),

  ctxHandler("minecraft:get-optifine-supported", "get supported OptiFine versions", [],
    (handler) => handler.getOptifineSupportedVersions()),

  // Auth
  ctxHandler("minecraft:set-offline-auth", "set offline auth", null,
    async (handler, username) => {
      handler.setOfflineAuth(username as string)
      return handler.getAuth()
    }),

  ctxHandler("minecraft:get-auth", "get auth", null,
    async (handler) => handler.getAuth()),
]

// ---------- Launch Handlers ----------

const launchHandlers: IpcHandlerDef[] = [
  rawHandler("minecraft:launch", async (...args: unknown[]): Promise<LaunchResultPayload> => {
    const options = args[0] as MinecraftLaunchParams
    const { resolveLaunchRequest } = await loadXnlcModule()
    const request = resolveLaunchRequest(options as any)

    try {
      if (isLaunchActive()) {
        return { success: false, error: "Minecraft is already launching or running" }
      }

      if ("error" in request) {
        return { success: false, error: request.error }
      }

      const launchAccount = await resolveLaunchAccount(options.account as any)
      if (!launchAccount) {
        return { success: false, error: "No active account. Please select an account first." }
      }

      logRuntimeDebug(`[Minecraft] Using account ${launchAccount.type}:${launchAccount.username}`)
      if (!launchAccount.isActive) {
        const { dbHelpers } = await import("../db.js")
        await dbHelpers.saveAccount({ ...launchAccount, isActive: true })
      }

      const extendedRequest = {
        ...request,
        buildName: options.buildName,
        gameDir: options.gameDir,
        javaArgs: (options as { javaArgs?: string }).javaArgs,
      }

      return await runLaunchWorker(launchAccount, extendedRequest)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error("Launch failed:", errorMessage)
      clearLaunchState()
      return { success: false, error: errorMessage }
    }
  }),

  rawHandler("minecraft:get-game-dir", async () => getGameDir()),

  rawHandler("minecraft:is-running", async () => isLaunchActive()),

  rawHandler("minecraft:stop", async () => {
    if (!isLaunchActive()) {
      clearLaunchState()
      return
    }
    stopLaunchWorker()
  }),
]

export function registerMinecraftHandlers(): void {
  registerIpcHandlers([...versionHandlers, ...launchHandlers])
  logRuntimeDebug("[Minecraft] Handlers registered")
}
