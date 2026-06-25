import { ipcMain, app } from "electron"
import axios from "axios"
import { preload as datachannelPreload, cleanup as datachannelCleanup } from "node-datachannel"
import { dbHelpers } from "../../db"
import { sendToRenderer } from "../runtime"
import type { P2PClient as P2PClientType } from "@xnlc/p2p" with { "resolution-mode": "import" }
import type { P2PRole, P2PRoom, P2PRoomMember, P2PConnState } from "@xnlc/types" with { "resolution-mode": "import" }

const TOKEN_KEY = "p2p_token"
async function getP2pModule() {
  return import("@xnlc/p2p")
}

async function httpHost(): Promise<string> {
  const stored = await dbHelpers.getSetting("p2pHttpHost")
  const { DEFAULT_HTTP_HOST } = await getP2pModule()
  return stored || DEFAULT_HTTP_HOST
}

async function signalingHost(): Promise<string> {
  const stored = await dbHelpers.getSetting("p2pSignalingHost")
  const { DEFAULT_SIGNALING_HOST } = await getP2pModule()
  return stored || DEFAULT_SIGNALING_HOST
}

async function getToken(): Promise<string | null> {
  const stored = await dbHelpers.getSetting(TOKEN_KEY)
  return stored || null
}

async function setToken(token: string): Promise<void> {
  await dbHelpers.setSetting(TOKEN_KEY, token)
}

async function clearToken(): Promise<void> {
  await dbHelpers.setSetting(TOKEN_KEY, "")
}

function extractFromToken(token: string): { uid: string | null; login: string | null } {
  try {
    const encoded = token.split(".")[0]
    const pad = 4 - (encoded.length % 4)
    const payload = Buffer.from(encoded + "=".repeat(pad % 4), "base64url").toString("utf8")
    const data = JSON.parse(payload)
    return { uid: data?.uid ?? null, login: data?.login ?? null }
  } catch {
    return { uid: null, login: null }
  }
}

function authHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` }
}

let clientInstance: P2PClientType | null = null
let runtimeState: {
  state: P2PConnState
  role?: P2PRole
  groupName?: string
  playerName?: string
  groupId?: string
} = { state: "disconnected" }

function setState(state: P2PConnState): void {
  runtimeState = { ...runtimeState, state }
  sendToRenderer("p2p:state", state)
}

export function registerP2PHandlers(): void {
  datachannelPreload()

  app.on("will-quit", () => {
    try { datachannelCleanup() } catch { /* noop */ }
  })

  ipcMain.handle("p2p:register", async (_event, login: string, password: string) => {
    try {
      const base = await httpHost()
      const res = await axios.post(`${base}/auth/register`, { login, password }, { headers: { "Content-Type": "application/json" }, timeout: 15000 })
      if (res.data?.token) await setToken(res.data.token)
      return { success: true, token: res.data.token, userId: res.data.user_id, login: res.data.login }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:login", async (_event, login: string, password: string) => {
    try {
      const base = await httpHost()
      const res = await axios.post(`${base}/auth/login`, { login, password }, { headers: { "Content-Type": "application/json" }, timeout: 15000 })
      if (res.data?.token) await setToken(res.data.token)
      return { success: true, token: res.data.token, userId: res.data.user_id, login: res.data.login }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:get-me", async () => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      const res = await axios.get(`${base}/auth/me`, { headers: authHeaders(token), timeout: 15000 })
      return { success: true, login: res.data?.login, userId: res.data?.user_id }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:logout", async () => {
    await clearToken()
    return { success: true }
  })

  ipcMain.handle("p2p:list-rooms", async () => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      const res = await axios.get(`${base}/groups`, { headers: authHeaders(token), timeout: 15000 })
      const groups: Array<{ id: string; name: string; created_by?: string; is_host?: number; created_at?: number }> = res.data?.groups ?? []
      const rooms: P2PRoom[] = groups.map((g) => ({
        id: g.id,
        name: g.name,
        isHost: Boolean(g.is_host) || Boolean(g.created_by && res.data?.user_id && g.created_by === res.data.user_id),
        createdAt: Number(g.created_at) || 0,
      }))
      return { success: true, rooms }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:create-room", async (_event, name: string, password?: string) => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      const body: Record<string, unknown> = { name }
      if (password && password.length > 0) body.password = password
      const res = await axios.post(`${base}/groups/create`, body, { headers: { ...authHeaders(token), "Content-Type": "application/json" }, timeout: 15000 })
      return { success: true, groupId: res.data?.group_id, name: res.data?.name }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:join-room", async (_event, name: string, password?: string) => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      const body: Record<string, unknown> = { name }
      if (password && password.length > 0) body.password = password
      const res = await axios.post(`${base}/groups/join`, body, { headers: { ...authHeaders(token), "Content-Type": "application/json" }, timeout: 15000 })
      return { success: true, groupId: res.data?.group_id, name: res.data?.name }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:list-members", async (_event, groupId: string) => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      const res = await axios.get(`${base}/groups/${groupId}/members`, { headers: authHeaders(token), timeout: 15000 })
      const members: Array<{ id?: string; login?: string; is_host?: number; client_uuid?: string; joined_at?: number }> = res.data?.members ?? []
      const mapped: P2PRoomMember[] = members.map((m) => ({
        id: m.id ?? "",
        login: m.login ?? "?",
        isHost: Boolean(m.is_host),
        clientUuid: m.client_uuid,
        joinedAt: Number(m.joined_at) || 0,
      }))
      return { success: true, members: mapped }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:delete-room", async (_event, groupId: string) => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      await axios.delete(`${base}/groups/${groupId}`, { headers: authHeaders(token), timeout: 15000 })
      return { success: true }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:transfer-host", async (_event, groupId: string, targetUserId: string) => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      await axios.post(`${base}/groups/${groupId}/transfer`, { target_user_id: targetUserId }, { headers: { ...authHeaders(token), "Content-Type": "application/json" }, timeout: 15000 })
      return { success: true }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:kick-member", async (_event, groupId: string, userId: string) => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      await axios.post(`${base}/groups/${groupId}/kick`, { user_id: userId }, { headers: { ...authHeaders(token), "Content-Type": "application/json" }, timeout: 15000 })
      return { success: true }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:leave-room", async (_event, groupId: string) => {
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }
    try {
      const base = await httpHost()
      await axios.post(`${base}/groups/${groupId}/leave`, {}, { headers: authHeaders(token), timeout: 15000 })
      return { success: true }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? e.message) : String(e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle("p2p:start", async (_event, role: P2PRole, groupId: string, groupName: string, _playerName: string) => {
    if (clientInstance) {
      try { await clientInstance.close(true) } catch { /* noop */ }
      clientInstance = null
    }
    const token = await getToken()
    if (!token) return { success: false, error: "no token" }

    const sigHost = await signalingHost()
    const httpBase = await httpHost()
    const { uid, login } = extractFromToken(token)
    if (!uid || !login) return { success: false, error: "invalid token" }
    const clientUuid = uid
    const playerName = login

    runtimeState = { state: "connecting", role, groupName, playerName, groupId }
    setState("connecting")

    const { P2PClient } = await import("@xnlc/p2p")
    clientInstance = new P2PClient(
      sigHost, httpBase, groupId, playerName, clientUuid, token, role === "host",
      (event, data) => {
        if (event === "state") {
          setState(data as P2PConnState)
        } else if (event === "lan") {
          sendToRenderer("p2p:lan", data)
        } else if (event === "lan_remove") {
          sendToRenderer("p2p:lan_remove", data)
        } else if (event === "chat") {
          sendToRenderer("p2p:chat", data)
        }
      },
      (level, ts, prefix, message) => {
        sendToRenderer("p2p:log", { ts, level, prefix, message })
      },
    )
    try {
      await clientInstance.connect()
      return { success: true }
    } catch (e) {
      setState("failed")
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle("p2p:stop", async () => {
    if (clientInstance) {
      try { await clientInstance.close() } catch { /* noop */ }
      clientInstance = null
    }
    setState("disconnected")
    return { success: true }
  })

  ipcMain.handle("p2p:get-state", async () => {
    return runtimeState
  })

  ipcMain.handle("p2p:send-chat", async (_event, message: string) => {
    if (!clientInstance) return { success: false, error: "not connected" }
    try {
      clientInstance.sendChat(message)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
