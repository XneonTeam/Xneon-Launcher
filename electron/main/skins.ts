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

export function registerSkinsHandlers() {
  ipcMain.handle("read-local-file", async (_event, filePath: string) => {
    try {
      const buffer = await fs.readFile(filePath)
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
    const account = await getAccountById(params.accountId)
    const accessToken = account?.accessToken
    if (!accessToken) return false

    try {
      const fileBuffer = await fs.readFile(params.filePath)
      const fileName = path.basename(params.filePath)
      const blob = new Blob([fileBuffer], { type: "image/png" })

      const formData = new FormData()
      formData.append("variant", params.variant.toUpperCase())
      formData.append("file", blob, fileName)

      const res = await fetchWithRetry(`${MC_PROFILE_URL}/skins`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })
      return res.ok
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
    }))
  })

  ipcMain.handle("skins:save-to-library", async (_event, params: { filePath: string; name: string; variant: "classic" | "slim"; accountId: string; capeId?: string | null }) => {
    try {
      const dataDir = await dbHelpers.getLauncherDirectory()
      const skinsDir = path.join(dataDir, "skins")
      await fs.mkdir(skinsDir, { recursive: true })

      const ext = path.extname(params.filePath) || ".png"
      const id = crypto.randomUUID()
      const destPath = path.join(skinsDir, `${id}${ext}`)

      await fs.copyFile(params.filePath, destPath)

      const skin: LibrarySkin = {
        id,
        accountId: params.accountId,
        name: params.name,
        filePath: destPath,
        variant: params.variant,
        capeId: params.capeId ?? null,
        createdAt: new Date().toISOString(),
      }

      await dbHelpers.saveSkinToLibrary({
        id: skin.id,
        accountId: skin.accountId,
        name: skin.name,
        filePath: skin.filePath,
        variant: skin.variant,
        capeId: skin.capeId,
        createdAt: skin.createdAt,
      })

      return skin
    } catch {
      return null
    }
  })

  ipcMain.handle("skins:delete-from-library", async (_event, id: string) => {
    try {
      const rows = await dbHelpers.loadSkinLibrary("")
      const skin = rows.find((r) => r.id === id)
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
    const account = await getAccountById(params.accountId)
    const accessToken = account?.accessToken
    if (!accessToken) return false

    try {
      const rows = await dbHelpers.loadSkinLibrary(params.accountId)
      const skin = rows.find((r) => r.id === params.skinId)
      if (!skin) return false

      const fileBuffer = await fs.readFile(skin.filePath)
      const fileName = path.basename(skin.filePath)
      const blob = new Blob([fileBuffer], { type: "image/png" })

      const formData = new FormData()
      formData.append("variant", skin.variant.toUpperCase())
      formData.append("file", blob, fileName)

      const res = await fetchWithRetry(`${MC_PROFILE_URL}/skins`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })
      if (!res.ok) return false

      // Apply cape if the skin has one
      if (skin.capeId) {
        await fetchWithRetry(`${MC_PROFILE_URL}/capes/active`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ capeId: skin.capeId }),
        })
      }

      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("skins:import-from-url", async (_event, params: { url: string; name: string; variant: "classic" | "slim"; accountId: string }) => {
    try {
      const dataDir = await dbHelpers.getLauncherDirectory()
      const skinsDir = path.join(dataDir, "skins")
      await fs.mkdir(skinsDir, { recursive: true })

      const res = await fetchWithRetry(params.url)
      if (!res.ok) return null

      const buffer = Buffer.from(await res.arrayBuffer())
      const id = crypto.randomUUID()
      const destPath = path.join(skinsDir, `${id}.png`)
      await fs.writeFile(destPath, buffer)

      const skin: LibrarySkin = {
        id,
        accountId: params.accountId,
        name: params.name,
        filePath: destPath,
        variant: params.variant,
        capeId: null,
        createdAt: new Date().toISOString(),
      }

      await dbHelpers.saveSkinToLibrary({
        id: skin.id,
        accountId: skin.accountId,
        name: skin.name,
        filePath: skin.filePath,
        variant: skin.variant,
        capeId: null,
        createdAt: skin.createdAt,
      })

      return skin
    } catch {
      return null
    }
  })
}
