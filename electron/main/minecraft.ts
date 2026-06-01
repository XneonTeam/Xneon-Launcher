import { ipcMain } from "electron"
import type { AuthSession, LaunchRequestOptions, VersionInfo, XnlcHandler } from "@xnlc/core" with { "resolution-mode": "import" }
import { dbHelpers } from "../db"
import {
  callHandler,
  clearLaunchState,
  getGameDir,
  isLaunchActive,
  loadXnlcModule,
  resolveLaunchAccount,
  runLaunchWorker,
  stopLaunchWorker,
} from "./minecraft-core"
import { logRuntimeDebug } from "./runtime"

type LaunchAccountPayload = {
  type: "elyby" | "xnskins" | "microsoft" | "offline"
  username: string
  uuid?: string
  accessToken?: string
}

type LaunchRequestOptionsWithAccount = LaunchRequestOptions & {
  account?: LaunchAccountPayload
  buildName?: string
  gameDir?: string
}

type LaunchResultPayload = {
  success: boolean
  pid?: number
  error?: string
}

type MinecraftVersionInfo = {
  version: string
  stable: boolean
  type: string
}

type NoArgRegistration<T> = {
  channel: string
  label: string
  fallback: T
  action: (handler: XnlcHandler) => Promise<T>
}

type WithArgRegistration<TArg, TResult> = {
  channel: string
  label: string
  fallback: TResult
  action: (handler: XnlcHandler, arg: TArg) => Promise<TResult>
}

function registerHandler<T>({ channel, label, fallback, action }: NoArgRegistration<T>): void {
  ipcMain.handle(channel, async (): Promise<T> => callHandler(label, fallback, action))
}

function registerHandlerWithArg<TArg, TResult>({ channel, label, fallback, action }: WithArgRegistration<TArg, TResult>): void {
  ipcMain.handle(channel, async (_event: Electron.IpcMainInvokeEvent, arg: TArg): Promise<TResult> => {
    return callHandler(label, fallback, (handler) => action(handler, arg))
  })
}

function registerSupportedVersionsHandler(
  channel: string,
  label: string,
  action: (handler: XnlcHandler) => Promise<string[]>,
): void {
  registerHandler<string[]>({
    channel,
    label: `get supported ${label} versions`,
    fallback: [],
    action,
  })
}

function registerRecommendedHandler(
  channel: string,
  label: string,
  action: (handler: XnlcHandler, mcVersion: string) => Promise<string | undefined>,
): void {
  registerHandlerWithArg<string, string | null>({
    channel,
    label,
    fallback: null,
    action: async (handler, mcVersion) => await action(handler, mcVersion) ?? null,
  })
}

function registerVersionHandlers(): void {
  registerHandler<MinecraftVersionInfo[]>({
    channel: "minecraft:get-versions",
    label: "get versions",
    fallback: [],
    action: async (handler) => {
      const versions = await handler.getVersions()
      return versions.map((version: VersionInfo) => ({
        version: version.id,
        stable: version.type === "release",
        type: version.type,
      }))
    },
  })

  const stringHandlers: NoArgRegistration<string | null>[] = [
    {
      channel: "minecraft:get-latest-release",
      label: "get latest release",
      fallback: null,
      action: (handler) => handler.getLatestRelease(),
    },
    {
      channel: "minecraft:get-latest-snapshot",
      label: "get latest snapshot",
      fallback: null,
      action: (handler) => handler.getLatestSnapshot(),
    },
  ]

  const versionHandlers: WithArgRegistration<string, unknown[]>[] = [
    {
      channel: "minecraft:get-fabric-versions",
      label: "get Fabric versions",
      fallback: [],
      action: (handler, mcVersion) => handler.getFabricVersions(mcVersion),
    },
    {
      channel: "minecraft:get-liteloader-versions",
      label: "get LiteLoader versions",
      fallback: [],
      action: (handler, mcVersion) => handler.getLiteLoaderVersions(mcVersion),
    },
    {
      channel: "minecraft:get-quilt-versions",
      label: "get Quilt versions",
      fallback: [],
      action: (handler, mcVersion) => handler.getQuiltVersions(mcVersion),
    },
    {
      channel: "minecraft:get-neoforge-versions",
      label: "get NeoForge versions",
      fallback: [],
      action: async (handler, mcVersion) => {
        const versions = await handler.getNeoForgeVersions(mcVersion)
        return versions.map(v => ({ version: v, stable: !v.includes("beta") && !v.includes("alpha") && !v.includes("rc") }))
      },
    },
    {
      channel: "minecraft:get-forge-versions",
      label: "get Forge versions",
      fallback: [],
      action: async (handler, mcVersion) => {
        const versions = await handler.getForgeVersions(mcVersion)
        return versions.map(v => ({ version: v, stable: true }))
      },
    },
    {
      channel: "minecraft:get-optifine-versions",
      label: "get OptiFine versions",
      fallback: [],
      action: (handler, mcVersion) => handler.getOptifineVersions(mcVersion),
    },
  ]

  const simpleHandlers: Array<NoArgRegistration<{ version: string; stable: boolean }[] | string[]>> = [
    {
      channel: "minecraft:get-fabric-game-versions",
      label: "get Fabric game versions",
      fallback: [],
      action: (handler) => handler.getFabricGameVersions(),
    },
    {
      channel: "minecraft:get-fabric-supported",
      label: "get supported Fabric versions",
      fallback: [],
      action: (handler) => handler.getFabricSupportedVersions(),
    },
    {
      channel: "minecraft:get-quilt-game-versions",
      label: "get Quilt game versions",
      fallback: [],
      action: (handler) => handler.getQuiltGameVersions(),
    },
    {
      channel: "minecraft:get-neoforge-supported",
      label: "get supported NeoForge versions",
      fallback: [],
      action: (handler) => handler.getNeoForgeSupportedVersions(),
    },
    {
      channel: "minecraft:get-forge-supported",
      label: "get supported Forge versions",
      fallback: [],
      action: (handler) => handler.getForgeSupportedVersions(),
    },
    {
      channel: "minecraft:get-custom-versions",
      label: "get custom versions",
      fallback: [],
      action: (handler) => handler.getCustomVersions(),
    },
  ]

  stringHandlers.forEach(registerHandler)
  versionHandlers.forEach(registerHandlerWithArg)
  simpleHandlers.forEach(registerHandler)

  registerRecommendedHandler("minecraft:get-liteloader-recommended", "get recommended LiteLoader", (handler, mcVersion) => handler.getLiteLoaderRecommended(mcVersion))
  registerRecommendedHandler("minecraft:get-neoforge-recommended", "get recommended NeoForge", (handler, mcVersion) => handler.getNeoForgeRecommended(mcVersion))
  registerRecommendedHandler("minecraft:get-forge-recommended", "get recommended Forge", (handler, mcVersion) => handler.getForgeRecommended(mcVersion))

  registerHandler<string[]>({
    channel: "minecraft:get-quilt-supported",
    label: "get supported Quilt versions",
    fallback: [],
    action: async (handler) => await handler.getQuiltSupportedVersions(),
  })

  registerHandlerWithArg<string, string | null>({
    channel: "minecraft:get-optifine-recommended",
    label: "get recommended OptiFine",
    fallback: null,
    action: async (handler, mcVersion) => {
      const result = await handler.getOptifineRecommended(mcVersion)
      return result?.filename ?? null
    },
  })

  registerHandlerWithArg<string, AuthSession | null>({
    channel: "minecraft:set-offline-auth",
    label: "set offline auth",
    fallback: null,
    action: async (handler, username) => {
      handler.setOfflineAuth(username)
      return handler.getAuth()
    },
  })

  registerSupportedVersionsHandler("minecraft:get-liteloader-supported", "LiteLoader", (handler) => handler.getLiteLoaderSupportedVersions())
  registerSupportedVersionsHandler("minecraft:get-optifine-supported", "OptiFine", (handler) => handler.getOptifineSupportedVersions())
}

function registerLaunchHandlers(): void {
  ipcMain.handle("minecraft:launch", async (_event: Electron.IpcMainInvokeEvent, options: LaunchRequestOptionsWithAccount): Promise<LaunchResultPayload> => {
    const { resolveLaunchRequest } = await loadXnlcModule()
    const request = resolveLaunchRequest(options)

    try {
      if (isLaunchActive()) {
        return { success: false, error: "Minecraft is already launching or running" }
      }

      if ("error" in request) {
        return { success: false, error: request.error }
      }

      const launchAccount = await resolveLaunchAccount(options.account)
      if (!launchAccount) {
        return { success: false, error: "No active account. Please select an account first." }
      }

      logRuntimeDebug(`[Minecraft] Using account ${launchAccount.type}:${launchAccount.username}`)
      if (!launchAccount.isActive) {
        await dbHelpers.saveAccount({ ...launchAccount, isActive: true })
      }

      // Pass buildName and gameDir from options to runLaunchWorker
      const extendedRequest = {
        ...request,
        buildName: options.buildName,
        gameDir: options.gameDir,
      }

      return await runLaunchWorker(launchAccount, extendedRequest)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error("Launch failed:", errorMessage)
      clearLaunchState()
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle("minecraft:get-game-dir", async (): Promise<string> => getGameDir())
  ipcMain.handle("minecraft:is-running", async (): Promise<boolean> => isLaunchActive())
  ipcMain.handle("minecraft:stop", async (): Promise<void> => {
    if (!isLaunchActive()) {
      clearLaunchState()
      return
    }

    stopLaunchWorker()
  })

  registerHandler<AuthSession | null>({
    channel: "minecraft:get-auth",
    label: "get auth",
    fallback: null,
    action: async (handler) => handler.getAuth(),
  })
}

export function registerMinecraftHandlers(): void {
  registerVersionHandlers()
  registerLaunchHandlers()
  logRuntimeDebug("[Minecraft] Handlers registered")
}
