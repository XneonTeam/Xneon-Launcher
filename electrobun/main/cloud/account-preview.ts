import fs from "node:fs/promises"
import path from "node:path"
import type { CloudAccountPreview } from "@xnlc/types"
import { app } from "../../platform/desktop"
import { getProvider, type CloudProviderId } from "./registry"

const cache = new Map<string, { value?: CloudAccountPreview; expires: number }>()
const pending = new Map<string, Promise<CloudAccountPreview | undefined>>()
const types = new Set(["offline", "microsoft", "elyby", "xnskins", "authlib-injector"])

/** Облачный JSON недоверенный: никаких rest/spread и никаких сессионных полей. */
export function accountPreviewFrom(value: unknown): CloudAccountPreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (typeof input.type !== "string" || !types.has(input.type) || typeof input.username !== "string" || !input.username || input.username.length > 256) return undefined
  let skinUrl: string | undefined
  if (typeof input.skinUrl === "string" && input.skinUrl.length <= 4096) {
    try { const url = new URL(input.skinUrl); if (url.protocol === "https:" && !url.username && !url.password) skinUrl = url.href } catch { /* Некорректную ссылку не передаём. */ }
  }
  return { type: input.type as CloudAccountPreview["type"], username: input.username,
    ...(typeof input.uuid === "string" && input.uuid.length <= 128 ? { uuid: input.uuid } : {}), ...(skinUrl ? { skinUrl } : {}) }
}

export function invalidateCloudAccountPreviews(): void { cache.clear() }

/** Метаданные читаются один раз на версию файла; логин/импорт аккаунта не выполняется. */
export async function cloudAccountPreview(providerId: CloudProviderId, file: { path: string; size: number; modifiedAt?: string }): Promise<CloudAccountPreview | undefined> {
  if (file.size > 1024 * 1024) return undefined
  const key = JSON.stringify([providerId, file.path, file.size, file.modifiedAt])
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value
  if (pending.has(key)) return pending.get(key)
  const job = (async () => {
    const directory = await fs.mkdtemp(path.join(app.getPath("temp"), "xneon-account-preview-"))
    try {
      const local = path.join(directory, "account.json")
      const result = await getProvider(providerId).downloadFile(file.path, local)
      if (!result.success || (await fs.stat(local)).size > 1024 * 1024) return undefined
      return accountPreviewFrom(JSON.parse(await fs.readFile(local, "utf8")))
    } catch { return undefined }
    finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}) }
  })().then(value => {
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(key, { value, expires: Date.now() + (value ? 300_000 : 30_000) })
    return value
  }).finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}
