// ============================================================
// @xnlc/skins — активный скин на аккаунте (Minecraft Services)
// ============================================================
//
// Всё, что уходит на api.minecraftservices.com: профиль (скины и плащи),
// надевание текстуры, сброс и выбор плаща. Аккаунт Ely.by отвечает своей
// формой профиля — приводим её к общей модели здесь же.
//
// Обновление токена после `401` живёт в одном месте (`send`): раньше эта
// логика была скопирована в чтение профиля и в надевание скина, и вторая копия
// использовала старый токен для плаща — после обновления плащ не надевался.

import { fetchWithRetry } from "@xnlc/core/retry"
import { AUTH_URLS } from "@xnlc/urls"
import type { McProfile } from "@xnlc/types"
import type { ResolvedSkinAccount, SkinAccountPort, SkinDiskCache } from "./ports.js"
import type { SkinVariant } from "./validate.js"
import { isValidTexture, MAX_TEXTURE_BYTES } from "./validate.js"
import { SkinCache } from "./cache.js"
import { SkinProfileCache, parseSkinProfile, skinCacheKey } from "./profile-cache.js"

const MC_PROFILE_URL = AUTH_URLS.minecraftProfile
const ELYBY_PROFILE_URL = AUTH_URLS.elyProfile

/** Как часто повторять сетевые сбои: надевание скина — разовое действие. */
const RETRIES = { retries: 1 }

export class MinecraftSkins {
  private readonly profiles: SkinProfileCache
  private readonly textures: SkinCache
  constructor(private readonly accounts: SkinAccountPort, disk?: SkinDiskCache) {
    this.profiles = new SkinProfileCache(disk)
    this.textures = new SkinCache(disk)
  }

  async accountId(accountId?: string): Promise<string | null> {
    return (await this.accounts.resolve(accountId))?.id ?? null
  }

  async profile(accountId?: string, force = false): Promise<McProfile | null> {
    const account = await this.accounts.resolve(accountId)
    if (!account) return null
    return this.profiles.get(account.id, () => this.loadProfile(account), force)
  }

  /** Текстура загружается в main один раз; тот же PNG доступен после перезапуска офлайн. */
  async texture(url: string): Promise<Uint8Array | null> {
    try {
      const parsed = new URL(url)
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null
      const data = await this.textures.binary(`profile-texture-${skinCacheKey(url)}.png`, async () => {
        const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(10_000) }, RETRIES)
        if (!res.ok || Number(res.headers.get("content-length")) > MAX_TEXTURE_BYTES || !res.body) return null
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            length += value.byteLength
            if (length > MAX_TEXTURE_BYTES) { await reader.cancel(); return null }
            chunks.push(value)
          }
        } finally { reader.releaseLock() }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        return isValidTexture(bytes) ? bytes : null
      }, {
        // Только адреса с хэшем содержимого неизменяемы. Authlib может отдавать
        // новый PNG по прежнему /skin/username, его нельзя кэшировать навечно.
        ttl: /\/(?:texture|textures)\/[a-f0-9]{32,}(?:\.png)?$/i.test(parsed.pathname) ? Infinity : 15_000,
        validate: isValidTexture,
      })
      return data && isValidTexture(data) ? data : null
    } catch { return null }
  }

  /** Профиль аккаунта: активный скин, доступные скины и плащи. */
  private async loadProfile(account: ResolvedSkinAccount): Promise<McProfile | null> {
    try {

      if (account.type === "offline") {
        return {
          id: account.uuid ?? account.id,
          name: account.username ?? "Player",
          skins: account.skinUrl
            ? [{ id: "active", state: "ACTIVE", url: account.skinUrl, variant: "CLASSIC" }]
            : [],
          capes: [],
        }
      }

      if (account.type === "elyby") {
        const elyProfile = await this.elybyProfile(account)
        if (elyProfile && elyProfile.skins.length > 0) return elyProfile
        if (account.serverUrl) {
          const authlibRes = await this.authlibProfile(account)
          if (authlibRes) return authlibRes
        }
        if (elyProfile) return elyProfile
      }

      if (account.type === "authlib-injector" || account.type === "xnskins" || (account.type as string) === "xneon") {
        return await this.authlibProfile(account)
      }

      const sent = await this.send(account, (token) =>
        fetchWithRetry(MC_PROFILE_URL, { headers: { Authorization: `Bearer ${token}` } }, RETRIES),
      )
      if (!sent?.res.ok) return null
      return parseSkinProfile(await sent.res.json())
    } catch {
      return null
    }
  }

  /**
   * Надевает текстуру и (по желанию) плащ.
   *
   * Общий путь для скинов из «Избранного» и из каталога Laby.
   */
  async apply(params: {
    accountId?: string
    data: Uint8Array
    variant: SkinVariant
    capeId?: string | null
  }): Promise<boolean> {
    try {
      const account = await this.accounts.resolve(params.accountId)
      if (!account) return false
      if (!isValidTexture(params.data)) return false
      this.profiles.invalidate(account.id)
      this.textures.clear()

      if (account.type === "offline") {
        return true
      }

      if (account.type === "elyby") {
        return false
      }

      if (
        account.type === "authlib-injector" ||
        account.type === "xnskins" ||
        (account.type as string) === "xneon"
      ) {
        const success = await this.authlibApply(account, params)
        const profile = await this.profile(account.id, true)
        if (!success) return false
        if (params.capeId === undefined) return true
        // Серверы с uploadableTextures=skin могут вообще не иметь cape endpoint.
        // Не удаляем отсутствующий плащ и не загружаем уже активный повторно.
        if (profile && (profile.capes.find(c => c.state === "ACTIVE")?.id ?? null) === params.capeId) return true
        return await this.setCape(params.capeId, account.id)
      }

      const sent = await this.send(account, (token) => {
        const formData = new FormData()
        formData.append("variant", params.variant)
        formData.append("file", new Blob([copyForBlob(params.data)], { type: "image/png" }), "skin.png")
        return fetchWithRetry(`${MC_PROFILE_URL}/skins`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }, RETRIES)
      })
      if (!sent?.res.ok) return false
      await this.cacheResponse(sent.account, sent.res)
      // null означает «без плаща», undefined — не менять. Ошибку второго шага
      // не выдаём за успешное применение всего комплекта.
      return params.capeId === undefined || await this.setCape(params.capeId, sent.account.id)
    } catch {
      return false
    }
  }

  /** Сбрасывает скин: у аккаунта снова стандартный. */
  async reset(accountId?: string): Promise<boolean> {
    try {
      const account = await this.accounts.resolve(accountId)
      if (!account) return false
      this.profiles.invalidate(account.id)
      this.textures.clear()

      if (account.type === "offline") {
        return true
      }

      if (account.type === "elyby") {
        return false
      }

      if (
        account.type === "authlib-injector" ||
        account.type === "xnskins" ||
        (account.type as string) === "xneon"
      ) {
        const success = await this.authlibReset(account)
        await this.profile(account.id, true)
        return success
      }

      const sent = await this.send(account, (token) =>
        fetchWithRetry(`${MC_PROFILE_URL}/skins/active`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, RETRIES),
      )
      if (!sent?.res.ok) return false
      await this.cacheResponse(sent.account, sent.res)
      return await this.setCape(null, sent.account.id)
    } catch {
      return false
    }
  }

  /** Ставит (`capeId`) или снимает (`null`) плащ. */
  async setCape(capeId: string | null, accountId?: string): Promise<boolean> {
    try {
      const account = await this.accounts.resolve(accountId)
      if (!account) return false
      this.profiles.invalidate(account.id)

      if (account.type === "offline") {
        return true
      }

      if (account.type === "elyby") {
        return false
      }

      if (
        account.type === "authlib-injector" ||
        account.type === "xnskins" ||
        (account.type as string) === "xneon"
      ) {
        const success = await this.authlibSetCape(account, capeId)
        await this.profile(account.id, true)
        return success
      }

      const sent = await this.send(account, (token) =>
        fetchWithRetry(`${MC_PROFILE_URL}/capes/active`, {
          method: capeId ? "PUT" : "DELETE",
          headers: capeId
            ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
            : { Authorization: `Bearer ${token}` },
          ...(capeId ? { body: JSON.stringify({ capeId }) } : {}),
        }, RETRIES),
      )
      if (!sent?.res.ok) {
        await this.profile(account.id, true)
        return false
      }
      await this.cacheResponse(sent.account, sent.res)
      return true
    } catch {
      return false
    }
  }

  private async cacheResponse(account: ResolvedSkinAccount, res: Response): Promise<void> {
    const profile = parseSkinProfile(await res.json().catch(() => null))
    if (profile) await this.profiles.put(account.id, profile)
    else await this.profile(account.id, true)
  }

  /**
   * Запрос с токеном и одним обновлением после `401`.
   *
   * Возвращает ответ вместе с аккаунтом, чей токен этот ответ подписал: иначе
   * вызывающая сторона продолжила бы работу со старым токеном.
   */
  private async send(
    account: ResolvedSkinAccount,
    run: (token: string) => Promise<Response>,
  ): Promise<{ res: Response; account: ResolvedSkinAccount } | null> {
    let current = account
    let res = await run(current.accessToken)
    if (res.status === 401) {
      const refreshed = await this.accounts.refresh(current)
      if (refreshed) {
        current = refreshed
        res = await run(current.accessToken)
      }
    }
    return { res, account: current }
  }

  /** Ely.by: своя форма профиля, приводим её к общей модели. */
  private async elybyProfile(account: ResolvedSkinAccount): Promise<McProfile | null> {
    const res = await fetchWithRetry(ELYBY_PROFILE_URL, { headers: { Authorization: `Bearer ${account.accessToken}` } }, RETRIES)
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, unknown>
    const skins = Array.isArray(data.skins) ? data.skins : []
    const capes = Array.isArray(data.capes) ? data.capes : []
    return {
      id: String(data.id ?? ""),
      name: String(data.username ?? account.username ?? ""),
      skins: skins.map((entry) => {
        const skin = entry as Record<string, unknown>
        return {
          id: String(skin.id ?? ""),
          state: String(skin.state ?? "ACTIVE"),
          url: String(skin.url ?? ""),
          variant: (skin.variant as "CLASSIC" | "SLIM") ?? "CLASSIC",
        }
      }),
      capes: capes.map((entry) => {
        const cape = entry as Record<string, unknown>
        return {
          id: String(cape.id ?? ""),
          state: String(cape.state ?? "ACTIVE"),
          url: String(cape.url ?? ""),
          alias: cape.alias as string | undefined,
        }
      }),
    }
  }

  /** Authlib-Injector: профиль с текстурами и uploadableTextures через сессионный сервер */
  private async authlibProfile(account: ResolvedSkinAccount): Promise<McProfile | null> {
    if (!account.serverUrl || !account.uuid) return null
    const base = account.serverUrl.endsWith("/") ? account.serverUrl : `${account.serverUrl}/`
    const cleanUuid = account.uuid.replace(/-/g, "")
    const url = `${base}sessionserver/session/minecraft/profile/${cleanUuid}?unsigned=false`

    const sent = await this.send(account, (token) =>
      fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } }, RETRIES),
    )
    if (!sent?.res.ok) {
      // Некоторые серверы отдают профиль по /api/user/profile/:uuid
      const altUrl = `${base}api/user/profile/${cleanUuid}`
      const altSent = await this.send(account, (token) =>
        fetchWithRetry(altUrl, { headers: { Authorization: `Bearer ${token}` } }, RETRIES),
      )
      if (!altSent?.res.ok) return null
      return this.parseAuthlibProfileResponse(await altSent.res.json(), account)
    }

    return this.parseAuthlibProfileResponse(await sent.res.json(), account)
  }

  private parseAuthlibProfileResponse(data: unknown, account: ResolvedSkinAccount): McProfile | null {
    if (!data || typeof data !== "object") return null
    const obj = data as Record<string, unknown>
    // Альтернативный endpoint может сразу вернуть профиль Minecraft Services.
    const direct = parseSkinProfile(obj)
    if (direct) return direct
    const id = String(obj.id ?? account.uuid ?? "")
    const name = String(obj.name ?? account.username ?? "")
    const properties = Array.isArray(obj.properties) ? obj.properties : []

    let texturesObj: { textures?: { SKIN?: { url?: string; metadata?: { model?: string } }; CAPE?: { url?: string } } } | null = null
    let uploadableTextures: string | undefined = undefined

    for (const prop of properties) {
      if (typeof prop !== "object" || !prop) continue
      const p = prop as { name?: string; value?: string }
      if (p.name === "textures" && typeof p.value === "string") {
        texturesObj = decodeBase64Json(p.value)
      } else if (p.name === "uploadableTextures" && typeof p.value === "string") {
        uploadableTextures = p.value
      }
    }

    const skinEntry = texturesObj?.textures?.SKIN
    const capeEntry = texturesObj?.textures?.CAPE

    const skins: McProfile["skins"] = []
    if (skinEntry?.url) {
      skins.push({
        id: "active",
        state: "ACTIVE",
        url: skinEntry.url,
        variant: skinEntry.metadata?.model === "slim" ? "SLIM" : "CLASSIC",
      })
    }

    const capes: McProfile["capes"] = []
    if (capeEntry?.url) {
      capes.push({
        id: "active",
        state: "ACTIVE",
        url: capeEntry.url,
      })
    }

    return {
      id,
      name,
      skins,
      capes,
      uploadableTextures,
    }
  }

  /** Authlib-Injector: надевание скина через PUT /api/user/profile/{uuid}/skin */
  private async authlibApply(
    account: ResolvedSkinAccount,
    params: { data: Uint8Array; variant: SkinVariant; capeId?: string | null },
  ): Promise<boolean> {
    if (!account.serverUrl || !account.uuid) return false
    const base = account.serverUrl.endsWith("/") ? account.serverUrl : `${account.serverUrl}/`
    const cleanUuid = account.uuid.replace(/-/g, "")
    const skinUrl = `${base}api/user/profile/${cleanUuid}/skin`

    const sent = await this.send(account, (token) => {
      const formData = new FormData()
      formData.append("model", params.variant === "slim" ? "slim" : "")
      formData.append("file", new Blob([copyForBlob(params.data)], { type: "image/png" }), "skin.png")
      return fetchWithRetry(
        skinUrl,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
        RETRIES,
      )
    })

    return Boolean(sent?.res.ok)
  }

  /** Authlib-Injector: сброс скина через DELETE /api/user/profile/{uuid}/skin */
  private async authlibReset(account: ResolvedSkinAccount): Promise<boolean> {
    if (!account.serverUrl || !account.uuid) return false
    const base = account.serverUrl.endsWith("/") ? account.serverUrl : `${account.serverUrl}/`
    const cleanUuid = account.uuid.replace(/-/g, "")
    const skinUrl = `${base}api/user/profile/${cleanUuid}/skin`

    const sent = await this.send(account, (token) =>
      fetchWithRetry(
        skinUrl,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
        RETRIES,
      ),
    )

    return Boolean(sent?.res.ok)
  }

  /** Authlib-Injector: сброс плаща через DELETE /api/user/profile/{uuid}/cape */
  private async authlibSetCape(account: ResolvedSkinAccount, capeId: string | null): Promise<boolean> {
    if (!account.serverUrl || !account.uuid) return false
    const base = account.serverUrl.endsWith("/") ? account.serverUrl : `${account.serverUrl}/`
    const cleanUuid = account.uuid.replace(/-/g, "")
    const capeUrl = `${base}api/user/profile/${cleanUuid}/cape`

    if (!capeId) {
      const sent = await this.send(account, (token) =>
        fetchWithRetry(
          capeUrl,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
          RETRIES,
        ),
      )
      return Boolean(sent?.res.ok)
    }

    return false
  }
}

function decodeBase64Json<T>(b64: string): T | null {
  try {
    if (typeof Buffer !== "undefined") {
      return JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
    }
    return JSON.parse(atob(b64))
  } catch {
    return null
  }
}

/**
 * `Blob` не принимает `Uint8Array<ArrayBufferLike>` из типов Node: копируем в
 * обычный `ArrayBuffer`, иначе TypeScript считает буфер разделяемым (`SharedArrayBuffer`).
 */
function copyForBlob(data: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(data.byteLength)
  new Uint8Array(copy).set(data)
  return copy
}
