import { ipcMain, BrowserWindow } from "electron"
import path from "path"
import crypto from "node:crypto"
import { getMainWindow } from "./runtime"
import { ensureRuntimeTempDir } from "./runtime"
import { getMicrosoftClientId, getMicrosoftDeviceClientId, getElyClientId, getElyDeviceClientId } from "./config"
import { fetchWithRetry } from "@xnlc/core/retry"

const MICROSOFT_DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode"
const MICROSOFT_DEVICE_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
const MICROSOFT_DEVICE_SCOPE = "XboxLive.SignIn XboxLive.offline_access"
const XBOX_LIVE_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate"
const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize"
const MINECRAFT_LAUNCHER_LOGIN_URL = "https://api.minecraftservices.com/launcher/login"
const MINECRAFT_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile"
const DEVICE_FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }
const DEVICE_HTTP_TIMEOUT_MS = 30000

type MicrosoftAccountPayload = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken: string
}

type MicrosoftModule = {
  getMicrosoftRedirectUri: () => string
  createMicrosoftAuthUrl: () => string
  exchangeMicrosoftCode: (code: string) => Promise<MicrosoftAccountPayload>
}

let microsoftModulePromise: Promise<MicrosoftModule> | null = null

function loadMicrosoftModule(): Promise<MicrosoftModule> {
  if (!microsoftModulePromise) {
    microsoftModulePromise = import("@xnlc/core/microsoft")
  }
  return microsoftModulePromise
}

type ElyByAccountPayload = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken: string
}

type XnSkinsAccountPayload = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken: string
}

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return ""
}

import { getElyClientSecret } from "./config"

const ELY_REDIRECT_URI = "http://localhost:51234/elyby/callback"
const ELY_SCOPE = "account_info minecraft_server_session offline_access"
const ELY_DEVICE_CODE_URL = "https://account.ely.by/api/oauth2/v1/devicecode"
const ELY_DEVICE_TOKEN_URL = "https://account.ely.by/api/oauth2/v1/token"
const ELY_INFO_URL = "https://account.ely.by/api/account/v1/info"

const XN_REDIRECT_URI = "http://localhost:5123/xneon/callback"
const XN_CLIENT_ID = "rxBXISdaEO9P"
const XN_SCOPE = "account_info offline_access minecraft_server_session"
const XN_AUTH_SERVER = "https://skins.xneon.org"
const XN_DEVICE_CODE_URL = `${XN_AUTH_SERVER}/api/oauth2/v1/devicecode`
const XN_DEVICE_TOKEN_URL = `${XN_AUTH_SERVER}/api/oauth2/v1/token`
const XN_ACCOUNT_INFO_URL = `${XN_AUTH_SERVER}/api/account/v1/info`

async function getElyClientSecretResolved(): Promise<string> {
  return getElyClientSecret()
}

function createAuthCallbackHandler(
  authWindow: BrowserWindow,
  callbackChannel: string,
  redirectUri: string,
  resolve: (code: string) => void,
  reject: (error: Error) => void,
  expectedState?: string,
) {
  let isSettled = false

  let cleanup = () => {
    if (isSettled) return
    isSettled = true
    authWindow.removeAllListeners("close")
    authWindow.removeAllListeners("closed")
    authWindow.webContents.removeAllListeners("will-navigate")
    authWindow.webContents.removeAllListeners("will-redirect")
    authWindow.webContents.removeAllListeners("did-navigate")
    authWindow.webContents.removeAllListeners("did-redirect-navigation")
    authWindow.webContents.removeAllListeners("did-navigate-in-page")
  }

  const handleWindowClose = () => {
    if (isSettled) return
    cleanup()
    if (!authWindow.isDestroyed()) {
      authWindow.close()
    }
    reject(new Error("Авторизация отменена"))
  }

  const handleCallback = (url: string) => {
    if (!url.startsWith(redirectUri)) return
    if (isSettled) return
    try {
      const params = new URL(url).searchParams
      const error = params.get("error")
      if (error) {
        const errorDesc = params.get("error_description") ?? params.get("error_message") ?? error
        const isDenied = error === "access_denied" || errorDesc?.includes("denied")
        cleanup()
        if (!authWindow.isDestroyed()) {
          authWindow.close()
        }
        reject(new Error(isDenied ? "Авторизация отменена" : errorDesc))
        return
      }
      const code = params.get("code")
      const returnedState = params.get("state")
      if (expectedState && returnedState !== expectedState) {
        cleanup()
        if (!authWindow.isDestroyed()) {
          authWindow.close()
        }
        reject(new Error("State mismatch"))
        return
      }
      if (!code) {
        cleanup()
        if (!authWindow.isDestroyed()) {
          authWindow.close()
        }
        reject(new Error("No authorization code received"))
        return
      }
      cleanup()
      if (!authWindow.isDestroyed()) {
        authWindow.close()
      }
      resolve(code)
    } catch (err) {
      cleanup()
      if (!authWindow.isDestroyed()) {
        authWindow.close()
      }
      reject(new Error(String(err)))
    }
  }

  const ipcHandler = (_event: Electron.IpcMainEvent, url: string) => handleCallback(url)

  authWindow.on("close", handleWindowClose)
  authWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(redirectUri)) return
    event.preventDefault()
    handleCallback(url)
  })
  authWindow.webContents.on("will-redirect", (event, url) => {
    if (!url.startsWith(redirectUri)) return
    event.preventDefault()
    handleCallback(url)
  })
  authWindow.webContents.on("did-navigate", (_event, url) => handleCallback(url))
  authWindow.webContents.on("did-redirect-navigation", (_event, url) => handleCallback(url))
  authWindow.webContents.on("did-navigate-in-page", (_event, url) => handleCallback(url))

  ipcMain.on(`${callbackChannel}`, ipcHandler)

  const origCleanup = cleanup
  cleanup = () => {
    origCleanup()
    ipcMain.removeListener(`${callbackChannel}`, ipcHandler)
  }
}

export { XN_AUTH_SERVER, XN_REDIRECT_URI, XN_SCOPE }

async function makeOAuthWindow(title: string) {
  await ensureRuntimeTempDir()
  const preload = title === "xnskins"
    ? path.join(__dirname, "../auth-xnskins-preload.js")
    : path.join(__dirname, "../auth-preload.js")

  // Уникальная in-memory сессия для каждого запуска авторизации
  const sessionPartition = `in-memory://xnskins-auth-${Date.now()}`

  const authWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    show: true,
    modal: false,
    backgroundColor: "#141420",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: sessionPartition,
      preload,
    },
  })

  return authWindow
}

ipcMain.handle("auth:elyby-login", async (): Promise<ElyByAccountPayload> => {
  const clientId = await getElyClientId()
  const state = crypto.randomBytes(16).toString("hex")
  const authUrl = new URL("https://account.ely.by/oauth2/v1")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", ELY_REDIRECT_URI)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", ELY_SCOPE)
  authUrl.searchParams.set("state", state)

  const authWindow = await makeOAuthWindow("elyby")
  authWindow.show()
  authWindow.focus()

  const code = await new Promise<string>((resolve, reject) => {
    createAuthCallbackHandler(authWindow, "auth:elyby-callback", ELY_REDIRECT_URI, resolve, reject, state)
    authWindow.loadURL(authUrl.toString())
  })

  return exchangeElyByCode(code)
})

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

ipcMain.handle("auth:xnskins-login", async (): Promise<XnSkinsAccountPayload> => {
  const state = crypto.randomBytes(12).toString("hex")
  const clientId = XN_CLIENT_ID

  // PKCE (RFC 7636) — verifier хранится только на этом устройстве
  const verifier = toBase64Url(crypto.randomBytes(64))
  const challenge = toBase64Url(crypto.createHash("sha256").update(verifier).digest())

  const authorizeUrl = new URL(`${XN_AUTH_SERVER}/oauth2/authorize`)
  authorizeUrl.searchParams.set("client_id", clientId)
  authorizeUrl.searchParams.set("redirect_uri", XN_REDIRECT_URI)
  authorizeUrl.searchParams.set("scope", XN_SCOPE)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("state", state)
  authorizeUrl.searchParams.set("code_challenge", challenge)
  authorizeUrl.searchParams.set("code_challenge_method", "S256")

  const encodeURIComponentAll = (str: string) =>
    encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

  const authorizeUrlStr = authorizeUrl.toString()
  const loginUrlStr = `${XN_AUTH_SERVER}/login?next=${encodeURIComponentAll(authorizeUrlStr)}`

  console.log("[XN Skins] authorizeUrl:", authorizeUrlStr)
  console.log("[XN Skins] loginUrl:", loginUrlStr)

  const authWindow = await makeOAuthWindow("xnskins")
  authWindow.show()
  authWindow.focus()

  const code = await new Promise<string>((resolve, reject) => {
    createAuthCallbackHandler(authWindow, "auth:xnskins-callback", XN_REDIRECT_URI, resolve, reject, state)
    authWindow.loadURL(loginUrlStr)
  })

  return exchangeXnSkinsCode(code, verifier)
})

ipcMain.handle("auth:microsoft-login", async (): Promise<MicrosoftAccountPayload> => {
  const microsoft = await loadMicrosoftModule()
  const redirectUri = microsoft.getMicrosoftRedirectUri()
  const authUrl = microsoft.createMicrosoftAuthUrl()

  const authWindow = await makeOAuthWindow("microsoft")
  authWindow.show()
  authWindow.focus()

  const code = await new Promise<string>((resolve, reject) => {
    createAuthCallbackHandler(authWindow, "auth:microsoft-callback", redirectUri, resolve, reject, undefined)
    authWindow.loadURL(authUrl)
  })

  return microsoft.exchangeMicrosoftCode(code)
})

async function exchangeElyByCode(code: string): Promise<ElyByAccountPayload> {
  const controller = new AbortController()
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error("Превышено время ожидания ответа от Ely.By"))
    }, 30000)
    controller.signal.addEventListener("abort", () => clearTimeout(timer))
  })

  try {
    const clientId = await getElyClientId()
    const clientSecret = await getElyClientSecretResolved()

    const tokenRes = await Promise.race([
      fetch("https://account.ely.by/api/oauth2/v1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: ELY_REDIRECT_URI,
          code,
        }).toString(),
        signal: controller.signal,
      }),
      timeout,
    ]) as Response

    const tokenData = await tokenRes.json() as Record<string, unknown>
    if (tokenRes.status >= 400 || !tokenData.access_token) {
      const desc = (tokenData.error_description ?? tokenData.error ?? "Token exchange failed") as string
      throw new Error(desc)
    }

    const userRes = await Promise.race([
      fetch("https://account.ely.by/api/account/v1/info", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: controller.signal,
      }),
      timeout,
    ]) as Response

    if (!userRes.ok) {
      throw new Error("Не удалось получить информацию о пользователе")
    }

    const userInfo = await userRes.json() as Record<string, string | number>

    return {
      id: String(userInfo.id),
      uuid: userInfo.uuid as string,
      username: userInfo.username as string,
      accessToken: tokenData.access_token as string,
      refreshToken: (tokenData.refresh_token as string) ?? "",
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("Превышено время ожидания ответа от Ely.By")
    throw err instanceof Error ? err : new Error(String(err))
  }
}

async function fetchXnAccountInfo(accessToken: string): Promise<{ id: string; uuid: string; username: string }> {
  const userRes = await fetch(XN_ACCOUNT_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!userRes.ok) {
    throw new Error("Не удалось получить информацию о пользователе XN Skins")
  }

  const userInfo = await userRes.json() as Record<string, unknown>
  const profile = (userInfo.profile as Record<string, unknown> | undefined) ?? {}

  const uuid = pickFirstString(
    userInfo.uuid,
    userInfo.id,
    userInfo.profileId,
    profile.uuid,
    profile.id,
    profile.profileId,
  )

  const username = pickFirstString(
    userInfo.username,
    userInfo.name,
    profile.username,
    profile.name,
  ) || "Unknown"

  return { id: uuid || username, uuid, username }
}

async function exchangeXnSkinsCode(code: string, verifier: string): Promise<XnSkinsAccountPayload> {
  const controller = new AbortController()
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error("Превышено время ожидания ответа от XN Skins"))
    }, 30000)
    controller.signal.addEventListener("abort", () => clearTimeout(timer))
  })

  try {
    const clientId = XN_CLIENT_ID

    const tokenRes = await Promise.race([
      fetch(`${XN_AUTH_SERVER}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: XN_REDIRECT_URI,
          code,
          code_verifier: verifier,
        }).toString(),
        signal: controller.signal,
      }),
      timeout,
    ]) as Response

    const tokenData = await tokenRes.json() as Record<string, unknown>
    if (tokenRes.status >= 400 || !tokenData.access_token) {
      const desc = (tokenData.error_description ?? tokenData.error ?? "Token exchange failed") as string
      throw new Error(desc)
    }

    const accessToken = tokenData.access_token as string
    const refreshToken = (tokenData.refresh_token as string) ?? ""

    const { id, uuid, username } = await fetchXnAccountInfo(accessToken)

    return {
      id,
      uuid,
      username,
      accessToken,
      refreshToken,
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("Превышено время ожидания ответа от XN Skins")
    throw err instanceof Error ? err : new Error(String(err))
  }
}

// ── Microsoft Device Code Flow (RFC 8628) ──────────────────

type DeviceStartResult = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

type XToken = { token: string; uhs: string }

async function requestDeviceCode(clientId: string, scope: string, deviceCodeUrl: string): Promise<DeviceStartResult> {
  const body = new URLSearchParams({ client_id: clientId, scope })

  const response = await fetch(deviceCodeUrl, {
    method: "POST",
    body: body.toString(),
    headers: DEVICE_FORM_HEADERS,
  })

  const rsp = await response.json() as Record<string, unknown>
  if (!response.ok || rsp.error || !rsp.device_code || !rsp.user_code || !rsp.verification_uri || !rsp.expires_in) {
    throw new Error(`Device authorization failed: ${(rsp.error_description as string) || (rsp.error as string) || `HTTP ${response.status}`}`)
  }

  const interval = typeof rsp.interval === "number" ? rsp.interval : 5

  return {
    deviceCode: rsp.device_code as string,
    userCode: rsp.user_code as string,
    verificationUri: rsp.verification_uri as string,
    verificationUriComplete: (rsp.verification_uri_complete as string) || `${rsp.verification_uri}?user_code=${rsp.user_code}`,
    expiresIn: rsp.expires_in as number,
    interval,
  }
}

async function pollDeviceToken(clientId: string, deviceCode: string, tokenUrl: string): Promise<{ status: "pending" | "expired" | "complete"; slowDown?: boolean; error?: string; retryable?: boolean; accessToken?: string; refreshToken?: string }> {
  const controller = new AbortController()
  const timeoutTimer = setTimeout(() => controller.abort(), DEVICE_HTTP_TIMEOUT_MS)

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
    })

    const response = await fetch(tokenUrl, {
      method: "POST",
      body: body.toString(),
      headers: DEVICE_FORM_HEADERS,
      signal: controller.signal,
    })

    let rsp: Record<string, unknown>
    try {
      rsp = await response.json() as Record<string, unknown>
    } catch {
      return { status: "pending", retryable: true }
    }

    if (rsp.error === "slow_down") return { status: "pending", slowDown: true }
    if (rsp.error === "authorization_pending") return { status: "pending" }
    if (rsp.error === "expired_token") return { status: "expired" }
    if (rsp.error) {
      const retryable = rsp.error !== "access_denied" && rsp.error !== "authorization_declined"
      return { status: "complete", error: (rsp.error_description as string) || (rsp.error as string), retryable: retryable ? undefined : false }
    }
    if (!response.ok || !rsp.access_token) {
      return { status: "pending", retryable: true }
    }

    return {
      status: "complete",
      accessToken: rsp.access_token as string,
      refreshToken: (rsp.refresh_token as string) ?? "",
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { status: "pending", retryable: true }
    return { status: "complete", error: err instanceof Error ? err.message : String(err), retryable: true }
  } finally {
    clearTimeout(timeoutTimer)
  }
}

async function xboxUserStep(msaAccessToken: string): Promise<XToken> {
  const response = await fetchWithRetry(XBOX_LIVE_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" },
    body: JSON.stringify({
      Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${msaAccessToken}` },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  }, { retries: 2 })

  const raw = await response.text()
  if (!response.ok) throw new Error(`Xbox user authentication failed: HTTP ${response.status}: ${raw}`)

  const obj = JSON.parse(raw) as Record<string, unknown>
  const token = obj.Token as string | undefined
  const xui = (obj.DisplayClaims as { xui?: Array<{ uhs?: string }> } | undefined)?.xui
  const uhs = xui?.[0]?.uhs ?? ""
  if (!token || !uhs) throw new Error("Xbox user authentication: missing token or uhs")

  return { token, uhs }
}

async function xstsStep(userToken: string): Promise<XToken> {
  const response = await fetchWithRetry(XSTS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [userToken] },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  }, { retries: 2 })

  const raw = await response.text()
  if (!response.ok) {
    let xerr: number | undefined
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>
      xerr = typeof obj.XErr === "number" ? obj.XErr : undefined
    } catch { /* ignore */ }
    throw new Error(`XSTS authorization failed: HTTP ${response.status}${xerr !== undefined ? ` (XErr ${xerr})` : ""}`)
  }

  const obj = JSON.parse(raw) as Record<string, unknown>
  const token = obj.Token as string | undefined
  if (!token) throw new Error("XSTS authorization: missing token")
  return { token, uhs: "" }
}

async function minecraftLauncherLogin(uhs: string, xstsToken: string): Promise<{ accessToken: string; username: string }> {
  const response = await fetchWithRetry(MINECRAFT_LAUNCHER_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ xtoken: `XBL3.0 x=${uhs};${xstsToken}`, platform: "PC_LAUNCHER" }),
  }, { retries: 2 })

  const raw = await response.text()
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`Failed to get Minecraft access token: invalid JSON (HTTP ${response.status})`)
  }
  if (!response.ok) throw new Error(`Failed to get Minecraft access token: HTTP ${response.status}: ${raw}`)
  if (typeof obj.access_token !== "string" || typeof obj.username !== "string") {
    throw new Error("Failed to parse the Minecraft access token response.")
  }
  return { accessToken: obj.access_token, username: obj.username }
}

async function minecraftProfile(accessToken: string): Promise<{ id: string; name: string }> {
  const response = await fetchWithRetry(MINECRAFT_PROFILE_URL, {
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  }, { retries: 2 })

  const raw = await response.text()
  if (response.status === 404) return { id: "", name: "" }

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`Minecraft profile failed: invalid JSON (HTTP ${response.status})`)
  }
  if (!response.ok) throw new Error(`Minecraft profile failed: HTTP ${response.status}: ${raw}`)
  if (typeof obj.id !== "string" || typeof obj.name !== "string") {
    throw new Error("Minecraft Java profile response could not be parsed")
  }
  return { id: obj.id, name: obj.name }
}

async function exchangeDeviceMsaForMinecraft(msaAccessToken: string, refreshToken: string): Promise<MicrosoftAccountPayload> {
  const userToken = await xboxUserStep(msaAccessToken)
  const xstsToken = await xstsStep(userToken.token)
  const mc = await minecraftLauncherLogin(userToken.uhs, xstsToken.token)
  const profile = await minecraftProfile(mc.accessToken)

  const uuid = profile.id || mc.username
  const username = profile.name || mc.username || "Microsoft User"

  return {
    id: uuid || username,
    uuid: uuid || username,
    username,
    accessToken: mc.accessToken,
    refreshToken,
  }
}

ipcMain.handle("auth:microsoft-device-start", async (): Promise<DeviceStartResult> => {
  const clientId = await getMicrosoftDeviceClientId()
  return requestDeviceCode(clientId, MICROSOFT_DEVICE_SCOPE, MICROSOFT_DEVICE_CODE_URL)
})

ipcMain.handle("auth:microsoft-device-poll", async (_event, deviceCode: string) => {
  const clientId = await getMicrosoftDeviceClientId()
  const result = await pollDeviceToken(clientId, deviceCode, MICROSOFT_DEVICE_TOKEN_URL)

  if (result.status === "pending") {
    return { status: "pending" as const, slowDown: result.slowDown }
  }
  if (result.status === "expired") {
    return { status: "expired" as const }
  }
  if (result.error) {
    return { status: "error" as const, message: result.error, retryable: result.retryable }
  }
  if (!result.accessToken) {
    return { status: "error" as const, message: "Не удалось получить токен", retryable: true }
  }

  try {
    const account = await exchangeDeviceMsaForMinecraft(result.accessToken, result.refreshToken ?? "")
    return { status: "complete" as const, account }
  } catch (err) {
    return {
      status: "error" as const,
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    }
  }
})

// ── Ely.by Device Code Flow (RFC 8628) ─────────────────────

async function exchangeElyDeviceAccessToken(accessToken: string, refreshToken: string): Promise<ElyByAccountPayload> {
  const userRes = await fetch(ELY_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!userRes.ok) {
    throw new Error("Не удалось получить информацию о пользователе Ely.By")
  }

  const userInfo = await userRes.json() as Record<string, string | number>

  return {
    id: String(userInfo.id),
    uuid: String(userInfo.uuid ?? ""),
    username: String(userInfo.username ?? "Unknown"),
    accessToken,
    refreshToken,
  }
}

ipcMain.handle("auth:elyby-device-start", async (): Promise<DeviceStartResult> => {
  const clientId = await getElyDeviceClientId()
  return requestDeviceCode(clientId, ELY_SCOPE, ELY_DEVICE_CODE_URL)
})

ipcMain.handle("auth:elyby-device-poll", async (_event, deviceCode: string) => {
  const clientId = await getElyDeviceClientId()
  const result = await pollDeviceToken(clientId, deviceCode, ELY_DEVICE_TOKEN_URL)

  if (result.status === "pending") {
    return { status: "pending" as const, slowDown: result.slowDown }
  }
  if (result.status === "expired") {
    return { status: "expired" as const }
  }
  if (result.error) {
    return { status: "error" as const, message: result.error, retryable: result.retryable }
  }
  if (!result.accessToken) {
    return { status: "error" as const, message: "Не удалось получить токен", retryable: true }
  }

  try {
    const account = await exchangeElyDeviceAccessToken(result.accessToken, result.refreshToken ?? "")
    return { status: "complete" as const, account }
  } catch (err) {
    return {
      status: "error" as const,
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    }
  }
})

// ── XN Skins Device Code Flow (RFC 8628) ───────────────────

async function exchangeXnDeviceAccessToken(accessToken: string, refreshToken: string): Promise<XnSkinsAccountPayload> {
  const { id, uuid, username } = await fetchXnAccountInfo(accessToken)

  return {
    id,
    uuid,
    username,
    accessToken,
    refreshToken,
  }
}

ipcMain.handle("auth:xnskins-device-start", async (): Promise<DeviceStartResult> => {
  return requestDeviceCode(XN_CLIENT_ID, XN_SCOPE, XN_DEVICE_CODE_URL)
})

ipcMain.handle("auth:xnskins-device-poll", async (_event, deviceCode: string) => {
  const result = await pollDeviceToken(XN_CLIENT_ID, deviceCode, XN_DEVICE_TOKEN_URL)

  if (result.status === "pending") {
    return { status: "pending" as const, slowDown: result.slowDown }
  }
  if (result.status === "expired") {
    return { status: "expired" as const }
  }
  if (result.error) {
    return { status: "error" as const, message: result.error, retryable: result.retryable }
  }
  if (!result.accessToken) {
    return { status: "error" as const, message: "Не удалось получить токен", retryable: true }
  }

  try {
    const account = await exchangeXnDeviceAccessToken(result.accessToken, result.refreshToken ?? "")
    return { status: "complete" as const, account }
  } catch (err) {
    return {
      status: "error" as const,
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    }
  }
})

