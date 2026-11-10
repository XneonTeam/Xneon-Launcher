import { Electroview } from "electrobun/view"
import type { IpcInvokeMap, IpcEventMap } from "@xnlc/types"
import type { LauncherRPC, WindowControl } from "./schema"
import { rpcTimeout } from "./rpc-timeouts"

type Listener = (payload: IpcEventMap[keyof IpcEventMap]) => void
const listeners = new Map<keyof IpcEventMap, Set<Listener>>()
const rpc = Electroview.defineRPC<LauncherRPC>({
  maxRequestTime: 30_000,
  handlers: {
    messages: {
      launcherEvent: ({ channel, payload }) => {
        for (const listener of listeners.get(channel) ?? []) listener(payload)
      },
    },
  },
})

declare global {
  interface Window {
    xneonAssetBase?: string
    xneonStartupTheme?: string | null
  }
}

const desktop = typeof window.__electrobunWebviewId === "number"
if (desktop) new Electroview({ rpc })

export async function bootstrapDesktop() {
  if (!desktop) return
  window.xneonAssetBase = (await rpc.request.bootstrap(undefined, { maxRequestTime: 10_000 })).assetBase
}

export async function stageLocalFile(file: File) {
  if (!desktop || file.size > 64 * 1024 * 1024) return ""
  try {
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "")
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    return await rpc.request.stageFile({ name: file.name, encoded })
  } catch (error) {
    console.error("[Desktop] Unable to stage local file", error)
    return ""
  }
}

export const desktopRpc = {
  invoke<C extends keyof IpcInvokeMap>(channel: C, ...args: IpcInvokeMap[C]["args"]): Promise<IpcInvokeMap[C]["return"]> {
    const maxRequestTime = rpcTimeout(channel)
    return (rpc.request.invoke({ channel, args } as LauncherRPC["bun"]["requests"]["invoke"]["params"], {
      maxRequestTime,
    }) as Promise<IpcInvokeMap[C]["return"]>).catch(error => {
      if (error instanceof Error && error.message === "RPC request timed out.") {
        throw new Error(`RPC timeout: ${channel} (${maxRequestTime / 1000}s)`, { cause: error })
      }
      throw error
    })
  },
  controlWindow(action: WindowControl) { rpc.send.windowControl({ action }) },
  subscribe<C extends keyof IpcEventMap>(channel: C, callback: (payload: IpcEventMap[C]) => void) {
    const listener = callback as Listener
    const set = listeners.get(channel) ?? new Set<Listener>()
    set.add(listener)
    listeners.set(channel, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(channel)
    }
  },
}

export function installDesktopApi(api: import("@xnlc/types").ElectrobunAPI) {
  if (desktop) Object.defineProperty(window, "electrobunAPI", { value: Object.freeze(api) })
}

