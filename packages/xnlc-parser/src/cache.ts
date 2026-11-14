import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { serialize } from "node:v8"
import { ParserError, type ArchiveOptions } from "./archive.js"
import { analyze, type ParserResult } from "./metadata.js"

interface Snapshot { size: number; mtimeMs: number; ctimeMs: number }
interface CacheEntry { snapshot: Snapshot; result: ParserResult; bytes: number }
interface Flight { controller: AbortController; result: Promise<ParserResult>; users: number }
function equal(a: Snapshot, b: Snapshot) { return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs }
async function snapshot(path: string): Promise<Snapshot> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new ParserError("IO_ERROR", "Archive does not exist")
  return { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }
}
function check(signal?: AbortSignal) { if (signal?.aborted) throw new ParserError("ABORTED", "Operation aborted") }

/** Ограниченный памятью кэш только для файловых входов; не является постоянным хранилищем. */
export class ParserCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly flights = new Map<string, Flight>()
  private generation = 0
  private hits = 0
  private misses = 0
  private weight = 0
  private evictions = 0
  constructor(readonly maxEntries = 128, readonly maxBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || maxEntries > 10000) throw new RangeError("Invalid cache size")
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid cache byte limit")
  }
  get size(): number { return this.entries.size }
  get stats(): Readonly<{ hits: number; misses: number }> { return { hits: this.hits, misses: this.misses } }
  get usage(): Readonly<{ bytes: number; evictions: number }> { return { bytes: this.weight, evictions: this.evictions } }
  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (entry) { this.weight -= entry.bytes; this.entries.delete(key) }
  }
  clear(): void { this.generation++; this.entries.clear(); this.weight = 0 }
  invalidate(path: string): void {
    this.generation++
    const prefix = `${resolve(path)}\0`
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.remove(key)
  }
  async analyze(path: string, options: ArchiveOptions = {}): Promise<ParserResult> {
    const captured: ArchiveOptions = { signal: options.signal, nested: options.nested, limits: options.limits ? { ...options.limits } : undefined }
    check(captured.signal)
    const generation = this.generation
    const absolute = resolve(path)
    const limits = Object.fromEntries(Object.entries(captured.limits ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ParserError("LIMIT_EXCEEDED", "Invalid cache analysis limit")
    const key = `${absolute}\0${JSON.stringify({ nested: captured.nested === true, limits })}`
    const flightKey = `${generation}\0${key}`
    let flight = this.flights.get(flightKey)
    if (!flight) {
      const controller = new AbortController()
      const result = this.load(absolute, key, generation, { ...captured, signal: controller.signal })
      const created = { controller, result, users: 0 }
      this.flights.set(flightKey, created)
      const cleanup = () => { if (this.flights.get(flightKey) === created) this.flights.delete(flightKey) }
      void result.then(cleanup, cleanup)
      flight = created
    }
    const current = flight
    current.users++
    return new Promise((resolve, reject) => {
      let done = false
      const settle = (aborted: boolean) => {
        if (done) return false
        done = true
        captured.signal?.removeEventListener("abort", abort)
        if (--current.users === 0 && aborted) {
          if (this.flights.get(flightKey) === current) this.flights.delete(flightKey)
          current.controller.abort()
        }
        return true
      }
      const abort = () => { if (settle(true)) reject(new ParserError("ABORTED", "Operation aborted")) }
      captured.signal?.addEventListener("abort", abort, { once: true })
      void current.result.then(result => {
        if (!settle(false)) return
        try { resolve(structuredClone(result)) } catch (error) { reject(error) }
      }, error => { if (settle(false)) reject(error) })
    })
  }
  private async load(absolute: string, key: string, generation: number, captured: ArchiveOptions): Promise<ParserResult> {
    const before = await snapshot(absolute)
    check(captured.signal)
    const cached = this.entries.get(key)
    if (cached && equal(cached.snapshot, before)) {
      this.entries.delete(key); this.entries.set(key, cached)
      this.hits++
      return cached.result
    }
    if (cached) this.remove(key)
    this.misses++
    const result = await analyze(absolute, captured)
    check(captured.signal)
    const after = await snapshot(absolute)
    check(captured.signal)
    if (!equal(before, after)) throw new ParserError("IO_ERROR", "Archive changed while analyzing")
    // Диагностика может обозначать временный сбой чтения или неполный результат.
    if (this.maxEntries && generation === this.generation && result.diagnostics.length === 0) {
      const bytes = serialize(result).byteLength + key.length * 2
      if (bytes <= this.maxBytes) {
        this.remove(key)
        this.entries.set(key, { snapshot: after, result, bytes })
        this.weight += bytes
        while (this.entries.size > this.maxEntries || this.weight > this.maxBytes) {
          this.remove(this.entries.keys().next().value!)
          this.evictions++
        }
      }
    }
    return result
  }
}
