// ============================================================
// Skins — реализация портов @xnlc/skins для Electron
// ============================================================
//
// Домен скинов не знает ни про базу, ни про файлы, ни про аккаунты: он просит
// их через порты. Здесь — единственное место, где эти просьбы превращаются в
// better-sqlite3, `fs` и обновление токена Microsoft.

import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import { fetchWithRetry } from "@xnlc/core/retry"
import type { LibrarySkin } from "@xnlc/types"
import type { ResolvedSkinAccount, SkinAccountPort, SkinDiskCache, SkinLibraryStore } from "@xnlc/skins"
import { dbHelpers } from "../../db"
import type { SkinLibraryRow } from "../../db"
import { getMicrosoftDeviceClientId } from "../config"

const MS_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
const XBOX_LIVE_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate"
const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize"
const MC_LAUNCHER_LOGIN_URL = "https://api.minecraftservices.com/launcher/login"
const MS_SCOPE = "XboxLive.SignIn XboxLive.offline_access"
const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }

/** Каталоги лаунчера, которые нужны домену скинов. */
async function skinsDir(): Promise<string> {
  return path.join(await dbHelpers.getLauncherDirectory(), "skins")
}

async function labyCacheDir(): Promise<string> {
  const dir = path.join(await dbHelpers.getLauncherDirectory(), "cache", "laby")
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/** Имя файла кэша не должно уметь выйти за пределы каталога. */
function cacheFileName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "_")
}

/**
 * Дисковый кэш каталога: `<data>/cache/laby`.
 *
 * Нужен офлайн-режиму — когда Laby не отвечает, показываем последнее удачное
 * содержимое вместо пустого экрана.
 */
export function createDiskCache(): SkinDiskCache {
  return {
    async read(name) {
      try {
        const dir = await labyCacheDir()
        return new Uint8Array(await fs.readFile(path.join(dir, cacheFileName(name))))
      } catch {
        return null
      }
    },
    async write(name, data) {
      try {
        const dir = await labyCacheDir()
        await fs.writeFile(path.join(dir, cacheFileName(name)), data as Uint8Array)
      } catch {
        // Кэш вспомогательный: не смогли записать — работаем дальше.
      }
    },
  }
}

/**
 * «Избранное»: строка в `skin_library` плюс PNG в `<data>/skins`.
 *
 * Обе половины живут в одной реализации намеренно: запись без файла (и
 * наоборот) — уже сломанное состояние, а раньше удаление искало строку по
 * пустому `accountId` и PNG оставался на диске навсегда.
 */
export function createLibraryStore(): SkinLibraryStore {
  const toSkin = (row: SkinLibraryRow): LibrarySkin => ({
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    filePath: row.filePath,
    variant: row.variant === "slim" ? "slim" : "classic",
    capeId: row.capeId ?? null,
    createdAt: row.createdAt,
    sourceId: row.sourceId ?? null,
  })

  return {
    async list(accountId) {
      return (await dbHelpers.loadSkinLibrary(accountId)).map(toSkin)
    },
    async findById(id) {
      const row = await dbHelpers.findLibrarySkinById(id)
      return row ? toSkin(row) : null
    },
    async findBySource(accountId, sourceId) {
      const row = await dbHelpers.findLibrarySkinBySource(accountId, sourceId)
      return row ? toSkin(row) : null
    },
    async create(input) {
      const dir = await skinsDir()
      await fs.mkdir(dir, { recursive: true })

      const id = crypto.randomUUID()
      const filePath = path.join(dir, `${id}.png`)
      await fs.writeFile(filePath, input.data as Uint8Array)

      const skin: LibrarySkin = {
        id,
        accountId: input.accountId,
        name: input.name,
        filePath,
        variant: input.variant,
        capeId: input.capeId ?? null,
        createdAt: new Date().toISOString(),
        sourceId: input.sourceId ?? null,
      }

      await dbHelpers.saveSkinToLibrary({ ...skin, sourceId: skin.sourceId ?? null })
      return skin
    },
    async remove(id) {
      const skin = await dbHelpers.findLibrarySkinById(id)
      if (skin?.filePath) await fs.unlink(skin.filePath).catch(() => {})
      await dbHelpers.deleteSkinFromLibrary(id)
    },
    async update(id, patch) {
      if (patch.variant !== undefined) await dbHelpers.updateSkinVariant(id, patch.variant)
      if (patch.capeId !== undefined) await dbHelpers.updateSkinCapeId(id, patch.capeId)
      if (patch.name !== undefined) await dbHelpers.updateSkinName(id, patch.name)
    },
    async readTexture(id) {
      const skin = await dbHelpers.findLibrarySkinById(id)
      if (!skin?.filePath) return null
      try {
        return new Uint8Array(await fs.readFile(skin.filePath))
      } catch {
        return null
      }
    },
  }
}

async function loadAccount(accountId?: string) {
  const accounts = await dbHelpers.loadAccounts()
  if (accountId) return accounts.find((account) => account.id === accountId)
  return accounts.find((account) => account.isActive) ?? accounts[0]
}

/**
 * Обновление токена Minecraft Services по refresh-токену Microsoft.
 *
 * Токен живёт ~24 часа, поэтому одного `account.accessToken` мало: без
 * обновления скин молча не надевался до перезапуска лаунчера.
 */
async function refreshMicrosoftMcToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const clientId = await getMicrosoftDeviceClientId()
    const msRes = await fetchWithRetry(MS_TOKEN_URL, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: MS_SCOPE,
      }).toString(),
    }, { retries: 1 })
    if (!msRes.ok) return null
    const msData = (await msRes.json()) as Record<string, unknown>
    const msaAccessToken = msData.access_token as string
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
    const xblData = (await xblRes.json()) as Record<string, unknown>
    const xblToken = xblData.Token as string
    const xblUhs = (xblData.DisplayClaims as { xui?: Array<{ uhs?: string }> })?.xui?.[0]?.uhs ?? ""
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
    const xstsToken = ((await xstsRes.json()) as Record<string, unknown>).Token as string
    if (!xstsToken) return null

    const mcRes = await fetchWithRetry(MC_LAUNCHER_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ xtoken: `XBL3.0 x=${xblUhs};${xstsToken}`, platform: "PC_LAUNCHER" }),
    }, { retries: 1 })
    if (!mcRes.ok) return null
    const mcAccessToken = ((await mcRes.json()) as Record<string, unknown>).access_token as string
    if (!mcAccessToken) return null

    return { accessToken: mcAccessToken, refreshToken: (msData.refresh_token as string) || refreshToken }
  } catch {
    return null
  }
}

async function toResolved(account: Awaited<ReturnType<typeof loadAccount>>): Promise<ResolvedSkinAccount | null> {
  if (!account) return null
  if (account.accessToken) {
    return {
      id: account.id,
      type: account.type,
      username: account.username,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
    }
  }
  if (account.type === "microsoft" && account.refreshToken) {
    const refreshed = await refreshMicrosoftMcToken(account.refreshToken)
    if (refreshed) {
      await dbHelpers.saveAccount({ ...account, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken })
      return {
        id: account.id,
        type: account.type,
        username: account.username,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      }
    }
  }
  return null
}

/** Аккаунт и его рабочий токен Minecraft Services. */
export function createAccountPort(): SkinAccountPort {
  return {
    async resolve(accountId) {
      return toResolved(await loadAccount(accountId))
    },
    async refresh(account) {
      if (account.type !== "microsoft" || !account.refreshToken) return null
      const refreshed = await refreshMicrosoftMcToken(account.refreshToken)
      if (!refreshed) return null
      const stored = await loadAccount(account.id)
      if (stored) {
        await dbHelpers.saveAccount({
          ...stored,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        })
      }
      return { ...account, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken }
    },
  }
}