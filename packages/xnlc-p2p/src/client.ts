// P2P client — mirrors client/webrtc_client.py.
// Orchestrates signaling, PeerConnection, metadata/game DataChannels,
// LAN discovery, host bridge, and joiner TCP proxy.

import net from "net"
import { PeerConnection, type DataChannel } from "node-datachannel"
import { P2PLogger, type P2PLogCallback } from "./logger.js"
import { SignalingClient } from "./signaling.js"
import { PeerNegotiator } from "./negotiation.js"
import { fetchTurnCredentials, buildIceConfig } from "./ice.js"
import { LanDiscover, type LanDiscoverInfo, getLocalIp } from "./lan-discovery.js"
import { ServerProxy, startProxyServer } from "./tcp-proxy.js"
import { HostBridge } from "./host-bridge.js"
import type { P2PLanServer, P2PConnState } from "@xnlc/types" with { "resolution-mode": "import" }
import type { DescriptorPayload, CandidatePayload } from "./negotiation.js" with { "resolution-mode": "import" }

export type P2PEventCallback = (event: string, data: unknown) => void

const PENDING_LAN_LIMIT = 64
const LAN_CLEANUP_INTERVAL = 3000
const LAN_EXPIRE_MS = 5000
const LAN_BROADCAST_INTERVAL = 1000

export const DEFAULT_SIGNALING_HOST = "wss://p2p.xneon.org"
export const DEFAULT_HTTP_HOST = "https://p2p.xneon.org"

interface MetaLanMessage {
  type: "lan"
  motd: string
  port: number
}

interface MetaIdentityMessage {
  type: "identity"
  playerId: string
  uuid: string
}

interface BridgeContext {
  closed: boolean
  buffer: Buffer[]
}

export class P2PClient {
  private pc: PeerConnection | null = null
  private negotiator: PeerNegotiator | null = null
  private metadataChannel: DataChannel | null = null
  private gameChannels: Map<string, DataChannel> = new Map()
  private proxies: Map<number, ServerProxy> = new Map()
  private exposedProxies: Map<number, string> = new Map()
  private lanBroadcastTimer: NodeJS.Timeout | null = null

  private hostBridge: HostBridge | null = null
  private lan: LanDiscover
  private pendingLan: Array<{ motd: string; port: number }> = []
  private localMotdPorts: Map<string, number> = new Map()
  private lanLastSeen: Map<string, number> = new Map()
  private lanCleanupTimer: NodeJS.Timeout | null = null

  private bytesSent = 0
  private bytesRecv = 0
  private connected = false
  private iceConfig: ReturnType<typeof buildIceConfig> | null = null

  constructor(
    private signalingHost: string,
    private httpHost: string,
    private groupId: string,
    private playerName: string,
    private clientUuid: string,
    private token: string,
    private isHost: boolean,
    private onEvent?: P2PEventCallback,
    private onLog?: P2PLogCallback,
  ) {
    const role = isHost ? "HOST" : "JOINER"
    this.log = new P2PLogger(`[${role} ${playerName}] `, "debug", onLog)
    this.log.log("Init: role=%s room=%s uuid=%s", role, groupId, clientUuid)

    this.signaling = new SignalingClient(signalingHost, groupId, clientUuid, token, this.log.child("[SIG] "))
    this.signaling.addMessageHandler((msg) => this.onSignalingMessage(msg))

    if (isHost) {
      this.hostBridge = new HostBridge(this.log.child("[BRIDGE] "))
    }
    this.lan = new LanDiscover((info) => this.processLan(info), this.log.child("[LAN] "))
  }

  private log: P2PLogger
  private signaling: SignalingClient

  async connect(): Promise<void> {
    this.log.log("=== CONNECTING ===")
    this.setState("connecting")

    this.log.debug("Fetching TURN credentials from %s...", this.httpHost)
    const turn = await fetchTurnCredentials(this.httpHost, this.token, this.log.child("[TURN] "))
    const iceConfig = buildIceConfig(turn)
    this.iceConfig = iceConfig
    for (const s of iceConfig.iceServers) {
      if (typeof s === "string") {
        this.log.debug("ICE server (string): %s", s)
      } else {
        this.log.debug("ICE server: hostname=%s port=%d relayType=%s username=%s password=%s",
          s.hostname, s.port, s.relayType ?? "none", s.username ?? "none", s.password ?? "none")
      }
    }
    this.pc = new PeerConnection(`p2p-${this.clientUuid.slice(0, 8)}`, iceConfig)
    this.log.debug("PeerConnection created, iceServers=%d", iceConfig.iceServers.length)

    this.negotiator = new PeerNegotiator(this.pc, this.signaling, this.clientUuid, this.log.child("[NEGO] "))
    this.negotiator.attachHandlers()
    this.negotiator.onMetadataChannel = (dc) => {
      this.metadataChannel = dc
      this.setupMetadataChannel(dc)
    }
    this.pc.onDataChannel((dc) => this.onDataChannel(dc))

    this.log.log("Connecting to signaling server %s...", this.signalingHost)
    await this.signaling.connect()

    // Metadata DataChannel is created lazily by the offerer inside ensureOffer().
    // The answerer receives it via onDataChannel. Creating it here on both sides
    // would trigger an auto-offer in node-datachannel before we know the peer.

    this.log.log("Starting LAN discovery...")
    try {
      this.lan.start()
    } catch (e) {
      this.log.warning("LAN discovery failed to start: %s", e instanceof Error ? e.message : String(e))
    }

    // Wire connection state -> renderer
    this.pc.onStateChange((state: string) => {
      if (state === "connected" && !this.connected) {
        this.connected = true
        this.setState("connected")
      } else if (state === "failed") {
        this.connected = false
        this.setState("failed")
      } else if (state === "closed" || state === "disconnected") {
        if (this.connected) {
          this.connected = false
          this.setState("disconnected")
        }
      }
    })

    this.log.log("=== READY ===")

    // Host is ready immediately after signaling connects — no peer needed to reach "connected".
    // Joiner waits for ICE to complete (set by pc.onStateChange).
    if (this.isHost) {
      this.connected = true
      this.setState("connected")
    }
  }

  private async onSignalingMessage(message: string | Buffer): Promise<void> {
    // The server relays ALL messages as binary (ws.send_bytes).
    // Heartbeat = 24 bytes. Everything else = JSON text sent as binary.
    if (Buffer.isBuffer(message)) {
      if (message.length === 24) {
        // Heartbeat
        if (!this.negotiator) return
        const peer = this.negotiator.handleHeartbeat(message)
        if (peer) {
          const sigState = this.pc?.signalingState()
          const pending = this.negotiator.pendingRemoteUuid
          if (sigState === "have-local-offer" && pending && pending !== peer) {
            this.log.log("Stale offer to %s, resetting PC for new peer %s...", pending.slice(0, 8), peer.slice(0, 8))
            await this.resetPeerConnection()
          }
          this.log.debug("New peer detected from heartbeat, ensuring offer...")
          await this.negotiator.ensureOffer(peer)
        }
        return
      }
      // Binary but not heartbeat = relayed JSON text.
      message = message.toString("utf8")
    }

    let payload: DescriptorPayload | CandidatePayload | { type?: string; sender?: string }
    try {
      payload = JSON.parse(message as string)
    } catch {
      this.log.warning("Non-JSON signaling message (len=%d)", (message as string).length)
      return
    }

    if (payload.sender === this.clientUuid) {
      this.log.debug("Ignoring own message from %s", (payload.sender || "?").slice(0, 8))
      return
    }

    const msgType = payload.type || "?"
    const sender = (payload.sender || "?").slice(0, 8)

    this.log.debug("SIG msg type=%s sender=%s", msgType, sender)

    if (msgType === "DESCRIPTOR") {
      const p = payload as DescriptorPayload
      this.log.log("RECV DESCRIPTOR %s from %s (sdp_len=%d)", p.sdpType || "?", sender, (p.sdp || "").length)
      if (this.negotiator) await this.negotiator.handleDescriptor(p)
    } else if (msgType === "CANDIDATE") {
      if (this.negotiator) this.negotiator.handleCandidate(payload as CandidatePayload)
    } else if (msgType === "chat") {
      const chatPayload = payload as { sender?: string; message?: string; ts?: number }
      this.emit("chat", {
        sender: chatPayload.sender || "???",
        message: chatPayload.message || "",
        ts: chatPayload.ts || Date.now(),
      })
    } else {
      this.log.debug("Unknown signaling type=%s from %s", msgType, sender)
    }
  }

  private onDataChannel(channel: DataChannel): void {
    const protocol = (channel as DataChannel & { getProtocol?: () => string }).getProtocol?.() ?? ""
    this.log.log("INCOMING DataChannel: label=%s protocol=%s", channel.getLabel(), protocol)
    if (channel.getLabel() === "metadata") {
      this.setupMetadataChannel(channel)
    } else if (protocol === "minecraft") {
      this.setupGameChannel(channel)
    } else {
      this.log.warning("Unknown DataChannel label=%s protocol=%s", channel.getLabel(), protocol)
    }
  }

  private setupMetadataChannel(channel: DataChannel): void {
    this.metadataChannel = channel
    this.log.debug("Metadata channel configured: label=%s", channel.getLabel())

    channel.onMessage((data) => {
      // Metadata messages are text (JSON).
      const text = typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8")
      let msg: { type?: string; motd?: string; port?: number; playerId?: string; uuid?: string }
      try {
        msg = JSON.parse(text)
      } catch {
        return
      }
      const msgType = msg.type || "?"
      if (msgType === "lan") {
        this.log.debug("Metadata LAN: motd=%s port=%s", msg.motd, msg.port)
        void this.onRemoteLanMessage(msg as unknown as MetaLanMessage)
      } else if (msgType === "lan_remove") {
        this.log.log("Metadata LAN_REMOVE: port=%d", msg.port)
        void this.onRemoteLanRemove(msg.port ?? 0)
      } else if (msgType === "identity") {
        this.log.log("Peer identity: player=%s uuid=%s", msg.playerId, (msg.uuid || "?").slice(0, 8))
      } else {
        this.log.debug("Metadata unknown type=%s", msgType)
      }
    })

    channel.onOpen(() => {
      this.log.log("Metadata channel OPEN")
      const identity: MetaIdentityMessage = { type: "identity", playerId: this.playerName, uuid: this.clientUuid }
      try {
        channel.sendMessage(JSON.stringify(identity))
      } catch (e) {
        this.log.error("Failed to send identity: %s", e instanceof Error ? e.message : String(e))
      }
      this.flushPending()
      if (this.isHost) this.startLanCleanup()
    })

    channel.onClosed(() => {
      this.log.warning("Metadata channel CLOSED")
    })

    channel.onError((err: string) => {
      this.log.error("Metadata channel ERROR: %s", err)
    })
  }

  private setupGameChannel(channel: DataChannel): void {
    const label = channel.getLabel()
    const remotePort = parseInt(label, 10)
    if (!Number.isNaN(remotePort)) this.gameChannels.set(label, channel)
    this.log.log("Game channel OPEN: port=%d label=%s", remotePort, label)

    channel.onMessage((data) => {
      let buf: Buffer
      if (Buffer.isBuffer(data)) {
        buf = data
      } else if (typeof data === "string") {
        buf = Buffer.from(data, "utf8")
      } else {
        buf = Buffer.from(new Uint8Array(data))
      }
      this.bytesRecv += buf.length
      if (this.isHost && this.hostBridge) {
        void this.hostBridge.forward(remotePort, buf, channel)
      } else {
        const proxy = this.proxies.get(remotePort)
        if (proxy) {
          proxy.sendToClient(buf)
        } else {
          this.log.warning("No proxy for port %d, dropping %d bytes", remotePort, buf.length)
        }
      }
    })

    channel.onClosed(() => {
      this.log.warning("Game channel CLOSED: port=%d", remotePort)
    })

    channel.onError((err: string) => {
      this.log.error("Game channel ERROR port=%d: %s", remotePort, err)
    })
  }

  private async processLan(info: LanDiscoverInfo): Promise<void> {
    const port = info.port || 25565
    const motd = info.motd || "Unknown"
    this.log.debug("Local LAN: motd=%s port=%d from=%s", motd, port, info.sourceAddr)

    // Skip if this is our own proxy broadcast (loop prevention, like XMCL isFromSelf)
    if (this.exposedProxies.has(port)) return

    if (this.isHost) {
      const key = motd
      const now = Date.now()
      this.lanLastSeen.set(key, now)

      const existingPort = this.localMotdPorts.get(key)
      if (existingPort === port) return

      if (existingPort !== undefined) {
        this.log.log("LAN server port changed: motd=%s %d->%d, removing old", key, existingPort, port)
        this.sendLanRemove(existingPort)
      }

      this.localMotdPorts.set(key, port)
      if (this.metadataChannel && this.metadataChannel.isOpen()) {
        this.log.debug("Sending LAN metadata: motd=%s port=%d", motd, port)
        this.sendLanMeta(motd, port)
      } else {
        this.pendingLan.push({ motd, port })
        this.log.debug("Queued LAN metadata: motd=%s port=%d (pending=%d)", motd, port, this.pendingLan.length)
        if (this.pendingLan.length > PENDING_LAN_LIMIT) this.pendingLan.shift()
      }
    }
  }

  private flushPending(): void {
    const pending = this.pendingLan.splice(0)
    if (pending.length > 0) this.log.debug("Flushing %d pending LAN entries", pending.length)
    for (const m of pending) this.sendLanMeta(m.motd, m.port)
  }

  private sendLanRemove(port: number): void {
    if (!this.metadataChannel || !this.metadataChannel.isOpen()) return
    try {
      this.metadataChannel.sendMessage(JSON.stringify({ type: "lan_remove", port }))
    } catch (e) {
      this.log.error("Failed to send LAN remove: %s", e instanceof Error ? e.message : String(e))
    }
  }

  private sendLanMeta(motd: string, port: number): void {
    if (!this.metadataChannel || !this.metadataChannel.isOpen()) return
    try {
      this.metadataChannel.sendMessage(JSON.stringify({ type: "lan", motd, port }))
    } catch (e) {
      this.log.error("Failed to send LAN meta: %s", e instanceof Error ? e.message : String(e))
    }
  }

  private async onRemoteLanMessage(msg: MetaLanMessage): Promise<void> {
    // Only the joiner creates local proxies; the host already has the server.
    if (this.isHost) return
    const port = msg.port || 25565
    const motd = msg.motd || "Remote Minecraft"
    if (this.proxies.has(port)) {
      this.log.debug("Proxy for port %d already exists, skipping", port)
      return
    }

    this.log.log("=== CREATING PROXY: '%s' port=%d ===", motd, port)

    let proxy: ServerProxy
    try {
      proxy = await startProxyServer(
        port,
        (client, addr) => this.bridgeMcClient(port, client, addr),
        this.log.child(`[PROXY ${port}] `),
      )
    } catch (e) {
      this.log.error("Failed to start proxy for port %d: %s", port, e instanceof Error ? e.message : String(e))
      return
    }

    // Wire client→channel forwarding.
    proxy.onData = (data) => {
      // buffer until the game channel for this port opens
      void this.sendToGameChannel(port, data)
    }
    this.proxies.set(port, proxy)
    this.exposedProxies.set(proxy.actualPort, motd)
    this.log.log("Proxy READY: 0.0.0.0:%d -> remote %d (via DataChannel)", proxy.actualPort, port)

    // Broadcast on LAN so local MC client discovers it (like XMCL discover.broadcast)
    LanDiscover.broadcastLocal(motd, proxy.actualPort, this.log.child("[LAN] "))
    this.startLanBroadcast()

    // Notify the renderer so it can show the LAN server entry.
    const lanServer: P2PLanServer = { motd, port, localPort: proxy.actualPort }
    this.emit("lan", lanServer)
  }

  private async onRemoteLanRemove(port: number): Promise<void> {
    const proxy = this.proxies.get(port)
    if (!proxy) return
    this.log.log("Removing proxy for port %d", port)
    this.exposedProxies.delete(proxy.actualPort)
    proxy.stop()
    this.proxies.delete(port)
    if (this.exposedProxies.size === 0) this.stopLanBroadcast()
    this.emit("lan_remove", { port })
  }

  private startLanCleanup(): void {
    this.stopLanCleanup()
    this.lanCleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, port] of this.localMotdPorts) {
        const lastSeen = this.lanLastSeen.get(key) ?? 0
        if (now - lastSeen > LAN_EXPIRE_MS) {
          this.log.log("LAN server expired: motd=%s port=%d", key, port)
          this.localMotdPorts.delete(key)
          this.lanLastSeen.delete(key)
          this.sendLanRemove(port)
        }
      }
    }, LAN_CLEANUP_INTERVAL)
  }

  private stopLanCleanup(): void {
    if (this.lanCleanupTimer) {
      clearInterval(this.lanCleanupTimer)
      this.lanCleanupTimer = null
    }
  }

  // Joiner side: for each connecting MC client, open a dedicated game channel
  // and bridge socket<->channel.
  private bridgeMcClient(port: number, client: net.Socket, addr: { address: string; port: number }): void {
    this.log.log("MC client connected from %s:%d, creating bridge", addr.address, addr.port)
    if (!this.pc) return

    const channel = this.pc.createDataChannel(String(port), { protocol: "minecraft", negotiated: false })
    const ctx: BridgeContext = { closed: false, buffer: [] }

    const bridgeToChannel = (data: Buffer) => {
      if (ctx.closed) return
      this.bytesSent += data.length
      if (channel.isOpen()) {
        try {
          channel.sendMessageBinary(data)
        } catch {
          ctx.buffer.push(data)
        }
      } else {
        ctx.buffer.push(data)
      }
    }

    // Replace the proxy's onData so this client's data goes to THIS channel.
    const proxy = this.proxies.get(port)
    if (proxy) proxy.onData = bridgeToChannel

    channel.onOpen(() => {
      this.log.log("Game channel OPEN for port %d", port)
      this.setupGameChannel(channel)
      for (const data of ctx.buffer) {
        try { channel.sendMessageBinary(data) } catch { /* noop */ }
      }
      ctx.buffer = []
    })

    const closeBoth = () => {
      if (ctx.closed) return
      ctx.closed = true
      try { client.destroy() } catch { /* noop */ }
      try { channel.close() } catch { /* noop */ }
      this.log.debug("Bridge closed for port %d", port)
    }
    channel.onClosed(closeBoth)
    channel.onError((err: string) => this.log.error("Game channel error port=%d: %s", port, err))
    client.on("close", closeBoth)
    client.on("error", (e: Error) => this.log.debug("Client socket error port=%d: %s", port, e.message))
  }

  private sendToGameChannel(port: number, data: Buffer): Promise<void> {
    // Fallback used before a per-client channel is created; finds the existing
    // channel labelled with the port (host->joiner direction already routed in setupGameChannel).
    const channel = this.gameChannels.get(String(port))
    if (channel && channel.isOpen()) {
      try { channel.sendMessageBinary(data); this.bytesSent += data.length } catch { /* noop */ }
    }
    return Promise.resolve()
  }

  private startLanBroadcast(): void {
    if (this.lanBroadcastTimer) return
    this.lanBroadcastTimer = setInterval(() => {
      for (const [port, motd] of this.exposedProxies) {
        LanDiscover.broadcastLocal(motd, port, this.log.child("[LAN] "))
      }
    }, LAN_BROADCAST_INTERVAL)
  }

  private stopLanBroadcast(): void {
    if (this.lanBroadcastTimer) {
      clearInterval(this.lanBroadcastTimer)
      this.lanBroadcastTimer = null
    }
  }

  private setState(state: P2PConnState): void {
    this.emit("state", state)
  }

  private emit(event: string, data: unknown): void {
    this.onEvent?.(event, data)
  }

  // Close the current PeerConnection and create a fresh one.
  // Used when we're stuck with a stale offer for a disconnected peer
  // and a new peer appears.
  private async resetPeerConnection(): Promise<void> {
    if (!this.iceConfig) {
      this.log.error("Cannot reset: iceConfig not saved")
      return
    }

    // Close old PC
    if (this.pc) {
      try { this.pc.close() } catch { /* noop */ }
      this.pc = null
    }
    this.metadataChannel = null
    this.gameChannels.clear()
    this.connected = false

    // Create fresh PC
    this.pc = new PeerConnection(`p2p-${this.clientUuid.slice(0, 8)}`, this.iceConfig)
    this.negotiator = new PeerNegotiator(this.pc, this.signaling, this.clientUuid, this.log.child("[NEGO] "))
    this.negotiator.attachHandlers()
    this.negotiator.onMetadataChannel = (dc) => {
      this.metadataChannel = dc
      this.setupMetadataChannel(dc)
    }
    this.pc.onDataChannel((dc) => this.onDataChannel(dc))

    // Re-wire connection state -> renderer
    this.pc.onStateChange((state: string) => {
      if (state === "connected" && !this.connected) {
        this.connected = true
        this.setState("connected")
      } else if (state === "failed") {
        this.connected = false
        this.setState("failed")
      } else if (state === "closed" || state === "disconnected") {
        if (this.connected) {
          this.connected = false
          this.setState("disconnected")
        }
      }
    })

    this.log.log("PeerConnection reset OK")
  }

  sendChat(message: string): void {
    const chatMsg = JSON.stringify({ type: "chat", sender: this.playerName, message, ts: Date.now() })
    this.signaling.send(chatMsg)
    // Emit locally since server _relay skips the sender
    this.emit("chat", { sender: this.playerName, message, ts: Date.now() })
    this.log.debug("Chat sent: %s", message.slice(0, 64))
  }

  async close(suppressState = false): Promise<void> {
    this.log.log("=== SHUTTING DOWN ===")
    this.log.debug("Stats: bytes_sent=%d bytes_recv=%d", this.bytesSent, this.bytesRecv)

    this.stopLanBroadcast()
    this.stopLanCleanup()
    try { this.lan.stop() } catch { /* noop */ }
    this.log.debug("LAN discovery stopped")

    for (const proxy of this.proxies.values()) proxy.stop()
    this.proxies.clear()
    this.exposedProxies.clear()
    this.log.debug("Proxies stopped")

    if (this.hostBridge) {
      this.hostBridge.close()
      this.log.debug("Host bridge closed")
    }

    if (this.pc) {
      this.log.debug("Closing PeerConnection (state=%s)", this.pc.state())
      try { this.pc.close() } catch { /* noop */ }
      this.pc = null
    }

    await this.signaling.close()
    if (!suppressState) this.setState("disconnected")
    this.log.log("=== CLOSED ===")
  }
}

// getLocalIp is used by the joiner to compute the connect address shown to the user.
export { getLocalIp }
