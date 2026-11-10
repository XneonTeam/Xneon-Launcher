import type { IpcInvokeMap } from "@xnlc/types"
import { rpcRegistry, type RpcContext } from "../../platform/desktop"

type Handler = (event: RpcContext, ...args: any[]) => any
const localHandlers = new Map<string, Handler>()
export const serverHistoryLocks = new Set<string>()
export const serverMutations = new Map<string, number>()
const mutatesServer = (channel: string) => /^mc-server:(start|stop|kill|update|delete|permanent-delete|fs-write|fs-delete|fs-rename|fs-mkdir|fs-download|datapacks-install|datapacks-delete|write-properties|install-pack|add-|remove-|ban-|unban-)/.test(channel)
export async function runServerMutation<T>(id: string, run: () => Promise<T>): Promise<T> {
  if (serverHistoryLocks.has(id)) throw new Error("HISTORY_BUSY")
  serverMutations.set(id, (serverMutations.get(id) ?? 0) + 1)
  try { return await run() } finally { const count = (serverMutations.get(id) ?? 1) - 1; if (count) serverMutations.set(id, count); else serverMutations.delete(id) }
}
function checkHistoryLock(channel: string, id: unknown) {
  if (typeof id === "string" && serverHistoryLocks.has(id) && /^mc-server:(start|stop|kill|update|delete|permanent-delete|fs-write|fs-delete|fs-rename|fs-mkdir|fs-download|datapacks-install|datapacks-delete|write-properties|install-pack|add-|remove-|ban-|unban-)/.test(channel)) throw new Error("HISTORY_BUSY")
}
let proxy: ((channel: string, id: string, args: unknown[]) => Promise<unknown>) | undefined
let listRemote: (() => Promise<unknown[]>) | undefined
export function configureRemoteServerProxy(invoke: NonNullable<typeof proxy>, list: NonNullable<typeof listRemote>) { proxy = invoke; listRemote = list }
export function registerMcServerHandler<C extends keyof IpcInvokeMap>(channel: C, handler: (context: RpcContext, ...args: IpcInvokeMap[C]["args"]) => any): void {
  localHandlers.set(channel, handler as Handler)
  rpcRegistry.handle(channel, async (event, ...args) => {
    if (typeof args[0] === "string" && args[0].startsWith("remote:")) {
      if (!proxy) throw new Error("Remote server connection is unavailable")
      return proxy(channel, args[0], args.slice(1))
    }
    checkHistoryLock(channel, args[0])
    const result = mutatesServer(channel) && typeof args[0] === "string" ? await runServerMutation(args[0], () => handler(event, ...args)) : await handler(event, ...args)
    if (channel === "mc-server:list" && listRemote) return [...result, ...await listRemote()]
    return result
  })
}
export async function executeLocalServerOperation(channel: string, id: string, args: unknown[] = []): Promise<any> {
  checkHistoryLock(channel, id)
  const handler = localHandlers.get(channel)
  if (!handler) throw new Error("Unsupported server operation")
  // Разрешённые удалённые команды не используют sender и не открывают системные диалоги.
  const run = async () => handler(undefined as unknown as RpcContext, id, ...args)
  return mutatesServer(channel) ? runServerMutation(id, run) : run()
}
