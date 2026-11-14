type Fields = Record<string, unknown>
type Entry = { revision: number; value: unknown; valid?: (key: string) => boolean }
import { CONTENT_PATCH_FIELDS, PACK_METADATA_FIELDS } from "./build-content-patch"
const packFields = new Set<string>(PACK_METADATA_FIELDS)

export function isBuildWriteConflict(error: unknown): boolean {
  return !!error && typeof error === "object" && ("code" in error && error.code === "MODPACK_BUSY"
    || "message" in error && typeof error.message === "string" && error.message.includes("MODPACK_BUSY"))
}

/** Debounce старого UI-снимка не имеет права отменять более свежую команду. */
export function filterStaleBuildPatch(fields: Fields, current: Fields | undefined, staleMetadata = false): Fields {
  if (!current) return {}
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => !(staleMetadata && packFields.has(key))
    && (CONTENT_PATCH_FIELDS.has(key) || Object.is(current[key], value))))
}

/** Подтверждаем только отправленные значения: более новая правка остаётся грязной. */
export function acknowledgeBuildEdits<T extends Fields>(pending: T | undefined, sent: Fields): Partial<T> {
  return Object.fromEntries(Object.entries(pending ?? {}).filter(([key, value]) => !Object.hasOwn(sent, key) || !Object.is(value, sent[key]))) as Partial<T>
}

/** Один владелец очереди IPC-записей, включая записи после unmount. */
export class BuildWriteQueue {
  private revision = 0
  private readonly pending = new Map<string, Map<string, Entry>>()
  private readonly tails = new Map<string, Promise<void>>()
  constructor(private readonly persist: (id: string, fields: Fields) => Promise<void>) {}

  write(id: string, fields: Fields, valid?: (key: string) => boolean): Promise<void> {
    const pending = this.pending.get(id) ?? new Map<string, Entry>()
    for (const [key, value] of Object.entries(fields)) pending.set(key, { revision: ++this.revision, value, valid })
    this.pending.set(id, pending)
    const result = (this.tails.get(id) ?? Promise.resolve()).catch(() => {}).then(() => this.flushId(id))
    this.tails.set(id, result)
    void result.then(() => { if (this.tails.get(id) === result) this.tails.delete(id) }, () => {})
    return result
  }

  private async flushId(id: string): Promise<void> {
    const pending = this.pending.get(id)
    if (!pending?.size) return
    const snapshot = new Map(pending)
    for (const [key, entry] of snapshot) if (entry.valid && !entry.valid(key)) {
      snapshot.delete(key)
      if (pending.get(key)?.revision === entry.revision) pending.delete(key)
    }
    if (!snapshot.size) { if (!pending.size) this.pending.delete(id); return }
    try { await this.persist(id, Object.fromEntries([...snapshot].map(([key, entry]) => [key, entry.value]))) }
    catch (error) {
      // Отказ владельца — не сбой диска: такой устаревший intent нельзя
      // автоматически применить поверх успешно обновлённого пака позднее.
      if (isBuildWriteConflict(error)) {
        for (const [key, entry] of snapshot) if (packFields.has(key) && pending.get(key)?.revision === entry.revision) pending.delete(key)
        if (!pending.size) this.pending.delete(id)
      }
      throw error
    }
    for (const [key, entry] of snapshot) if (pending.get(key)?.revision === entry.revision) pending.delete(key)
    if (!pending.size) this.pending.delete(id)
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.tails.values()])
    await Promise.all([...this.pending.keys()].map(id => this.write(id, {})))
  }

  getPending(id: string): Fields {
    return Object.fromEntries([...(this.pending.get(id) ?? [])].map(([key, entry]) => [key, entry.value]))
  }

  discardPackMetadata(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    for (const field of packFields) pending.delete(field)
    if (!pending.size) this.pending.delete(id)
  }
}

export const buildWrites = new BuildWriteQueue(async (id, fields) => {
  const api = window.electrobunAPI
  if (!api) throw new Error("Build persistence is unavailable")
  await api.updateBuildFields(id, fields)
})
