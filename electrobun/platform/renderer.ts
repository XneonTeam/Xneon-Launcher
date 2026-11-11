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

/** Размер чанка при передаче файла в main; должен совпадать с `staged-files.ts`. */
const STAGE_CHUNK_BYTES = 8 * 1024 * 1024
/** Предел одного файла — как в `staged-files.ts`. */
const STAGE_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024

/** base64 без раздувания стека: `String.fromCharCode(...bytes)` падает на больших массивах. */
function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

export async function bootstrapDesktop() {
  if (!desktop) return
  window.xneonAssetBase = (await rpc.request.bootstrap(undefined, { maxRequestTime: 10_000 })).assetBase
}

export async function stageLocalFile(file: File) {
  if (!desktop || file.size > STAGE_MAX_FILE_BYTES) return ""
  let id = ""
  try {
    const begun = await rpc.request.stageFileBegin({ name: file.name, size: file.size }, { maxRequestTime: 30_000 })
    id = begun.id
    const chunkBytes = Math.max(1, Math.min(STAGE_CHUNK_BYTES, begun.chunkBytes))
    for (let offset = 0; offset < file.size; offset += chunkBytes) {
      const end = Math.min(offset + chunkBytes, file.size)
      const encoded = toBase64(await file.slice(offset, end).arrayBuffer())
      const final = end >= file.size
      const path = await rpc.request.stageFileChunk({ id, encoded, final }, { maxRequestTime: 300_000 })
      if (final) return path
    }
    // Пустой файл: один пустой чанк создаёт сам файл.
    return await rpc.request.stageFileChunk({ id, encoded: "", final: true }, { maxRequestTime: 300_000 })
  } catch (error) {
    console.error("[Desktop] Unable to stage local file", error)
    if (id) void rpc.request.stageFileAbort({ id }).catch(() => {})
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

