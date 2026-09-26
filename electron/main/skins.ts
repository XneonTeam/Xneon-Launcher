import { ipcMain } from "electron"
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import { dbHelpers } from "../db"
import { fetchWithRetry } from "@xnlc/core/retry"
import { getMicrosoftDeviceClientId } from "./config"
import type { LibrarySkin } from "@xnlc/types"

const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"
const MC_LAUNCHER_LOGIN_URL = "https://api.minecraftservices.com/launcher/login"
const ELYBY_PROFILE_URL = "https://account.ely.by/api/account/v1/info"
const XBOX_LIVE_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate"
const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize"
const MS_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
const MS_SCOPE = "XboxLive.SignIn XboxLive.offline_access"
const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }
/** Верхняя граница размера файла, который `read-local-file` отдаёт в renderer. */
const MAX_LOCAL_READ_BYTES = 16 * 1024 * 1024

type XToken = { token: string; uhs: string }

async function refreshMicrosoftMcToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const clientId = await getMicrosoftDeviceClientId()
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPE,
    })
    const msRes = await fetchWithRetry(MS_TOKEN_URL, {
      method: "POST",
      headers: FORM_HEADERS,
      body: body.toString(),
    }, { retries: 1 })
    if (!msRes.ok) return null
    const msData = await msRes.json() as Record<string, unknown>
    const msaAccessToken = msData.access_token as string
    const newRefreshToken = (msData.refresh_token as string) || refreshToken
    if (!msaAccessToken) return null

    const xblRes = await fetchWithRetry(XBOX_LIVE_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" },
      body: JSON.stringify({
        Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${msaAccessToken}` },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
    }, { retries: 1 })
    if (!xblRes.ok) return null
    const xblData = await xblRes.json() as Record<string, unknown>
    const xblToken = xblData.Token as string
    const xblUhs = ((xblData.DisplayClaims as { xui?: Array<{ uhs?: string }> })?.xui?.[0]?.uhs) ?? ""
    if (!xblToken || !xblUhs) return null

    const xstsRes = await fetchWithRetry(XSTS_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" },
      body: JSON.stringify({
        Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
        RelyingParty: "rp://api.minecraftservices.com/",
        TokenType: "JWT",
      }),
    }, { retries: 1 })
    if (!xstsRes.ok) return null
    const xstsData = await xstsRes.json() as Record<string, unknown>
    const xstsToken = xstsData.Token as string
    if (!xstsToken) return null

    const mcRes = await fetchWithRetry(MC_LAUNCHER_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ xtoken: `XBL3.0 x=${xblUhs};${xstsToken}`, platform: "PC_LAUNCHER" }),
    }, { retries: 1 })
    if (!mcRes.ok) return null
    const mcData = await mcRes.json() as Record<string, unknown>
    const mcAccessToken = mcData.access_token as string
    if (!mcAccessToken) return null

    return { accessToken: mcAccessToken, refreshToken: newRefreshToken }
  } catch {
    return null
  }
}

async function getAccountById(accountId?: string) {
  const accounts = await dbHelpers.loadAccounts()
  if (accountId) return accounts.find((a) => a.id === accountId)
  return accounts.find((a) => a.isActive) ?? accounts[0]
}

async function ensureValidToken(account: { id: string; type: string; accessToken?: string; refreshToken?: string }, dbSave: typeof dbHelpers.saveAccount): Promise<string | null> {
  if (account.accessToken) return account.accessToken
  if (account.type === "microsoft" && account.refreshToken) {
    const refreshed = await refreshMicrosoftMcToken(account.refreshToken)
    if (refreshed) {
      const updated = { ...account, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken } as any
      await dbSave(updated)
      return refreshed.accessToken
    }
  }
  return null
}

/**
 * Аккаунт вместе с рабочим токеном Minecraft Services.
 *
 * Токен Microsoft живёт ~24 часа, поэтому одного `account.accessToken` мало:
 * если он пуст, пробуем обновить его по refresh-токену. Раньше эту логику
 * знал только `skins:get-profile`, а применение скина шло напрямую по
 * сохранённому токену и молча падало после его протухания.
 */
export async function resolveSkinAccount(accountId?: string): Promise<{ account: any; accessToken: string } | null> {
  const account = await getAccountById(accountId)
  if (!account) return null
  const accessToken = await ensureValidToken(account as any, dbHelpers.saveAccount as any)
  if (!accessToken) return null
  return { account, accessToken }
}

/**
 * Отправляет текстуру в Minecraft Services и (по желанию) надевает плащ.
 * Общий путь для скинов из «Избранного» и из каталога Laby.
 *
 * На 401 один раз обновляем токен и повторяем: именно так ведёт себя
 * `skins:get-profile`, и без этого повторного захода скин не надевался до
 * перезапуска лаунчера.
 */
export async function uploadSkinTexture(params: {
  accountId?: string
  buffer: Buffer
  variant: "classic" | "slim"
  capeId?: string | null
}): Promise<boolean> {
  const resolved = await resolveSkinAccount(params.accountId)
  if (!resolved) return false

  const send = async (token: string) => {
    const blob = new Blob([new Uint8Array(params.buffer)], { type: "image/png" })
    const formData = new FormData()
    formData.append("variant", params.variant.toUpperCase())
    formData.append("file", blob, "skin.png")
    return fetchWithRetry(`${MC_PROFILE_URL}/skins`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
  }

  try {
    let res = await send(resolved.accessToken)
    if (res.status === 401 && resolved.account.type === "microsoft" && resolved.account.refreshToken) {
      const refreshed = await refreshMicrosoftMcToken(resolved.account.refreshToken)
      if (refreshed) {
        await dbHelpers.saveAccount({
          ...resolved.account,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        } as any)
        res = await send(refreshed.accessToken)
      }
    }
    if (!res.ok) return false

    if (params.capeId) {
      await fetchWithRetry(`${MC_PROFILE_URL}/capes/active`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${resolved.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ capeId: params.capeId }),
      })
    }

    return true
  } catch {
    return false
  }
}

/**
 * Кладёт готовую текстуру в `<data>/skins` и заводит запись в «Избранном».
 * Используется импортом из каталога Laby: текстура приходит буфером, а не
 * файлом на диске, поэтому `skins:save-to-library` тут не подходит.
 */
export async function writeSkinFileToLibrary(params: {
  name: string
  variant: "classic" | "slim"
  accountId: string
  capeId?: string | null
  buffer: Buffer
  /** Идентификатор источника (`laby:<hash>`), если текстура пришла из каталога. */
  sourceId?: string | null
}): Promise<LibrarySkin | null> {
  try {
    const dataDir = await dbHelpers.getLauncherDirectory()
    const skinsDir = path.join(dataDir, "skins")
    await fs.mkdir(skinsDir, { recursive: true })

    const id = crypto.randomUUID()
    const destPath = path.join(skinsDir, `${id}.png`)
    await fs.writeFile(destPath, params.buffer)

    const skin: LibrarySkin = {
      id,
      accountId: params.accountId,
      name: params.name,
      filePath: destPath,
      variant: params.variant,
      capeId: params.capeId ?? null,
      createdAt: new Date().toISOString(),
      sourceId: params.sourceId ?? null,
    }

    await dbHelpers.saveSkinToLibrary({
      id: skin.id,
      accountId: skin.accountId,
      name: skin.name,
      filePath: skin.filePath,
      variant: skin.variant,
      capeId: skin.capeId,
      createdAt: skin.createdAt,
      sourceId: skin.sourceId ?? null,
    })

    return skin
  } catch {
    return null
  }
}

export function registerSkinsHandlers() {
  /**
   * Отдаёт renderer'у содержимое файла в base64.
   *
   * Раньше путь приходил из renderer'а и никак не проверялся: любой код в окне
   * (в том числе из XSS в описании мода) мог прочитать произвольный файл на
   * диске. Единственный потребитель — превью скинов из библиотеки, а лаунчер
   * сам складывает их в `<data>/skins` (`skins:save-to-library`,
   * `skins:import-from-url`), поэтому читаем только оттуда и только картинки
   * разумного размера.
   */
  ipcMain.handle("read-local-file", async (_event, filePath: string) => {
    try {
      if (typeof filePath !== "string" || !filePath) return null
      const dataDir = await dbHelpers.getLauncherDirectory()
      const skinsDir = path.resolve(dataDir, "skins")
      const resolved = path.resolve(filePath)
      const relative = path.relative(skinsDir, resolved)
      // Выход за пределы каталога скинов (в том числе через `..`) запрещён.
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null
      const stat = await fs.stat(resolved)
      if (!stat.isFile() || stat.size > MAX_LOCAL_READ_BYTES) return null
      const buffer = await fs.readFile(resolved)
      return buffer.toString("base64")
    } catch {
      return null
    }
  })

  ipcMain.handle("skins:get-profile", async (_event, accountId?: string) => {
    const account = await getAccountById(accountId)
    if (!account) return null

    let accessToken = await ensureValidToken(account as any, dbHelpers.saveAccount as any)
    if (!accessToken) {
      return null
    }

    try {
      if (account.type === "microsoft" || account.type === "xnskins") {
        let res = await fetchWithRetry(MC_PROFILE_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (res.status === 401 && account.type === "microsoft" && account.refreshToken) {
          const refreshed = await refreshMicrosoftMcToken(account.refreshToken)
          if (refreshed) {
            accessToken = refreshed.accessToken
            const updated = { ...account, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken } as any
            await dbHelpers.saveAccount(updated)
            res = await fetchWithRetry(MC_PROFILE_URL, {
              headers: { Authorization: `Bearer ${accessToken}` },
            })
          }
        }

        if (!res.ok) {
          return null
        }
        const data = await res.json()
        return data
      }
      if (account.type === "elyby") {
        const res = await fetchWithRetry(ELYBY_PROFILE_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) return null
        const data = (await res.json()) as Record<string, unknown>
        const skins: unknown[] = Array.isArray(data.skins) ? data.skins : []
        const capes: unknown[] = Array.isArray(data.capes) ? data.capes : []
        return {
          id: String(data.id ?? ""),
          name: String(data.username ?? account.username),
          skins: skins.map((s) => {
            const skin = s as Record<string, unknown>
            return {
              id: String(skin.id ?? ""),
              state: String(skin.state ?? "ACTIVE"),
              url: String(skin.url ?? ""),
              variant: (skin.variant as "CLASSIC" | "SLIM") ?? "CLASSIC",
            }
          }),
          capes: capes.map((c) => {
            const cape = c as Record<string, unknown>
            return {
              id: String(cape.id ?? ""),
              state: String(cape.state ?? "ACTIVE"),
              url: String(cape.url ?? ""),
              alias: cape.alias as string | undefined,
            }
          }),
        }
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle("skins:upload-skin", async (_event, params: { filePath: string; variant: "classic" | "slim"; accountId?: string }) => {
    try {
      const fileBuffer = await fs.readFile(params.filePath)
      return await uploadSkinTexture({
        accountId: params.accountId,
        buffer: fileBuffer,
        variant: params.variant,
      })
    } catch {
      return false
    }
  })

  ipcMain.handle("skins:delete-skin", async (_event, accountId?: string) => {
    const account = await getAccountById(accountId)
    const accessToken = account?.accessToken
    if (!accessToken) return false

    try {
      const res = await fetchWithRetry(`${MC_PROFILE_URL}/skins/active`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return res.ok
    } catch {
      return false
    }
  })

  ipcMain.handle("skins:set-cape", async (_event, params: { capeId: string | null; accountId?: string }) => {
    const account = await getAccountById(params.accountId)
    const accessToken = account?.accessToken
    if (!accessToken) return false

    try {
      if (params.capeId) {
        const res = await fetchWithRetry(`${MC_PROFILE_URL}/capes/active`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ capeId: params.capeId }),
        })
        return res.ok
      } else {
        const res = await fetchWithRetry(`${MC_PROFILE_URL}/capes/active`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        return res.ok
      }
    } catch {
      return false
    }
  })

  // ── Skin Library ────────────────────────────────────────

  ipcMain.handle("skins:list-library", async (_event, accountId: string) => {
    const rows = await dbHelpers.loadSkinLibrary(accountId)
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      name: r.name,
      filePath: r.filePath,
      variant: r.variant as "classic" | "slim",
      capeId: r.capeId ?? null,
      createdAt: r.createdAt,
      sourceId: r.sourceId ?? null,
    }))
  })

  ipcMain.handle("skins:save-to-library", async (_event, params: { filePath: string; name: string; variant: "classic" | "slim"; accountId: string; capeId?: string | null }) => {
    try {
      const buffer = await fs.readFile(params.filePath)
      return await writeSkinFileToLibrary({
        name: params.name,
        variant: params.variant,
        accountId: params.accountId,
        capeId: params.capeId ?? null,
        buffer,
      })
    } catch {
      return null
    }
  })

  ipcMain.handle("skins:delete-from-library", async (_event, id: string) => {
    try {
      // Ищем запись по id, а не по списку аккаунта: прежний вызов
      // `loadSkinLibrary("")` не находил ничего, и PNG оставался на диске.
      const skin = await dbHelpers.findLibrarySkinById(id)
      if (skin?.filePath) {
        await fs.unlink(skin.filePath).catch(() => {})
      }
      await dbHelpers.deleteSkinFromLibrary(id)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("skins:update-variant", async (_event, params: { id: string; variant: "classic" | "slim"; capeId?: string | null; name?: string }) => {
    try {
      await dbHelpers.updateSkinVariant(params.id, params.variant)
      if (params.capeId !== undefined) {
        await dbHelpers.updateSkinCapeId(params.id, params.capeId ?? null)
      }
      if (params.name !== undefined) {
        await dbHelpers.updateSkinName(params.id, params.name)
      }
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("skins:apply-library-skin", async (_event, params: { skinId: string; accountId: string }) => {
    try {
      const rows = await dbHelpers.loadSkinLibrary(params.accountId)
      const skin = rows.find((r) => r.id === params.skinId)
      if (!skin) return false

      const fileBuffer = await fs.readFile(skin.filePath)
      return await uploadSkinTexture({
        accountId: params.accountId,
        buffer: fileBuffer,
        variant: skin.variant as "classic" | "slim",
        capeId: skin.capeId ?? null,
      })
    } catch {
      return false
    }
  })

  ipcMain.handle("skins:import-from-url", async (_event, params: { url: string; name: string; variant: "classic" | "slim"; accountId: string }) => {
    try {
      const res = await fetchWithRetry(params.url)
      if (!res.ok) return null

      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length === 0 || buffer.length > MAX_LOCAL_READ_BYTES) return null

      return await writeSkinFileToLibrary({
        name: params.name,
        variant: params.variant,
        accountId: params.accountId,
        capeId: null,
        buffer,
      })
    } catch {
      return null
    }
  })
}
