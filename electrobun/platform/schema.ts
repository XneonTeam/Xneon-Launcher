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
      stageFile: { params: { name: string; encoded: string }; response: string }
      bootstrap: { params: undefined; response: { assetBase: string } }
    }
    messages: { windowControl: { action: WindowControl } }
  }
  webview: {
    requests: {}
    messages: { launcherEvent: LauncherEvent }
  }
}
