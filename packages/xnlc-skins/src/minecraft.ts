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
import type { McProfile } from "@xnlc/types"
import type { ResolvedSkinAccount, SkinAccountPort } from "./ports.js"
import type { SkinVariant } from "./validate.js"

const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"
const ELYBY_PROFILE_URL = "https://account.ely.by/api/account/v1/info"

/** Как часто повторять сетевые сбои: надевание скина — разовое действие. */
const RETRIES = { retries: 1 }

export class MinecraftSkins {
  constructor(private readonly accounts: SkinAccountPort) {}

  /** Профиль аккаунта: активный скин, доступные скины и плащи. */
  async profile(accountId?: string): Promise<McProfile | null> {
    try {
      const account = await this.accounts.resolve(accountId)
      if (!account) return null

      if (account.type === "elyby") return await this.elybyProfile(account)

      const sent = await this.send(account, (token) =>
        fetchWithRetry(MC_PROFILE_URL, { headers: { Authorization: `Bearer ${token}` } }, RETRIES),
      )
      if (!sent?.res.ok) return null
      return (await sent.res.json()) as McProfile
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

      const sent = await this.send(account, (token) => {
        const formData = new FormData()
        formData.append("variant", params.variant.toUpperCase())
        formData.append("file", new Blob([copyForBlob(params.data)], { type: "image/png" }), "skin.png")
        return fetchWithRetry(`${MC_PROFILE_URL}/skins`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }, RETRIES)
      })
      if (!sent?.res.ok) return false

      if (params.capeId) {
        // Токен берём тот, которым текстура реально загрузилась: после
        // обновления по 401 старый уже недействителен.
        await fetchWithRetry(`${MC_PROFILE_URL}/capes/active`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${sent.account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ capeId: params.capeId }),
        }, RETRIES)
      }

      return true
    } catch {
      return false
    }
  }

  /** Сбрасывает скин: у аккаунта снова стандартный. */
  async reset(accountId?: string): Promise<boolean> {
    try {
      const account = await this.accounts.resolve(accountId)
      if (!account) return false
      const sent = await this.send(account, (token) =>
        fetchWithRetry(`${MC_PROFILE_URL}/skins/active`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, RETRIES),
      )
      return Boolean(sent?.res.ok)
    } catch {
      return false
    }
  }

  /** Ставит (`capeId`) или снимает (`null`) плащ. */
  async setCape(capeId: string | null, accountId?: string): Promise<boolean> {
    try {
      const account = await this.accounts.resolve(accountId)
      if (!account) return false
      const sent = await this.send(account, (token) =>
        fetchWithRetry(`${MC_PROFILE_URL}/capes/active`, {
          method: capeId ? "PUT" : "DELETE",
          headers: capeId
            ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
            : { Authorization: `Bearer ${token}` },
          ...(capeId ? { body: JSON.stringify({ capeId }) } : {}),
        }, RETRIES),
      )
      return Boolean(sent?.res.ok)
    } catch {
      return false
    }
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