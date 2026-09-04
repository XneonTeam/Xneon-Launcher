import net from "net"
import dgram from "dgram"
import type { Tunnel, Node } from "./api"

// ── Protocol constants ───────────────────────────────────
const FRAME_HEADER_SIZE = 15
const FRAME_TUNNEL_ID_SIZE = 10
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024
const SEND_CHAN_SIZE = 2000

const F_HANDSHAKE = 0x01
const F_HANDSHAKE_RESP = 0x02
const F_TCP = 0x03
const F_UDP = 0x04
const F_PING = 0x08
const F_PONG = 0x09

// ── Protocol helpers ─────────────────────────────────────

function writeFrame(
  writer: net.Socket,
  type: number,
  payload: Buffer,
  sid: string,
): boolean {
  const hdr = Buffer.alloc(FRAME_HEADER_SIZE)
  hdr.writeUInt32LE(payload.length, 0)
  hdr[4] = type
  const sidBuf = Buffer.from(sid, "utf-8")
  sidBuf.copy(hdr, 5, 0, Math.min(sidBuf.length, FRAME_TUNNEL_ID_SIZE))
  try {
    writer.write(hdr)
    if (payload.length > 0) writer.write(payload)
    return true
  } catch {
    return false
  }
}

function readHandshake(conn: net.Socket): Promise<{ sid: string; ok: boolean }> {
  return new Promise((resolve) => {
    let phase: "header" | "payload" = "header"
    let totalRead = 0
    const hdr = Buffer.alloc(FRAME_HEADER_SIZE)
    let payloadSize = 0
    let payload: Buffer | null = null
    let payloadRead = 0

    const cleanup = () => {
      conn.removeListener("data", onData)
      conn.removeListener("close", onClose)
      conn.removeListener("error", onError)
    }

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
              cleanup()
              resolve({ sid: "", ok: false })
              return
            }
            payloadSize = hdr.readUInt32LE(0)
            if (payloadSize === 0 || payloadSize >= 1024) {
              cleanup()
              resolve({ sid: "", ok: true })
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
            cleanup()
            resolve({ sid: payload.toString("utf-8"), ok: true })
            return
          }
        }
      }
    }

    const onClose = () => { cleanup(); resolve({ sid: "", ok: false }) }
    const onError = () => { cleanup(); resolve({ sid: "", ok: false }) }

    conn.on("data", onData)
    conn.once("close", onClose)
    conn.once("error", onError)
  })
}

// ── Relay state ──────────────────────────────────────────

type RelayState = {
  tunnel: Tunnel
  node: Node
  conn: net.Socket | null
  writer: net.Socket | null
  sendChan: { type: number; payload: Buffer }[]
  closed: boolean
  healthy: boolean
  sessionID: string
  sessionIDKey: Buffer
}

// ── Multi-relay manager ──────────────────────────────────

type MultiRelayManager = {
  tunnel: Tunnel
  states: RelayState[]
  stop: boolean
  tcpConns: Map<number, net.Socket>
  udpConns: Map<number, dgram.Socket>
}

function nextBackoff(b: number): number {
  b *= 2
  if (b > 60000) return 60000
  return b
}

function waitOrStop(stop: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    const check = () => {
      if (stop()) {
        clearTimeout(timer)
        resolve(true)
      } else {
        setTimeout(check, 100)
      }
    }
    check()
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

    const conn = await new Promise<net.Socket | null>((resolve) => {
      const s = net.createConnection({ host: state.node.host, port: state.node.port, timeout: 10000 }, () => resolve(s))
      s.on("error", () => { s.destroy(); resolve(null) })
      s.on("timeout", () => { s.destroy(); resolve(null) })
    })

    if (!conn || mgr.stop) {
      if (conn) conn.destroy()
      if (await waitOrStop(() => mgr.stop, backoff)) return
      backoff = nextBackoff(backoff)
      continue
    }

    // Set TCP options
    conn.setNoDelay(true)
    conn.setKeepAlive(true, 30000)

    // Send handshake
    const accessTokenBuf = Buffer.from(mgr.tunnel.access_token, "utf-8")
    const tunnelIdBuf = Buffer.from(mgr.tunnel.id, "utf-8")
    const sidHdr = Buffer.alloc(FRAME_HEADER_SIZE)
    sidHdr.writeUInt32LE(accessTokenBuf.length, 0)
    sidHdr[4] = F_HANDSHAKE
    tunnelIdBuf.copy(sidHdr, 5, 0, Math.min(tunnelIdBuf.length, FRAME_TUNNEL_ID_SIZE))

    try {
      conn.write(sidHdr)
      conn.write(accessTokenBuf)
    } catch {
      conn.destroy()
      if (await waitOrStop(() => mgr.stop, backoff)) return
      backoff = nextBackoff(backoff)
      continue
    }

    // Read handshake response
    const hs = await readHandshake(conn)
    if (!hs.ok || mgr.stop) {
      conn.destroy()
      if (await waitOrStop(() => mgr.stop, backoff)) return
      backoff = nextBackoff(backoff)
      continue
    }

    state.sessionID = hs.sid
    state.sessionIDKey = Buffer.alloc(FRAME_TUNNEL_ID_SIZE)
    Buffer.from(hs.sid, "utf-8").copy(state.sessionIDKey, 0, 0, Math.min(hs.sid.length, FRAME_TUNNEL_ID_SIZE))
    backoff = 1000
    state.healthy = true
    onLog(`Relay connected: ${addr} session=${hs.sid}`)

    // Handle relay session
    await handleRelay(mgr, state, conn, onLog)

    onLog(`Relay disconnected: ${addr}`)
    conn.destroy()
    state.healthy = false

    if (!mgr.stop) await new Promise(r => setTimeout(r, 1000))
  }
}

// ── Handle relay session ─────────────────────────────────

async function handleRelay(
  mgr: MultiRelayManager,
  state: RelayState,
  conn: net.Socket,
  onLog: (line: string) => void,
): Promise<void> {
  state.closed = false
  state.conn = conn
  state.writer = conn
  state.sendChan = []

  // Detect idle connections — if no data in/out for 60s, destroy
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const refreshIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!state.closed) {
        onLog(`Relay idle timeout, reconnecting...`)
        conn.destroy()
      }
    }, 60000)
  }
  refreshIdle()

  // Writer goroutine equivalent — ping + send channel
  const writerDone = new Promise<void>((resolve) => {
    let pingInterval: ReturnType<typeof setInterval> | null = null
    let sendCheck: ReturnType<typeof setInterval> | null = null

    const cleanup = () => {
      if (pingInterval) clearInterval(pingInterval)
      if (sendCheck) clearInterval(sendCheck)
      if (idleTimer) clearTimeout(idleTimer)
      resolve()
    }

    pingInterval = setInterval(() => {
      if (state.closed) { cleanup(); return }
      if (!writeFrame(conn, F_PING, Buffer.alloc(0), state.sessionID)) {
        cleanup()
        return
      }
      refreshIdle()
    }, 10000)

    sendCheck = setInterval(() => {
      if (state.closed || state.sendChan.length === 0) return
      while (state.sendChan.length > 0) {
        const frame = state.sendChan.shift()!
        if (!writeFrame(conn, frame.type, frame.payload, state.sessionID)) {
          cleanup()
          return
        }
      }
    }, 5)
  })

  // Read loop
  const readDone = readLoop(mgr, state, conn, onLog, () => {}, refreshIdle)

  // Wait for any to finish
  await Promise.race([writerDone, readDone])

  if (idleTimer) clearTimeout(idleTimer)
  state.closed = true
  state.sendChan = []
}

// ── Read loop ────────────────────────────────────────────

function readLoop(
  mgr: MultiRelayManager,
  state: RelayState,
  conn: net.Socket,
  onLog: (line: string) => void,
  onError: (err: Error) => void,
  onActivity?: () => void,
): Promise<void> {
  return new Promise((resolve) => {
    const hdr = Buffer.alloc(FRAME_HEADER_SIZE)
    let hdrOffset = 0
    let payloadSize = 0
    let payloadBuf: Buffer | null = null
    let payloadOffset = 0

    const addr = mgr.tunnel.local_ip || "127.0.0.1"
    const localAddr = { host: addr, port: mgr.tunnel.local_port }

    const cleanup = () => {
      conn.removeListener("data", onData)
      conn.removeListener("close", onClose)
      conn.removeListener("error", onErrorHandler)
      resolve()
    }

    const onClose = () => cleanup()
    const onErrorHandler = (err: Error) => { onError(err); cleanup() }

    const onData = (chunk: Buffer) => {
      if (onActivity) onActivity()
      let offset = 0
      while (offset < chunk.length) {
        // Reading header
        if (hdrOffset < FRAME_HEADER_SIZE) {
          const toCopy = Math.min(chunk.length - offset, FRAME_HEADER_SIZE - hdrOffset)
          chunk.copy(hdr, hdrOffset, offset, offset + toCopy)
          hdrOffset += toCopy
          offset += toCopy
          if (hdrOffset === FRAME_HEADER_SIZE) {
            payloadSize = hdr.readUInt32LE(0)
            if (payloadSize > MAX_PAYLOAD_SIZE) {
              onError(new Error(`payload too large: ${payloadSize}`))
              cleanup()
              return
            }
            if (payloadSize === 0) {
              processFrame(mgr, state, hdr, Buffer.alloc(0), localAddr, onLog)
              hdrOffset = 0
              continue
            }
            payloadBuf = Buffer.alloc(payloadSize)
            payloadOffset = 0
          }
          continue
        }

        // Reading payload
        if (payloadBuf) {
          const toCopy = Math.min(chunk.length - offset, payloadSize - payloadOffset)
          chunk.copy(payloadBuf, payloadOffset, offset, offset + toCopy)
          payloadOffset += toCopy
          offset += toCopy
          if (payloadOffset === payloadSize) {
            processFrame(mgr, state, hdr, payloadBuf, localAddr, onLog)
            hdrOffset = 0
            payloadBuf = null
            payloadOffset = 0
          }
        }
      }
    }

    conn.on("data", onData)
    conn.once("close", onClose)
    conn.once("error", onErrorHandler)
  })
}

// ── Process a single frame ───────────────────────────────

function processFrame(
  mgr: MultiRelayManager,
  state: RelayState,
  hdr: Buffer,
  payload: Buffer,
  localAddr: { host: string; port: number },
  onLog: (line: string) => void,
): void {
  // Verify tunnel ID
  const frameTunnelID = hdr.subarray(5, 5 + FRAME_TUNNEL_ID_SIZE)
  if (!frameTunnelID.equals(state.sessionIDKey)) return

  switch (hdr[4]) {
    case F_TCP:
      handleTCP(mgr, state, payload, localAddr, onLog)
      break
    case F_UDP:
      handleUDP(mgr, state, payload, localAddr, onLog)
      break
  }
}

// ── TCP handling ─────────────────────────────────────────

function handleTCP(
  mgr: MultiRelayManager,
  state: RelayState,
  payload: Buffer,
  localAddr: { host: string; port: number },
  onLog: (line: string) => void,
): void {
  if (payload.length < 5) return
  const cid = payload.readUInt32LE(0)

  const existing = mgr.tcpConns.get(cid)
  if (existing) {
    try {
      existing.write(payload.subarray(4))
    } catch {}
    return
  }

  // New connection — dial local server
  const localSocket = net.createConnection(localAddr, () => {
    mgr.tcpConns.set(cid, localSocket)

    localSocket.on("data", (d: Buffer) => {
      if (state.closed || !state.healthy) return
      const p = Buffer.alloc(4 + d.length)
      p.writeUInt32LE(cid, 0)
      d.copy(p, 4)
      mgrSend(mgr, state, F_TCP, p)
    })

    localSocket.on("close", () => {
      mgr.tcpConns.delete(cid)
      // Send close signal
      const p = Buffer.alloc(4)
      p.writeUInt32LE(cid, 0)
      mgrSend(mgr, state, F_TCP, p)
    })

    localSocket.on("error", () => {
      mgr.tcpConns.delete(cid)
    })

    // Forward initial data
    localSocket.write(payload.subarray(4))
  })

  localSocket.on("error", (err) => {
    onLog(`TCP dial error ${localAddr.host}:${localAddr.port}: ${err.message}`)
    localSocket.destroy()
  })
}

// ── UDP handling ─────────────────────────────────────────

function handleUDP(
  mgr: MultiRelayManager,
  state: RelayState,
  payload: Buffer,
  localAddr: { host: string; port: number },
  onLog: (line: string) => void,
): void {
  if (payload.length < 11) return
  const cid = payload.readUInt32LE(0)

  const existing = mgr.udpConns.get(cid)
  if (existing) {
    try {
      existing.send(payload.subarray(10), localAddr.port, localAddr.host)
    } catch {}
    return
  }

  const addrBytes = payload.subarray(4, 10)

  const localSocket = dgram.createSocket("udp4")
  try {
    localSocket.connect(localAddr.port, localAddr.host)
    mgr.udpConns.set(cid, localSocket)

    localSocket.on("message", (d: Buffer) => {
      if (state.closed || !state.healthy) return
      const p = Buffer.alloc(10 + d.length)
      p.writeUInt32LE(cid, 0)
      addrBytes.copy(p, 4)
      d.copy(p, 10)
      mgrSend(mgr, state, F_UDP, p)
    })

    localSocket.on("close", () => {
      mgr.udpConns.delete(cid)
    })

    localSocket.on("error", () => {
      mgr.udpConns.delete(cid)
    })

    localSocket.send(payload.subarray(10), localAddr.port, localAddr.host)
  } catch (err: any) {
    onLog(`UDP dial error ${localAddr.host}:${localAddr.port}: ${err.message}`)
  }
}

// ── Multi-relay manager ──────────────────────────────────

function mgrSend(mgr: MultiRelayManager, state: RelayState, type: number, payload: Buffer): void {
  if (!state || state.closed || !state.healthy) return
  if (state.sendChan.length >= SEND_CHAN_SIZE) return
  state.sendChan.push({ type, payload })
}

function mgrShutdown(mgr: MultiRelayManager): void {
  for (const s of mgr.states) {
    if (s.conn) s.conn.destroy()
    s.closed = true
  }
  for (const [, c] of mgr.tcpConns) { try { c.destroy() } catch {} }
  for (const [, c] of mgr.udpConns) { try { c.close() } catch {} }
  mgr.tcpConns.clear()
  mgr.udpConns.clear()
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
    tcpConns: new Map(),
    udpConns: new Map(),
  }

  const nodes = tunnel.nodes.length > 0
    ? tunnel.nodes
    : [{ id: "fallback", name: "Fallback", host: tunnel.public_host, port: 5000, public_host: tunnel.public_host, status: "online", location: "", flag: "" }]

  for (const node of nodes) {
    if (node.status !== "online") continue
    const state: RelayState = {
      tunnel,
      node,
      conn: null,
      writer: null,
      sendChan: [],
      closed: false,
      healthy: false,
      sessionID: "",
      sessionIDKey: Buffer.alloc(FRAME_TUNNEL_ID_SIZE),
    }
    mgr.states.push(state)
    runRelay(mgr, state, callbacks.onLog).catch(() => {})
  }

  if (mgr.states.length === 0) {
    callbacks.onLog("No online relay nodes found")
    callbacks.onStateChange("stopped")
    return { stop: () => {} }
  }

  // Wait for connection to establish
  await new Promise(r => setTimeout(r, 2000))

  const anyHealthy = mgr.states.some(s => s.healthy)
  if (anyHealthy) {
    callbacks.onStateChange("running")
  }

  const stop = () => {
    mgr.stop = true
    mgrShutdown(mgr)
  }

  return { stop }
}
