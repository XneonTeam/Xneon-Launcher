// Host bridge — mirrors client/host_bridge.py.
// On the host side, forwards game-channel data to the local MC server (127.0.0.1:port),
// pipes replies back to the DataChannel.

import net from "net"
import type { DataChannel } from "node-datachannel"
import { P2PLogger } from "./logger.js"

interface Conn {
  socket: net.Socket
}

export class HostBridge {
  private connections: Map<number, Conn> = new Map()
  private bytesToServer = 0
  private bytesToClient = 0

  constructor(private log: P2PLogger) {}

  async forward(remotePort: number, data: Buffer, channel: DataChannel): Promise<void> {
    let conn = this.connections.get(remotePort)
    if (!conn) {
      this.log.log("Connecting to local MC server 127.0.0.1:%d...", remotePort)
      const socket = await this.openLocal(remotePort)
      if (!socket) return
      conn = { socket }
      this.connections.set(remotePort, conn)
      this.log.log("Connected to local MC 127.0.0.1:%d", remotePort)
      this.startReader(remotePort, socket, channel)
    }
    try {
      conn.socket.write(data)
      this.bytesToServer += data.length
    } catch (e) {
      this.log.warning("Connection lost to 127.0.0.1:%d: %s", remotePort, e instanceof Error ? e.message : String(e))
      this.connections.delete(remotePort)
    }
  }

  private openLocal(port: number): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port }, () => resolve(socket))
      socket.on("error", (err: Error) => {
        this.log.error("Failed to connect to 127.0.0.1:%d: %s", port, err.message)
        resolve(null)
      })
      socket.on("close", () => {
        // cleanup handled in startReader
      })
    })
  }

  private startReader(remotePort: number, socket: net.Socket, channel: DataChannel): void {
    socket.on("data", (data: Buffer) => {
      if (channel.isOpen()) {
        try {
          channel.sendMessageBinary(data)
          this.bytesToClient += data.length
        } catch (e) {
          this.log.warning("Failed to send to channel (port %d): %s", remotePort, e instanceof Error ? e.message : String(e))
        }
      } else {
        this.log.warning("Channel not open, dropping %d bytes from MC port %d", data.length, remotePort)
      }
    })
    socket.on("close", () => {
      this.log.log("MC server closed connection on port %d", remotePort)
      this.connections.delete(remotePort)
    })
    socket.on("error", (err: Error) => {
      this.log.error("MC reader error port=%d: %s", remotePort, err.message)
      this.connections.delete(remotePort)
    })
  }

  close(): void {
    this.log.log("Closing %d MC connections...", this.connections.size)
    for (const [, conn] of this.connections) {
      try { conn.socket.destroy() } catch { /* noop */ }
    }
    this.connections.clear()
    this.log.log("Bridge closed (total: to_server=%dB, to_client=%dB)", this.bytesToServer, this.bytesToClient)
  }
}
