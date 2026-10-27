// ============================================================
// @xnlc/types — Worker Types
// Message types for the forked launch worker process
// ============================================================

export type WorkerAccountPayload = {
  type: string
  username: string
  uuid?: string
  accessToken?: string
  // ── Authlib-Injector (заполняется только для type === "authlib-injector") ──
  serverId?: string
  serverUrl?: string
  serverName?: string
}

/** Данные запуска для аккаунта Authlib-Injector: где инжектор и какая метадата. */
export type WorkerAuthlibInjectorPayload = {
  /** Локальный путь к authlib-injector.jar (уже скачан/проверен) */
  injectorPath: string
  /** API root сервера с завершающим слэшем */
  serverUrl: string
  /** Base64 от JSON метаданных для -Dauthlibinjector.yggdrasil.prefetched */
  prefetchedMetadata?: string
}

export type WorkerLaunchPayload = {
  gameDir: string
  account: WorkerAccountPayload
  options: {
    mcVersion: string
    loaderType: string
    loaderVersion?: string
    customVersionPath?: string
    memoryMin: string
    memoryMax: string
    width: number
    height: number
    javaPath?: string
    javaArgs?: string
    retroauthEnabled: boolean
    /**
     * Authlib-Injector для аккаунта type === "authlib-injector".
     * Присутствует ⇒ воркер добавит -javaagent:authlib-injector.jar=<serverUrl>
     * + -Dauthlibinjector.side=client + -Dauthlibinjector.yggdrasil.prefetched.
     */
    authlibInjector?: WorkerAuthlibInjectorPayload
    useBmclapi?: boolean
    server?: string
    serverPort?: string
    preLaunchCommand?: string
    postLaunchCommand?: string
    wrapperCommand?: string
    customEnv?: Record<string, string>
    offlineUsername?: string
    buildName?: string
    buildId?: string
    quickPlaySingleplayer?: string
    quickPlayMultiplayer?: string
  }
}

export type WorkerMessage =
  | { type: "launch"; payload: WorkerLaunchPayload }
  | { type: "stop" }
  | { type: "progress"; progress: Record<string, unknown> }
  | { type: "java-progress"; progress: { type: string; percent: number; message: string } }
  | { type: "started"; pid?: number }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "close"; code: number }
  | { type: "error"; error: string }
  | { type: "worker-debug"; message: string }
