import { EventEmitter } from "node:events"
import type { IpcInvokeMap } from "@xnlc/types"
import type { LauncherEvent } from "./schema"
import { launcherOperations } from "./operation-gate"

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

const handlers = new Map<string, Handler>()
export const rpcRegistry = {
  handle<C extends keyof IpcInvokeMap>(
    channel: C,
    handler: (context: RpcContext, ...args: IpcInvokeMap[C]["args"]) => unknown,
  ) {
    if (handlers.has(channel)) throw new Error("Duplicate IPC handler: " + channel)
    handlers.set(channel, (context, args) => handler(context, ...args as IpcInvokeMap[C]["args"]))
  },
}

export function invokeHandler(sender: ViewSession, request: unknown) {
  if (!request || typeof request !== "object" || sender.isDestroyed()) throw new Error("Invalid RPC request")
  const { channel, args } = request as { channel?: unknown; args?: unknown }
  const handler = typeof channel === "string" ? handlers.get(channel) : undefined
  if (!handler || !Array.isArray(args)) throw new Error("Invalid RPC request")
  if (channel === "content:cancel-download"
    || channel === "share:cancel-install") return handler({ sender }, args)
  return launcherOperations.run(() => handler({ sender }, args))
}
