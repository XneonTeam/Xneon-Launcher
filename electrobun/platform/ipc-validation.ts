/** Проверка сериализуемой границы; предметные ограничения проверяет handler. */
export function validateRpcValue(value: unknown, depth = 0, ancestors = new Set<object>(), budget = { nodes: 0 }): void {
  if (++budget.nodes > 1_000_000 || depth > 64) throw new Error("RPC value exceeds structural limits")
  if (value == null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Invalid RPC number"); return }
  if (typeof value !== "object") throw new Error("Unsupported RPC value")
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return
  if (ancestors.has(value)) throw new Error("Cyclic RPC value")
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Unsupported RPC object")
  ancestors.add(value)
  for (const item of Object.values(value)) validateRpcValue(item, depth + 1, ancestors, budget)
  ancestors.delete(value)
}

export function validateInvokeArgs(channel: string, args: unknown[]): void {
  if (args.length > 32) throw new Error("Invalid RPC arguments")
  validateRpcValue(args)
  if (["settings:get", "settings:set", "db:set-active-account", "db:remove-account"].includes(channel) && typeof args[0] !== "string") throw new Error("Invalid RPC argument type")
  if (channel === "settings:set" && typeof args[1] !== "string") throw new Error("Invalid setting value")
  if (channel === "liveops:select") {
    const ref = args[0] as { kind?: unknown; id?: unknown } | null
    if (args.length !== 1 || !ref || !["preset", "custom", "event"].includes(String(ref.kind)) || typeof ref.id !== "string" || !ref.id || ref.id.length > 160) throw new Error("Invalid theme reference")
  }
}

export function validateInvokeResult(channel: string, value: unknown): void {
  validateRpcValue(value)
  if (channel === "system:get-total-memory" && (typeof value !== "number" || value < 0)) throw new Error("Invalid IPC return value")
  if (channel === "settings:get" && value !== undefined && typeof value !== "string") throw new Error("Invalid IPC return value")
  if (channel === "db:load-accounts") {
    if (!Array.isArray(value)) throw new Error("Invalid public accounts result")
    const publicFields = new Set(["id", "type", "username", "isActive", "uuid", "skinUrl", "sortOrder", "serverId", "serverUrl", "serverName", "expiresAt"])
    for (const account of value) {
      if (!account || typeof account !== "object" || typeof account.id !== "string" || typeof account.username !== "string" || typeof account.isActive !== "boolean"
        || Object.keys(account).some(key => !publicFields.has(key))) throw new Error("Invalid public account DTO")
    }
  }
}
