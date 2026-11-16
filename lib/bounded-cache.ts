/** LRU с явным бюджетом и TTL; вытеснение не затрагивает данные на диске. */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, { value: V; weight: number; expires: number }>()
  private totalWeight = 0
  constructor(private readonly options: { capacity: number; maxWeight?: number; weight?: (value: V) => number; ttlMs?: number; now?: () => number }) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) throw new Error("Invalid cache capacity")
    if (options.maxWeight !== undefined && (Number.isNaN(options.maxWeight) || options.maxWeight < 0)) throw new Error("Invalid cache budget")
  }
  get size(): number { return this.entries.size }
  get weight(): number { return this.totalWeight }
  private now() { return this.options.now?.() ?? Date.now() }
  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= this.now()) { this.delete(key); return undefined }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }
  has(key: K): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    if (entry.expires <= this.now()) { this.delete(key); return false }
    return true
  }
  set(key: K, value: V, ttlMs = this.options.ttlMs ?? Infinity): this {
    if (Number.isNaN(ttlMs) || ttlMs < 0) throw new Error("Invalid cache TTL")
    this.delete(key)
    const weight = this.options.weight?.(value) ?? 1
    if (!Number.isFinite(weight) || weight < 0) throw new Error("Invalid cache weight")
    if (weight > (this.options.maxWeight ?? Infinity)) return this
    this.entries.set(key, { value, weight, expires: this.now() + ttlMs })
    this.totalWeight += weight
    while (this.entries.size > this.options.capacity || this.totalWeight > (this.options.maxWeight ?? Infinity)) this.delete(this.entries.keys().next().value!)
    return this
  }
  delete(key: K): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.totalWeight -= entry.weight
    return this.entries.delete(key)
  }
  clear(): void { this.entries.clear(); this.totalWeight = 0 }
}

/** Консервативная оценка UTF-16 и полей, без большого временного JSON.stringify. */
export function estimateCacheBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (typeof value === "string") return 24 + value.length * 2
  if (!value || typeof value !== "object") return 8
  if (seen.has(value)) return 0
  seen.add(value)
  let bytes = 32
  for (const [key, item] of Object.entries(value)) bytes += key.length * 2 + 16 + estimateCacheBytes(item, seen)
  return bytes
}
