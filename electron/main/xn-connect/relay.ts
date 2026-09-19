import net from "net"
import dgram from "dgram"
import type { Tunnel, Node } from "./api"

// ── Protocol constants (must match backend/internal/relay/protocol.go) ──
// Header layout (15 bytes):
//   [0..3]  payload size, uint32 LE
//   [4]     frame type
//   [5..14] first 10 bytes of the session id
const FRAME_HEADER_SIZE = 15
const FRAME_TUNNEL_ID_SIZE = 10
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024

const F_HANDSHAKE = 0x01
const F_HANDSHAKE_RESP = 0x02
const F_TCP = 0x03
const F_UDP = 0x04
const F_PING = 0x08

// ── Timings ──────────────────────────────────────────────
// IMPORTANT: the relay socket must never carry a Node idle timeout.
// `net.createConnection({ timeout })` arms socket.setTimeout(), which stays
// armed for the whole session and emits "timeout" after N ms without socket
// activity. With timeout === ping interval (both 10s) the idle timer always
// wins the race by ~1ms and the old handler destroyed the socket — the tunnel
// flapped roughly every 10 seconds. Dead-peer detection is explicit below.
const CONNECT_TIMEOUT_MS = 15000
const HANDSHAKE_TIMEOUT_MS = 15000
const PING_INTERVAL_MS = 10000
const IDLE_TIMEOUT_MS = 45000
const IDLE_CHECK_MS = 5000
const RECONNECT_DELAY_MS = 1000
const MAX_SOCKET_BUFFER = 16 * 1024 * 1024
const MAX_DIAL_QUEUE_BYTES = 4 * 1024 * 1024

const EMPTY = Buffer.alloc(0)

// ── Frame encoding ───────────────────────────────────────

// Encodes header + payload into a single buffer so a frame always hits the
// socket as one write (no chance of two frames interleaving on the wire).
function encodeFrame(type: number, payload: Buffer, sid: string): Buffer {
  const frame = Buffer.allocUnsafe(FRAME_HEADER_SIZE + payload.length)
  frame.writeUInt32LE(payload.length, 0)
  frame[4] = type
  Buffer.from(sid, "utf-8").copy(frame, 5, 0, FRAME_TUNNEL_ID_SIZE)
  if (payload.length > 0) payload.copy(frame, FRAME_HEADER_SIZE)
  return frame
}

function writeFrame(sock: net.Socket | null, type: number, payload: Buffer, sid: string): boolean {
  if (!sock || sock.destroyed || !sock.writable) return false
  try {
    sock.write(encodeFrame(type, payload, sid))
    return true
  } catch {
    return false
  }
}

function frameTunnelKey(sid: string): Buffer {
  const key = Buffer.alloc(FRAME_TUNNEL_ID_SIZE)
  Buffer.from(sid, "utf-8").copy(key, 0, 0, FRAME_TUNNEL_ID_SIZE)
  return key
}

// ── Handshake ────────────────────────────────────────────

function readHandshake(conn: net.Socket, timeoutMs: number): Promise<{ sid: string; ok: boolean }> {
  return new Promise((resolve) => {
    let phase: "header" | "payload" = "header"
    let totalRead = 0
    let settled = false
    const hdr = Buffer.alloc(FRAME_HEADER_SIZE)
    let payloadSize = 0
    let payload: Buffer | null = null
    let payloadRead = 0

    const finish = (sid: string, ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      conn.removeListener("data", onData)
      conn.removeListener("close", onClose)
      conn.removeListener("error", onError)
      resolve({ sid, ok })
    }

    // Without this a relay that accepts the TCP connection but never answers
    // leaves the tunnel stuck in "starting" forever (no retry, no stop).
    const timer = setTimeout(() => finish("", false), timeoutMs)

    const onData = (chunk: Buffer) => {
      let offset = 0
      while (offset < chunk.length) {
        if (phase === "header") {
          const toCopy = Math.min(chunk.length - offset, FRAME_HEADER_SIZE - totalRead)
          chunk.copy(hdr, totalRead, offset, offset + toCopy)
          totalRead += toCopy
          offset += toCopy
          if (totalRead === FRAME_HEADER_SIZE) {
            if (hdr[4] !== F_HANDSHAKE_RESP) {
              finish("", false)
              return
            }
            payloadSize = hdr.readUInt32LE(0)
            if (payloadSize === 0 || payloadSize >= 1024) {
              finish("", true)
              return
            }
            payload = Buffer.alloc(payloadSize)
            payloadRead = 0
            phase = "payload"
          }
        } else if (payload) {
          const toCopy = Math.min(chunk.length - offset, payloadSize - payloadRead)
          chunk.copy(payload, payloadRead, offset, offset + toCopy)
          payloadRead += toCopy
          offset += toCopy
          if (payloadRead === payloadSize) {
            finish(payload.toString("utf-8"), true)
            return
          }
        }
      }
    }

    const onClose = () => finish("", false)
    const onError = () => finish("", false)

    conn.on("data", onData)
    conn.once("close", onClose)
    conn.once("error", onError)
  })
}

// ── Relay state ──────────────────────────────────────────

type TcpEntry = {
  socket: net.Socket | null
  queue: Buffer[]
  queuedBytes: number
}

type RelayState = {
  tunnel: Tunnel
  node: Node
  conn: net.Socket | null
  closed: boolean
  healthy: boolean
  sessionID: string
  sessionIDKey: Buffer
  // Per-session connection maps. They MUST NOT be shared between relay
  // sessions: the relay server numbers connection ids per session starting
  // from 1, so a shared map makes a new session write player data into a
  // local socket left over from the previous session (or from another node).
  tcpConns: Map<number, TcpEntry>
  udpConns: Map<number, dgram.Socket>
  udpAddrs: Map<number, Buffer>
  lastReadAt: number
  // Incremented on every new relay session; stale callbacks from an old
  // session compare it and bail out.
  gen: number
}

type MultiRelayManager = {
  tunnel: Tunnel
  states: RelayState[]
  stop: boolean
  waiters: Set<() => void>
  reportedRunning: boolean
  callbacks: RelayCallbacks
}

function nextBackoff(b: number): number {
  b *= 2
  if (b > 60000) return 60000
  return b
}

function waitOrStop(mgr: MultiRelayManager, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (mgr.stop) return resolve(true)
    let done = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (stopped: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      mgr.waiters.delete(waiter)
      resolve(stopped)
    }
    const waiter = () => finish(true)
    timer = setTimeout(() => finish(false), ms)
    mgr.waiters.add(waiter)
  })
}

// ── Dial ─────────────────────────────────────────────────

function dialRelay(node: Node): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    let settled = false
    const sock = net.createConnection({ host: node.host, port: node.port })
    // Deliberately no `timeout` option here: see the note on CONNECT_TIMEOUT_MS.
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.removeListener("connect", onConnect)
      sock.removeListener("error", onError)
      resolve(ok ? sock : null)
    }
    const onConnect = () => finish(true)
    const onError = () => { sock.destroy(); finish(false) }
    const timer = setTimeout(() => { sock.destroy(); finish(false) }, CONNECT_TIMEOUT_MS)

    sock.once("connect", onConnect)
    sock.once("error", onError)
  })
}

// ── Run relay for a single node ──────────────────────────

async function runRelay(
  mgr: MultiRelayManager,
  state: RelayState,
  onLog: (line: string) => void,
): Promise<void> {
  let backoff = 1000

  while (!mgr.stop) {
    const addr = `${state.node.host}:${state.node.port}`
    onLog(`Connecting to relay ${addr}...`)

    const conn = await dialRelay(state.node)
    if (!conn) {
      if (mgr.stop) return
      onLog(`Relay unreachable: ${addr}`)
      if (await waitOrStop(mgr, backoff)) return
      backoff = nextBackoff(backoff)
      continue
    }
    if (mgr.stop) { conn.destroy(); return }

    conn.setNoDelay(true)
    conn.setKeepAlive(true, 30000)
    // Guard against any inherited idle timer — this socket lives for hours.
    conn.setTimeout(0)

    if (!writeFrame(conn, F_HANDSHAKE, Buffer.from(mgr.tunnel.access_token, "utf-8"), mgr.tunnel.id)) {
      conn.destroy()
      if (await waitOrStop(mgr, backoff)) return
      backoff = nextBackoff(backoff)
      continue
    }

    const hs = await readHandshake(conn, HANDSHAKE_TIMEOUT_MS)
    if (mgr.stop) { conn.destroy(); return }
    if (!hs.ok) {
      onLog(`Relay handshake failed: ${addr}`)
      conn.destroy()
      if (await waitOrStop(mgr, backoff)) return
      backoff = nextBackoff(backoff)
      continue
    }

    state.sessionID = hs.sid
    state.sessionIDKey = frameTunnelKey(hs.sid)
    backoff = 1000
    onLog(`Relay connected: ${addr} session=${hs.sid}`)

    // Announce again after a reconnect — the first call already told the
    // manager, but a later successful reconnect is equally valid news.
    const firstReport = !mgr.reportedRunning
    mgr.reportedRunning = true
    if (!firstReport) mgr.callbacks.onStateChange("running")

    await handleRelay(mgr, state, conn, onLog)

    onLog(`Relay disconnected: ${addr}`)
    if (!mgr.stop) await waitOrStop(mgr, RECONNECT_DELAY_MS)
  }
}

// ── Handle relay session ─────────────────────────────────

async function handleRelay(
  mgr: MultiRelayManager,
  state: RelayState,
  conn: net.Socket,
  onLog: (line: string) => void,
): Promise<void> {
  const gen = ++state.gen
  state.closed = false
  state.conn = conn
  state.healthy = true
  state.lastReadAt = Date.now()

  const pingTimer = setInterval(() => {
    if (state.closed || state.gen !== gen) return
    if (!writeFrame(conn, F_PING, EMPTY, state.sessionID)) conn.destroy()
  }, PING_INTERVAL_MS)

  // Dead-peer detection with an explicit timer instead of socket.setTimeout,
  // which would fire even while the link is perfectly healthy.
  const idleTimer = setInterval(() => {
    if (state.closed || state.gen !== gen) return
    if (Date.now() - state.lastReadAt > IDLE_TIMEOUT_MS) {
      onLog("Relay idle timeout, reconnecting...")
      conn.destroy()
    }
  }, IDLE_CHECK_MS)

  try {
    await readLoop(mgr, state, conn, onLog, gen)
  } finally {
    clearInterval(pingTimer)
    clearInterval(idleTimer)
    state.closed = true
    state.healthy = false
    state.conn = null
    // The relay server is gone, so every remote connection it multiplexed is
    // gone too — and the next session restarts connection ids from 1. Closing
    // the local sockets here both lets the Minecraft server see the players
    // disconnect and prevents cid collisions with the next session.
    closeLocalConns(state)
    conn.destroy()
  }
}

function closeLocalConns(state: RelayState): void {
  for (const [, entry] of state.tcpConns) {
    entry.queue.length = 0
    try { entry.socket?.destroy() } catch {}
  }
  state.tcpConns.clear()
  for (const [, sock] of state.udpConns) {
    try { sock.close() } catch {}
  }
  state.udpConns.clear()
  state.udpAddrs.clear()
}

// ── Read loop ────────────────────────────────────────────

function readLoop(
  mgr: MultiRelayManager,
  state: RelayState,
  conn: net.Socket,
  onLog: (line: string) => void,
  gen: number,
): Promise<void> {
  return new Promise((resolve) => {
    const hdr = Buffer.alloc(FRAME_HEADER_SIZE)
    let hdrOffset = 0
    let payloadSize = 0
    let payloadBuf: Buffer | null = null
    let payloadOffset = 0
    let finished = false

    const localAddr = {
      host: mgr.tunnel.local_ip || "127.0.0.1",
      port: mgr.tunnel.local_port,
    }

    const finish = () => {
      if (finished) return
      finished = true
      conn.removeListener("data", onData)
      conn.removeListener("close", finish)
      conn.removeListener("error", finish)
      resolve()
    }

    const onData = (chunk: Buffer) => {
      if (state.gen !== gen) return
      state.lastReadAt = Date.now()
      let offset = 0
      while (offset < chunk.length) {
        if (hdrOffset < FRAME_HEADER_SIZE) {
          const toCopy = Math.min(chunk.length - offset, FRAME_HEADER_SIZE - hdrOffset)
          chunk.copy(hdr, hdrOffset, offset, offset + toCopy)
          hdrOffset += toCopy
          offset += toCopy
          if (hdrOffset === FRAME_HEADER_SIZE) {
            payloadSize = hdr.readUInt32LE(0)
            if (payloadSize > MAX_PAYLOAD_SIZE) {
              onLog(`Relay frame too large: ${payloadSize}`)
              conn.destroy()
              finish()
              return
            }
            if (payloadSize === 0) {
              processFrame(state, hdr, EMPTY, localAddr, onLog)
              hdrOffset = 0
              continue
            }
            payloadBuf = Buffer.alloc(payloadSize)
            payloadOffset = 0
          }
          continue
        }

        if (payloadBuf) {
          const toCopy = Math.min(chunk.length - offset, payloadSize - payloadOffset)
          chunk.copy(payloadBuf, payloadOffset, offset, offset + toCopy)
          payloadOffset += toCopy
          offset += toCopy
          if (payloadOffset === payloadSize) {
            processFrame(state, hdr, payloadBuf, localAddr, onLog)
            hdrOffset = 0
            payloadBuf = null
            payloadOffset = 0
          }
        }
      }
    }

    conn.on("data", onData)
    conn.once("close", finish)
    conn.once("error", finish)
  })
}

// ── Process a single frame ───────────────────────────────

function processFrame(
  state: RelayState,
  hdr: Buffer,
  payload: Buffer,
  localAddr: { host: string; port: number },
  onLog: (line: string) => void,
): void {
  // Ignore frames that belong to a different session id.
  if (!hdr.subarray(5, 5 + FRAME_TUNNEL_ID_SIZE).equals(state.sessionIDKey)) return

  switch (hdr[4]) {
    case F_TCP:
      handleTCP(state, payload, localAddr, onLog)
      break
    case F_UDP:
      handleUDP(state, payload, localAddr, onLog)
      break
  }
}

// ── Sending to the relay ─────────────────────────────────

function sendToRelay(state: RelayState, type: number, payload: Buffer): void {
  if (state.closed || !state.healthy) return
  const conn = state.conn
  if (!conn || conn.destroyed) return
  // Backpressure guard: Node buffers writes in memory, so a relay that stops
  // draining must not grow the process without bound.
  if (conn.writableLength > MAX_SOCKET_BUFFER) {
    conn.destroy()
    return
  }
  if (!writeFrame(conn, type, payload, state.sessionID)) conn.destroy()
}

// ── TCP handling ─────────────────────────────────────────

function handleTCP(
  state: RelayState,
  payload: Buffer,
  localAddr: { host: string; port: number },
  onLog: (line: string) => void,
): void {
  if (payload.length < 4) return
  const cid = payload.readUInt32LE(0)
  const data = payload.subarray(4)

  const entry = state.tcpConns.get(cid)
  if (entry) {
    // The dial may still be in flight (Node dials asynchronously, the read
    // loop does not wait). Buffering here is what keeps a single player
    // connection from being dialled twice in parallel.
    if (entry.socket) {
      if (data.length > 0) writeLocal(entry.socket, data, onLog)
    } else if (data.length > 0) {
      entry.queue.push(Buffer.from(data))
      entry.queuedBytes += data.length
      if (entry.queuedBytes > MAX_DIAL_QUEUE_BYTES) {
        state.tcpConns.delete(cid)
        onLog(`TCP queue overflow for ${localAddr.host}:${localAddr.port}`)
      }
    }
    return
  }

  // Register a placeholder BEFORE dialling so concurrent frames for the same
  // cid are queued instead of opening a second local connection.
  const created: TcpEntry = { socket: null, queue: [], queuedBytes: 0 }
  if (data.length > 0) {
    created.queue.push(Buffer.from(data))
    created.queuedBytes = data.length
  }
  state.tcpConns.set(cid, created)

  const localSocket = net.createConnection(localAddr, () => {
    if (state.closed || state.tcpConns.get(cid) !== created) {
      localSocket.destroy()
      return
    }
    created.socket = localSocket
    for (const chunk of created.queue) writeLocal(localSocket, chunk, onLog)
    created.queue.length = 0
    created.queuedBytes = 0
  })

  localSocket.setNoDelay(true)

  localSocket.on("data", (d: Buffer) => {
    if (state.closed || !state.healthy || state.tcpConns.get(cid) !== created) return
    const p = Buffer.allocUnsafe(4 + d.length)
    p.writeUInt32LE(cid, 0)
    d.copy(p, 4)
    sendToRelay(state, F_TCP, p)
  })

  localSocket.on("close", () => {
    if (state.tcpConns.get(cid) === created) state.tcpConns.delete(cid)
  })

  localSocket.on("error", (err: NodeJS.ErrnoException) => {
    if (state.tcpConns.get(cid) === created) state.tcpConns.delete(cid)
    if (!state.closed) onLog(`TCP ${localAddr.host}:${localAddr.port}: ${err.code ?? err.message}`)
    localSocket.destroy()
  })
}

function writeLocal(sock: net.Socket, data: Buffer, onLog: (line: string) => void): void {
  if (sock.destroyed || !sock.writable) return
  try {
    sock.write(data)
  } catch (err: any) {
    onLog(`TCP write failed: ${err?.message ?? err}`)
  }
}

// ── UDP handling ─────────────────────────────────────────

function handleUDP(
  state: RelayState,
  payload: Buffer,
  localAddr: { host: string; port: number },
  onLog: (line: string) => void,
): void {
  if (payload.length < 10) return
  const cid = payload.readUInt32LE(0)
  const data = payload.subarray(10)

  const existing = state.udpConns.get(cid)
  if (existing) {
    if (data.length > 0) {
      try { existing.send(data, localAddr.port, localAddr.host) } catch {}
    }
    return
  }

  const addrBytes = Buffer.from(payload.subarray(4, 10))

  const localSocket = dgram.createSocket("udp4")
  try {
    localSocket.connect(localAddr.port, localAddr.host)
  } catch (err: any) {
    onLog(`UDP dial error ${localAddr.host}:${localAddr.port}: ${err?.message ?? err}`)
    try { localSocket.close() } catch {}
    return
  }

  state.udpConns.set(cid, localSocket)
  state.udpAddrs.set(cid, addrBytes)

  localSocket.on("message", (d: Buffer) => {
    if (state.closed || !state.healthy || state.udpConns.get(cid) !== localSocket) return
    const p = Buffer.allocUnsafe(10 + d.length)
    p.writeUInt32LE(cid, 0)
    addrBytes.copy(p, 4)
    d.copy(p, 10)
    sendToRelay(state, F_UDP, p)
  })

  localSocket.on("close", () => {
    if (state.udpConns.get(cid) === localSocket) {
      state.udpConns.delete(cid)
      state.udpAddrs.delete(cid)
    }
  })

  localSocket.on("error", (err: any) => {
    if (state.udpConns.get(cid) === localSocket) {
      state.udpConns.delete(cid)
      state.udpAddrs.delete(cid)
    }
    if (!state.closed) onLog(`UDP ${localAddr.host}:${localAddr.port}: ${err?.message ?? err}`)
    try { localSocket.close() } catch {}
  })

  if (data.length > 0) {
    try { localSocket.send(data, localAddr.port, localAddr.host) } catch {}
  }
}

// ── Manager ──────────────────────────────────────────────

function mgrShutdown(mgr: MultiRelayManager): void {
  for (const s of mgr.states) {
    s.closed = true
    s.healthy = false
    s.gen++
    if (s.conn) s.conn.destroy()
    closeLocalConns(s)
  }
}

// ── Public API ───────────────────────────────────────────

export type RelayCallbacks = {
  onLog: (line: string) => void
  onStateChange: (state: string) => void
}

export async function runTunnel(
  tunnel: Tunnel,
  callbacks: RelayCallbacks,
): Promise<{ stop: () => void }> {
  const mgr: MultiRelayManager = {
    tunnel,
    states: [],
    stop: false,
    waiters: new Set(),
    reportedRunning: false,
    callbacks,
  }

  const nodes = tunnel.nodes.length > 0
    ? tunnel.nodes
    : [{ id: "fallback", name: "Fallback", host: tunnel.public_host, port: 5000, public_host: tunnel.public_host, status: "online", location: "", flag: "" }]

  for (const node of nodes) {
    if (node.status !== "online") continue
    if (!node.host || !node.port) continue
    const state: RelayState = {
      tunnel,
      node,
      conn: null,
      closed: false,
      healthy: false,
      sessionID: "",
      sessionIDKey: Buffer.alloc(FRAME_TUNNEL_ID_SIZE),
      tcpConns: new Map(),
      udpConns: new Map(),
      udpAddrs: new Map(),
      lastReadAt: Date.now(),
      gen: 0,
    }
    mgr.states.push(state)
    runRelay(mgr, state, callbacks.onLog).catch(() => {})
  }

  if (mgr.states.length === 0) {
    callbacks.onLog("No online relay nodes found")
    callbacks.onStateChange("stopped")
    return { stop: () => {} }
  }

  const stop = () => {
    if (mgr.stop) return
    mgr.stop = true
    for (const waiter of [...mgr.waiters]) waiter()
    mgr.waiters.clear()
    mgrShutdown(mgr)
  }

  // Wait briefly for the first node to come up before reporting "running".
  const deadline = Date.now() + 2000
  while (!mgr.stop && !mgr.states.some(s => s.healthy) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100))
  }

  if (!mgr.stop && !mgr.reportedRunning && mgr.states.some(s => s.healthy)) {
    mgr.reportedRunning = true
    callbacks.onStateChange("running")
  }

  return { stop }
}
