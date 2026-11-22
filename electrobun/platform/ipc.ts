import { EventEmitter } from "node:events"
import type { IpcInvokeMap } from "@xnlc/types"
import type { LauncherEvent } from "./schema"
import { launcherOperations } from "./operation-gate"
import { validateInvokeArgs, validateInvokeResult } from "./ipc-validation"
import { unixUpdateStartupBarrier } from "./unix-update-startup-barrier"

export class ViewSession extends EventEmitter {
  constructor(readonly id: number, private readonly deliver: (event: LauncherEvent) => void) {
    super()
  }

  private closed = false
  isDestroyed() { return this.closed }
  destroy() {
    this.closed = true
    this.emit("destroyed")
    this.removeAllListeners()
  }
  send(event: LauncherEvent) {
    if (!this.closed) this.deliver(event)
  }
}

export interface RpcContext { sender: ViewSession }
type Handler = (context: RpcContext, args: unknown[]) => unknown

/**
 * Каналы, которые сами управляют завершением и вызывают `launcherOperations.drain`.
 * Их нельзя оборачивать в `launcherOperations.run`: тогда операция ждала бы в
 * `drain` саму себя и всегда падала по таймауту (смена канала, установка обновления).
 */
const selfManagedChannels: ReadonlySet<string> = new Set([
  "update:install",
  "update:cancel-install",
  "update:set-channel",
  "startup:update-ready",
  "content:cancel-download",
  "share:cancel-install",
])

const handlers = new Map<string, Handler>()
export const rpcRegistry = {
  handle<C extends keyof IpcInvokeMap>(
    channel: C,
    handler: NoInfer<(context: RpcContext, ...args: IpcInvokeMap[C]["args"]) => IpcInvokeMap[C]["return"] | Promise<IpcInvokeMap[C]["return"]>>,
  ) {
    if (handlers.has(channel)) throw new Error("Duplicate IPC handler: " + channel)
    handlers.set(channel, (context, args) => {
      validateInvokeArgs(channel, args)
      const checked = (value: unknown) => { validateInvokeResult(channel, value); return value }
      const result = handler(context, ...args as IpcInvokeMap[C]["args"])
      return result && typeof (result as { then?: unknown }).then === "function" ? Promise.resolve(result).then(checked) : checked(result)
    })
  },
}

export function invokeHandler(sender: ViewSession, request: unknown) {
  if (!request || typeof request !== "object" || sender.isDestroyed()) throw new Error("Invalid RPC request")
  const { channel, args } = request as { channel?: unknown; args?: unknown }
  const handler = typeof channel === "string" ? handlers.get(channel) : undefined
  if (!handler || !Array.isArray(args)) throw new Error("Invalid RPC request")
  const startup = unixUpdateStartupBarrier.waitForRpc(String(channel))
  if (startup) return startup.then(() => invokeHandler(sender, request))
  if (typeof channel === "string" && selfManagedChannels.has(channel)) return handler({ sender }, args)
  return launcherOperations.run(() => handler({ sender }, args))
}
