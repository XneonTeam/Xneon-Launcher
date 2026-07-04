// LAN discovery — mirrors client/lan_discovery.py + net_utils.py.
// UDP multicast on 224.0.2.60:4445 (Minecraft LAN), parse [MOTD]...[/MOTD][AD]...[/AD].

import dgram from "dgram"
import os from "os"
import { P2PLogger } from "./logger.js"

const MCAST_ADDR = "224.0.2.60"
const MCAST_PORT = 4445

export interface LanDiscoverInfo {
  motd: string
  port: number
  sourceAddr: string
}

// Exclude loopback / link-local / CGNAT ranges like the Python net_utils.
function getAllLanIps(): string[] {
  const ips: string[] = []
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const info of list) {
      if (info.family !== "IPv4" || info.internal) continue
      if (
        info.address.startsWith("127.") ||
        info.address.startsWith("169.254.") ||
        info.address.startsWith("198.18.") ||
        info.address.startsWith("198.19.")
      ) {
        continue
      }
      ips.push(info.address)
    }
  }
  return ips.length > 0 ? ips : ["127.0.0.1"]
}

export function getLocalIp(): string {
  const lanIps = getAllLanIps()
  for (const ip of lanIps) {
    if (ip.startsWith("192.168.") || ip.startsWith("10.")) return ip
  }
  return lanIps[0]
}

export class LanDiscover {
  private sock: dgram.Socket | null = null
  private running = false
  private packetsRecv = 0

  constructor(
    private onDiscover: (info: LanDiscoverInfo) => void,
    private log: P2PLogger,
  ) {}

  start(): void {
    this.log.log("Starting LAN discovery...")
    try {
      this.sock = dgram.createSocket({ type: "udp4", reuseAddr: true })
    } catch (e) {
      this.log.error("Failed to create LAN socket: %s", e instanceof Error ? e.message : String(e))
      return
    }

    this.sock.on("error", (err: Error) => {
      this.log.error("LAN socket error: %s", err.message)
    })

    this.sock.on("message", (data: Buffer, rinfo: dgram.RemoteInfo) => {
      this.packetsRecv++
      this.handlePacket(data, rinfo)
    })

    this.sock.bind(MCAST_PORT, () => {
      if (!this.sock) return
      try {
        this.sock.addMembership(MCAST_ADDR, getLocalIp())
        this.sock.setMulticastTTL(4)
        this.sock.setMulticastLoopback(true)
      } catch (e) {
        this.log.warning("LAN multicast membership failed: %s", e instanceof Error ? e.message : String(e))
      }
      this.running = true
      this.log.log("LAN IPs: %s (using %s)", getAllLanIps().join(", "), getLocalIp())
      this.log.log("Listening multicast on %s:%d", MCAST_ADDR, MCAST_PORT)
    })
  }

  private handlePacket(data: Buffer, rinfo: dgram.RemoteInfo): void {
    const msg = data.toString("utf8")
    const motdMatch = msg.match(/\[MOTD\](.*?)\[\/MOTD\]/)
    const portMatch = msg.match(/\[AD\](.*?)\[\/AD\]/)
    const motd = motdMatch ? motdMatch[1] : "Unknown"
    const port = portMatch ? parseInt(portMatch[1], 10) || 25565 : 25565
    this.log.debug("LAN packet from %s:%d: motd='%s' port=%d", rinfo.address, rinfo.port, motd, port)
    try {
      this.onDiscover({ motd, port, sourceAddr: rinfo.address })
    } catch (e) {
      this.log.error("Discover handler error: %s", e instanceof Error ? e.message : String(e))
    }
  }

  stop(): void {
    this.log.debug("Stopping LAN discovery... (packets received=%d)", this.packetsRecv)
    this.running = false
    if (this.sock) {
      try {
        this.sock.dropMembership(MCAST_ADDR)
      } catch { /* noop */ }
      try {
        this.sock.close()
      } catch { /* noop */ }
      this.sock = null
    }
  }

  static broadcastLocal(motd: string, port: number, log?: P2PLogger): void {
    const message = Buffer.from(`[MOTD]${motd}[/MOTD][AD]${port}[/AD]`, "utf8")
    const localIp = getLocalIp()
    log?.debug("Broadcasting '%s' port=%d to %s:%d via %s", motd, port, MCAST_ADDR, MCAST_PORT, localIp)
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true })
    sock.bind(0, localIp, () => {
      try {
        sock.setMulticastTTL(4)
        sock.setMulticastLoopback(true)
        sock.setMulticastInterface(localIp)
        sock.send(message, 0, message.length, MCAST_PORT, MCAST_ADDR, () => {
          sock.close()
        })
      } catch (e) {
        log?.error("Broadcast failed: %s", e instanceof Error ? e.message : String(e))
        try { sock.close() } catch { /* noop */ }
      }
    })
  }
}
