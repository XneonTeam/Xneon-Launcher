import { ipcMain, BrowserWindow } from "electron"
import path from "path"
import crypto from "node:crypto"
import { getMainWindow } from "./runtime"
import { ensureRuntimeTempDir } from "./runtime"

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

import { getElyClientId, getElyClientSecret, getXnClientId, getXnClientSecret } from "./config"

const ELY_REDIRECT_URI = "http://localhost:51234/elyby/callback"
const ELY_SCOPE = "account_info minecraft_server_session offline_access"

const XN_REDIRECT_URI = "http://localhost:5123/xneon/callback1"
const XN_SCOPE = "account_info offline_access"
const XN_AUTH_SERVER = "https://skins.xneon.org"

async function getElyClientIdResolved(): Promise<string> {
  return getElyClientId()
}

async function getElyClientSecretResolved(): Promise<string> {
  return getElyClientSecret()
}

async function getXnClientIdResolved(): Promise<string> {
  return getXnClientId()
}

async function getXnClientSecretResolved(): Promise<string> {
  return getXnClientSecret()
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

function makeOAuthWindow(title: string) {
  ensureRuntimeTempDir()
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
  const clientId = await getElyClientIdResolved()
  const authUrl = new URL("https://account.ely.by/oauth2/v1")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", ELY_REDIRECT_URI)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", ELY_SCOPE)

  const authWindow = makeOAuthWindow("elyby")
  authWindow.show()
  authWindow.focus()

  const code = await new Promise<string>((resolve, reject) => {
    createAuthCallbackHandler(authWindow, "auth:elyby-callback", ELY_REDIRECT_URI, resolve, reject, undefined)
    authWindow.loadURL(authUrl.toString())
  })

  return exchangeElyByCode(code)
})

ipcMain.handle("auth:xnskins-login", async (): Promise<XnSkinsAccountPayload> => {
  const state = crypto.randomBytes(12).toString("hex")
  const clientId = await getXnClientIdResolved()

  const authorizeUrl = new URL(`${XN_AUTH_SERVER}/oauth2/authorize`)
  authorizeUrl.searchParams.set("client_id", clientId)
  authorizeUrl.searchParams.set("redirect_uri", XN_REDIRECT_URI)
  authorizeUrl.searchParams.set("scope", XN_SCOPE)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("state", state)

  const encodeURIComponentAll = (str: string) =>
    encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

  const authorizeUrlStr = authorizeUrl.toString()
  const loginUrlStr = `${XN_AUTH_SERVER}/login?next=${encodeURIComponentAll(authorizeUrlStr)}`

  console.log("[XN Skins] authorizeUrl:", authorizeUrlStr)
  console.log("[XN Skins] loginUrl:", loginUrlStr)

  const authWindow = makeOAuthWindow("xnskins")
  authWindow.show()
  authWindow.focus()

  const code = await new Promise<string>((resolve, reject) => {
    createAuthCallbackHandler(authWindow, "auth:xnskins-callback", XN_REDIRECT_URI, resolve, reject, state)
    authWindow.loadURL(loginUrlStr)
  })

  return exchangeXnSkinsCode(code)
})

ipcMain.handle("auth:microsoft-login", async (): Promise<MicrosoftAccountPayload> => {
  const microsoft = await loadMicrosoftModule()
  const redirectUri = microsoft.getMicrosoftRedirectUri()
  const authUrl = microsoft.createMicrosoftAuthUrl()

  const authWindow = makeOAuthWindow("microsoft")
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
    const [clientId, clientSecret] = await Promise.all([
      getElyClientIdResolved(),
      getElyClientSecretResolved(),
    ])

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

async function exchangeXnSkinsCode(code: string): Promise<XnSkinsAccountPayload> {
  const controller = new AbortController()
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error("Превышено время ожидания ответа от XN Skins"))
    }, 30000)
    controller.signal.addEventListener("abort", () => clearTimeout(timer))
  })

  try {
    const [clientId, clientSecret] = await Promise.all([
      getXnClientIdResolved(),
      getXnClientSecretResolved(),
    ])

    const tokenRes = await Promise.race([
      fetch(`${XN_AUTH_SERVER}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: XN_REDIRECT_URI,
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

    const accessToken = tokenData.access_token as string
    const refreshToken = (tokenData.refresh_token as string) ?? ""

    const userRes = await Promise.race([
      fetch(`${XN_AUTH_SERVER}/oauth2/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      }),
      timeout,
    ]) as Response

    if (!userRes.ok) {
      throw new Error("Не удалось получить информацию о пользователе XN Skins")
    }

    const userInfo = await userRes.json() as Record<string, unknown>
    const rootProfile = (userInfo.profile as Record<string, unknown> | undefined) ?? {}
    const selectedProfile = (userInfo.selectedProfile as Record<string, unknown> | undefined) ?? {}
    const user = (userInfo.user as Record<string, unknown> | undefined) ?? {}
    const profiles = Array.isArray(userInfo.profiles) ? userInfo.profiles : []
    const firstProfile = (profiles[0] as Record<string, unknown> | undefined) ?? {}

    const uuid = pickFirstString(
      userInfo.uuid,
      userInfo.profileId,
      rootProfile.uuid,
      rootProfile.id,
      rootProfile.profileId,
      selectedProfile.uuid,
      selectedProfile.id,
      selectedProfile.profileId,
      user.uuid,
      user.id,
      user.profileId,
      firstProfile.uuid,
      firstProfile.id,
      firstProfile.profileId,
    )

    const username = pickFirstString(
      userInfo.username,
      userInfo.name,
      rootProfile.username,
      rootProfile.name,
      selectedProfile.username,
      selectedProfile.name,
      user.username,
      user.name,
      firstProfile.username,
      firstProfile.name,
    ) || "Unknown"

    return {
      id: uuid || username,
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
