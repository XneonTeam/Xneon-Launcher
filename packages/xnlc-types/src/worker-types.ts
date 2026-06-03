// ============================================================
// @xnlc/types — Worker Types
// Message types for the forked launch worker process
// ============================================================

export type WorkerAccountPayload = {
  type: string
  username: string
  uuid?: string
  accessToken?: string
}

export type WorkerLaunchPayload = {
  gameDir: string
  account: WorkerAccountPayload
  options: {
    mcVersion: string
    loaderType: string
    loaderVersion?: string
    memoryMin: string
    memoryMax: string
    width: number
    height: number
    javaPath?: string
    retroauthEnabled: boolean
    useBmclapi?: boolean
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
