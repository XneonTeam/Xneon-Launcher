import type { IpcInvokeMap, IpcEventMap } from "@xnlc/types"

type Invocation = {
  [Channel in keyof IpcInvokeMap]: { channel: Channel; args: IpcInvokeMap[Channel]["args"] }
}[keyof IpcInvokeMap]

export type LauncherEvent = {
  [Channel in keyof IpcEventMap]: { channel: Channel; payload: IpcEventMap[Channel] }
}[keyof IpcEventMap]

export type WindowControl = "minimize" | "maximize" | "restore" | "close"

export type LauncherRPC = {
  bun: {
    requests: {
      invoke: { params: Invocation; response: unknown }
      stageFileBegin: { params: { name: string; size: number }; response: { id: string; chunkBytes: number } }
      stageFileChunk: { params: { id: string; encoded: string; final: boolean }; response: string }
      stageFileAbort: { params: { id: string }; response: boolean }
      bootstrap: { params: undefined; response: { assetBase: string } }
    }
    messages: { windowControl: { action: WindowControl } }
  }
  webview: {
    requests: {}
    messages: { launcherEvent: LauncherEvent }
  }
}
