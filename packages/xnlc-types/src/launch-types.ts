// ============================================================
// @xnlc/types — Launch Types
// Minecraft launch parameters, progress, and related structures
// ============================================================

export type MinecraftLaunchParams = {
  version: string
  modLoader: "vanilla" | "forge" | "fabric" | "quilt" | "liteloader" | "optifine" | "neoforge"
  loaderVersion?: string
  account: {
    type: string
    username: string
    uuid?: string
    accessToken?: string
  }
  memory: { min: string; max: string }
  javaPath?: string
  javaArgs?: string
  width?: number
  height?: number
  gameDirectory?: string
  /** @deprecated Use gameDirectory instead */
  gameDir?: string
  authlibInjectorEnabled?: boolean
  retroauthInjectorEnabled?: boolean
  buildName?: string
  buildId?: string
  server?: string
  serverPort?: string
  /** Quick Play: launch directly into a singleplayer world */
  quickPlaySingleplayer?: string
  /** Quick Play: launch directly into a multiplayer server */
  quickPlayMultiplayer?: string
  /** Pre-launch command executed before the game starts (supports $INST_* placeholders) */
  preLaunchCommand?: string
  /** Post-launch command executed after the game exits (supports $INST_* placeholders) */
  postLaunchCommand?: string
  /** Wrapper command prepended to the java invocation (e.g. optirun, primusrun) */
  wrapperCommand?: string
  /** Custom environment variables for the game process */
  customEnv?: Record<string, string>
  /** Offline username override (launch as offline with a specific nickname) */
  offlineUsername?: string
}

export type MinecraftProgress = {
  type?: string
  installationPhase?: string
  task?: number
  total?: number
  current?: number
  fileName?: string
  downloaded?: number
  downloadedBytes?: number
  percent?: number
  currentFile?: number
  totalFiles?: number
  name?: string
  breakdown?: {
    classes: { current: number; total: number }
    assets: { current: number; total: number }
    natives: { current: number; total: number }
  }
}

export type JavaProgress = {
  type: "download" | "extract"
  percent: number
  message: string
  downloaded?: number
  total?: number
}

export type LaunchRequestOptions = {
  mcVersion?: string
  version?: string
  modLoader?: string
  loaderType?: string
  loaderVersion?: string
  memoryMin?: string
  memoryMax?: string
  javaPath?: string
  width?: number
  height?: number
}

export type ResolvedLaunchRequest = {
  mcVersion: string
  loaderType: string
  loaderVersion?: string
  memoryMin: string
  memoryMax: string
  javaPath?: string
  width: number
  height: number
}
