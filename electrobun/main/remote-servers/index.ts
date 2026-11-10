import { app, rpcRegistry } from "../../platform/desktop"
import { randomUUID } from "node:crypto"
import { assertRemoteServerOperation, ShareError } from "@xnlc/share"
import type { McServerInfo, RemoteServerAccess, RemoteServerRequest, RemoteServerResponse } from "@xnlc/types"
import { dbHelpers } from "../../db"
import { shareConfiguration, shareRequest } from "../share/auth"
import { getMcServerDir } from "../paths"
import { sendToRenderer, logRuntime } from "../runtime"
import { serverManager } from "@xnlc/servers"
import { configureRemoteServerProxy, executeLocalServerOperation, runServerMutation } from "./handlers"
import { launcherOperations } from "../../platform/operation-gate"
import { assertRemoteServerPaths, downloadRemoteServerFile } from "./files"
import { deleteServerHistory } from "./history-handlers"

type Host = { serverId: string; remoteId: string; userId: string }
type Connection = { access: RemoteServerAccess; socket: WebSocket; ready: Promise<void>; online: boolean; watchers: number; timer?: ReturnType<typeof setInterval>; heartbeat?: ReturnType<typeof setInterval>; snapshot?: any; publishedInfo?: string; pending: Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }> }
const connections = new Map<string, Connection>()
const connecting = new Map<string, Promise<Connection>>()
const wantedClients = new Set<string>(), takenOver = new Set<string>()
let remoteList: McServerInfo[] = [], listUser = "", shuttingDown = false, starting = false
const hostsKey = "remoteServers.hosts"
const hosts = async (): Promise<Host[]> => { try { return JSON.parse(await dbHelpers.getSetting(hostsKey) || "[]") } catch { return [] } }
const saveHosts = (values: Host[]) => dbHelpers.setSetting(hostsKey, JSON.stringify(values))
const remoteInfo = (access: RemoteServerAccess, online = false): McServerInfo => ({ ...access.info, id: `remote:${access.id}`, remote: { id: access.id, ownerName: access.ownerName, permissions: access.permissions, online } })
const endpoint = (id: string) => `/remote-servers/${encodeURIComponent(id)}`
function closeConnection(id: string) {
  const connection = connections.get(id)
  if (!connection) return
  clearInterval(connection.timer)
  clearInterval(connection.heartbeat)
  connection.socket.close()
  for (const pending of connection.pending.values()) { clearTimeout(pending.timer); pending.reject(new ShareError("OFFLINE", "REMOTE_OFFLINE")) }
  connections.delete(id)
}
function notify(connection: Connection) {
  const id = `remote:${connection.access.id}`
  sendToRenderer("mc-server:remote-connection", { id, online: connection.online, info: remoteInfo(connection.access, connection.online) })
}
async function snapshot(connection: Connection, localId: string) {
  if (connection.socket.readyState !== WebSocket.OPEN) return
  const row = await dbHelpers.getMcServer(localId)
  if (!row || row.trashedAt) { connection.socket.close(); return }
  const info = await executeLocalServerOperation("mc-server:get", localId)
  // Крупные картинки и локальные пути не нужны в постоянном канале состояния.
  const safeInfo = { ...info, id: undefined, javaPath: undefined, icon: info.icon?.length <= 32768 ? info.icon : undefined }
  const encodedInfo = JSON.stringify(safeInfo)
  if (connection.publishedInfo !== encodedInfo) { await shareRequest(endpoint(connection.access.id), "PATCH", { info: safeInfo }); connection.publishedInfo = encodedInfo }
  const logs = serverManager.getLogBuffer(localId).slice(-200).map(line => line.slice(0, 400)).slice(-180)
  connection.socket.send(JSON.stringify({ type: "snapshot", info: safeInfo, logs, state: serverManager.getState(localId), metrics: serverManager.getMetricsSync(localId), install: await executeLocalServerOperation("mc-server:install-state", localId) }))
}
async function connect(access: RemoteServerAccess, localId?: string): Promise<Connection> {
  const existing = connections.get(access.id)
  if (existing && existing.socket.readyState < WebSocket.CLOSING) return existing
  const running = connecting.get(access.id)
  if (running) return running
  const task = (async () => {
    const { ticket } = await shareRequest(endpoint(access.id) + "/ticket", "POST", {})
    const configuration = await shareConfiguration()
    const url = new URL(`/remote-servers/connect/${ticket}`, configuration.url)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const socket = new WebSocket(url), pending = new Map()
    let resolveReady: () => void, rejectReady: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    const connection: Connection = { access, socket, ready, pending, online: false, watchers: 0 }
    connections.set(access.id, connection)
    const timeout = setTimeout(() => { rejectReady(new ShareError("OFFLINE", "REMOTE_OFFLINE")); socket.close() }, 15000)
    socket.addEventListener("message", event => {
      void (async () => {
        const packet = JSON.parse(String(event.data))
        if (packet.type === "ready") {
          clearTimeout(timeout); connection.online = packet.online; resolveReady(); if (!localId) notify(connection)
          let lastPong = Date.now()
          socket.addEventListener("message", event => { try { if (JSON.parse(String(event.data)).type === "pong") lastPong = Date.now() } catch {} })
          connection.heartbeat = setInterval(() => { if (Date.now() - lastPong > 60000) socket.close(); else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" })) }, 20000)
        }
        if (localId) {
          if (packet.type === "watchers") {
            connection.watchers = packet.count
            clearInterval(connection.timer)
            if (packet.count) {
              await snapshot(connection, localId)
              connection.timer = setInterval(() => { void snapshot(connection, localId).catch(() => {}) }, 2500)
            }
          }
          if (packet.type === "command") {
            try {
              await launcherOperations.run(async () => {
                const row = await dbHelpers.getMcServer(localId)
                if (!row || row.trashedAt) throw new ShareError("REMOTE_DELETED", "Remote server is unavailable")
                // Права проверяются повторно по актуальному списку, а не по данным отправителя.
                const current = await shareRequest(endpoint(access.id)) as RemoteServerAccess
                const actor = current.members?.find(member => member.id === packet.actor)
                if (!actor) throw new ShareError("FORBIDDEN", "REMOTE_FORBIDDEN")
                assertRemoteServerOperation(actor.permissions, packet.channel, packet.args)
                await assertRemoteServerPaths(getMcServerDir(localId), packet.channel, packet.args)
                const operationArgs = packet.channel === "mc-server:history" ? [...packet.args, { id: actor.id, name: actor.name }] : packet.args
                let result = packet.channel === "mc-server:fs-download" ? await runServerMutation(localId, () => downloadRemoteServerFile(getMcServerDir(localId), packet.args)) : await executeLocalServerOperation(packet.channel, localId, operationArgs)
                if (packet.channel === "mc-server:read-properties" && !actor.permissions.properties && result) { result = { ...result }; delete result["rcon.password"] }
                await snapshot(connection, localId)
                socket.send(JSON.stringify({ type: "result", id: packet.id, clientId: packet.clientId, result }))
              })
            } catch (error) {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "result", id: packet.id, clientId: packet.clientId, error: { code: (error as any).code ?? "REMOTE", message: (error as Error).message } }))
            }
          }
        } else {
          if (packet.type === "presence" || packet.type === "pong" && connection.online !== packet.online) {
            connection.online = packet.online
            if (!packet.online) for (const [id, request] of connection.pending) { clearTimeout(request.timer); request.reject(new ShareError("OFFLINE", "REMOTE_OFFLINE")); connection.pending.delete(id) }
            notify(connection)
          }
          if (packet.type === "snapshot") {
            const previous = connection.snapshot
            connection.online = true; connection.snapshot = packet
            connection.access.info = { ...connection.access.info, ...packet.info }
            // Forward the complete host state on every snapshot. State includes
            // live fields (start time, pid, errors) that can change while the
            // status remains the same.
            if (!previous || JSON.stringify(previous.state) !== JSON.stringify(packet.state)) sendToRenderer("mc-server:state-change", { id: `remote:${access.id}`, state: packet.state })
            sendToRenderer("mc-server:remote-snapshot", { id: `remote:${access.id}`, logs: packet.logs })
            sendToRenderer("mc-server:metrics", { id: `remote:${access.id}`, metrics: packet.metrics })
            if (packet.install?.progress) sendToRenderer("mc-server:download-progress", { id: `remote:${access.id}`, progress: packet.install.progress })
            else if (previous?.install?.progress) sendToRenderer("mc-server:download-progress", { id: `remote:${access.id}`, progress: { phase: "done", message: "", percent: 100 } })
            notify(connection)
          }
          if (packet.type === "result") {
            const request = pending.get(packet.id)
            if (request) { clearTimeout(request.timer); pending.delete(packet.id); packet.error ? request.reject(new ShareError(packet.error.code, packet.error.message)) : request.resolve(packet.result) }
          }
        }
      })().catch(error => logRuntime(`[Remote servers] ${error.message}`))
    })
    socket.addEventListener("error", () => { rejectReady(new ShareError("OFFLINE", "REMOTE_OFFLINE")) })
    socket.addEventListener("close", event => {
      clearTimeout(timeout); clearInterval(connection.timer); clearInterval(connection.heartbeat)
      if (localId && event.code === 4002) takenOver.add(access.id)
      rejectReady(new ShareError("OFFLINE", "REMOTE_OFFLINE"))
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new ShareError("OFFLINE", "REMOTE_OFFLINE")) }
      pending.clear(); connection.online = false
      if (connections.get(access.id) === connection) connections.delete(access.id)
      if (!localId) notify(connection)
      if (!shuttingDown && event.code !== 4002) setTimeout(() => {
        void (async () => {
          if (localId && !(await hosts()).some(host => host.remoteId === access.id) || !localId && !wantedClients.has(access.id)) return
          const current = await shareRequest(endpoint(access.id)) as RemoteServerAccess
          await connect(current, localId)
        })().catch(() => {})
      }, 3000)
    })
    await ready
    return connection
  })()
  connecting.set(access.id, task)
  try { return await task } finally { connecting.delete(access.id) }
}
export async function listRemoteServers(): Promise<McServerInfo[]> {
  try {
    const configuration = await shareConfiguration()
    if (listUser !== configuration.userId) {
      for (const id of connections.keys()) closeConnection(id)
      listUser = configuration.userId; remoteList = []
    }
    const access = await shareRequest("/remote-servers") as RemoteServerAccess[]
    remoteList = access.filter(item => !item.isOwner).map(item => remoteInfo(item, connections.get(item.id)?.online))
  } catch { /* Недоступный сервис не скрывает локальные серверы. */ }
  return remoteList
}
async function invokeRemote(channel: string, remoteId: string, args: unknown[]): Promise<unknown> {
  const id = remoteId.slice("remote:".length)
  if (channel === "mc-server:delete") return manageRemoteServer({ action: "leave", serverId: remoteId })
  if (channel === "mc-server:metrics-unsubscribe") return
  const access = await shareRequest(endpoint(id)) as RemoteServerAccess
  wantedClients.add(id)
  const connection = await connect(access)
  connection.access = { ...access, info: connection.snapshot?.info ?? access.info }
  if (channel === "mc-server:metrics-subscribe") {
    if (connection.snapshot?.metrics) sendToRenderer("mc-server:metrics", { id: remoteId, metrics: connection.snapshot.metrics })
    return
  }
  assertRemoteServerOperation(access.permissions, channel, args)
  if (channel === "mc-server:get") return remoteInfo(connection.access, connection.online)
  if (channel === "mc-server:status") return connection.snapshot?.state ?? { status: "stopped" }
  if (channel === "mc-server:logs") return connection.snapshot?.logs ?? []
  if (channel === "mc-server:install-state") return connection.snapshot?.install ?? { installing: false, progress: null }
  if (!connection.online) throw new ShareError("OFFLINE", "REMOTE_OFFLINE")
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => { connection.pending.delete(requestId); reject(new ShareError("TIMEOUT", "REMOTE_TIMEOUT")) }, ["mc-server:start", "mc-server:history"].includes(channel) ? 10 * 60000 : 45000)
    connection.pending.set(requestId, { resolve, reject, timer })
    connection.socket.send(JSON.stringify({ type: "command", id: requestId, channel, args }))
  })
}
export async function manageRemoteServer(input: RemoteServerRequest): Promise<RemoteServerResponse> {
  if (input.action === "join") {
    const access = await shareRequest("/remote-servers/join", "POST", { code: input.code }) as RemoteServerAccess
    await listRemoteServers()
    return { access, server: remoteInfo(access) }
  }
  const savedHosts = await hosts()
  const host = savedHosts.find(value => value.serverId === input.serverId)
  const id = input.serverId.startsWith("remote:") ? input.serverId.slice(7) : host?.remoteId
  if (input.action === "enable") {
    if (id) return { access: await shareRequest(endpoint(id)), enabled: true }
    const info = await executeLocalServerOperation("mc-server:get", input.serverId)
    if (!info || info.trashedAt) throw new ShareError("BUILD", "Server not found")
    await deleteServerHistory(input.serverId)
    const access = await shareRequest("/remote-servers", "POST", { info }) as RemoteServerAccess
    const c = await shareConfiguration()
    await saveHosts([...savedHosts, { serverId: input.serverId, remoteId: access.id, userId: c.userId }])
    await connect(access, input.serverId)
    return { access, enabled: true }
  }
  if (!id) return { enabled: false }
  if (input.action === "access") return { access: await shareRequest(endpoint(id)), enabled: true }
  if (input.action === "disable") {
    try { await shareRequest(endpoint(id), "DELETE") }
    catch (error) { if (!(error instanceof ShareError) || error.code !== "REMOTE_DELETED") throw error }
    closeConnection(id)
    if (host) await deleteServerHistory(host.serverId)
    await saveHosts(savedHosts.filter(value => value.remoteId !== id))
    return { enabled: false }
  }
  if (input.action === "leave") {
    wantedClients.delete(id)
    await shareRequest(endpoint(id) + "/leave", "POST", {}); closeConnection(id)
    remoteList = remoteList.filter(value => value.id !== input.serverId)
    return { enabled: false }
  }
  if (input.action === "invite") return shareRequest(endpoint(id) + "/invites", "POST", { permissions: input.permissions })
  if (input.action === "member") return { access: await shareRequest(endpoint(id) + "/members/" + encodeURIComponent(input.memberId), "PATCH", { permissions: input.permissions }) }
  if (input.action === "removeMember") return { access: await shareRequest(endpoint(id) + "/members/" + encodeURIComponent(input.memberId), "DELETE") }
  if (input.action === "revokeInvite") return { access: await shareRequest(endpoint(id) + "/invites/" + encodeURIComponent(input.inviteId), "DELETE") }
  throw new Error("Unsupported remote server action")
}
export function registerRemoteServerHandlers(): void {
  configureRemoteServerProxy(invokeRemote, listRemoteServers)
  rpcRegistry.handle("mc-server:remote", (_event, request: RemoteServerRequest) => manageRemoteServer(request))
  app.on("before-quit", () => { shuttingDown = true; for (const id of connections.keys()) closeConnection(id) })
}
export async function startRemoteServerHosts(): Promise<void> {
  if (starting || shuttingDown) return
  starting = true
  try {
    const saved = await hosts()
    if (!saved.length && !wantedClients.size) return
    const configuration = await shareConfiguration()
    for (const host of saved) {
      if (host.userId !== configuration.userId) { closeConnection(host.remoteId); continue }
      if (takenOver.has(host.remoteId)) continue
      try {
        const row = await dbHelpers.getMcServer(host.serverId)
        if (!row || row.trashedAt) { closeConnection(host.remoteId); continue }
        if (connections.has(host.remoteId)) continue
        if (row && !row.trashedAt) await connect(await shareRequest(endpoint(host.remoteId)), host.serverId)
      } catch (error) { logRuntime(`[Remote servers] Host unavailable: ${(error as Error).message}`) }
    }
    for (const id of wantedClients) if (!connections.has(id)) {
      try { await connect(await shareRequest(endpoint(id))) }
      catch (error) { if (error instanceof ShareError && ["FORBIDDEN", "REMOTE_DELETED"].includes(error.code)) { wantedClients.delete(id); remoteList = remoteList.filter(server => server.remote?.id !== id) } }
    }
  } catch (error) { logRuntime(`[Remote servers] ${(error as Error).message}`) }
  finally { starting = false }
}
