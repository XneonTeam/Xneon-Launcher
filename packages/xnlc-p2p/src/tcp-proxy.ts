// Local TCP proxy — mirrors client/tcp_proxy.py.
// Listens on a local port (from preferredPort upward), accepts one MC client,
// forwards bytes to a callback; sendToClient pushes data back to the client.

import net from "net"
import { P2PLogger } from "./logger.js"

export class ServerProxy {
  private serverSocket: net.Server | null = null
  private clientSocket: net.Socket | null = null
  private running = false
  private bytesFromClient = 0
  private bytesToClient = 0
  actualPort = 0

  onData: (data: Buffer) => void = () => {}

  constructor(
    private remotePort: number,
    private onClientConnect: (client: net.Socket, addr: { address: string; port: number }) => void,
    private log: P2PLogger,
  ) {}

  async start(preferredPort = 25565): Promise<number> {
    this.log.log("Starting TCP proxy (preferred port=%d)...", preferredPort)
    this.serverSocket = net.createServer((client) => {
      const addr = client.remoteAddress ?? "?"
      const port = client.remotePort ?? 0
      if (this.clientSocket) {
        this.log.warning("Already have a client, rejecting extra connection from %s:%d", addr, port)
        client.destroy()
        return
      }
      this.clientSocket = client
      this.log.log("Minecraft client connected from %s:%d", addr, port)
      this.onClientConnect(client, { address: addr, port })

      client.on("data", (data: Buffer) => {
        this.bytesFromClient += data.length
        this.onData(data)
      })
      client.on("close", () => {
        this.log.log("Minecraft client disconnected")
        this.clientSocket = null
      })
      client.on("error", (err: Error) => {
        this.log.debug("Client recv error: %s", err.message)
        this.clientSocket = null
      })
    })

    let port = preferredPort
    for (; port <= 65535; port++) {
      const listened = await new Promise<boolean>((resolve) => {
        const onError = (e: NodeJS.ErrnoException) => {
          this.serverSocket!.off("error", onError)
          if (e.code === "EADDRINUSE") {
            resolve(false)
          } else {
            this.log.error("Listen error on port %d: %s", port, e.message)
            resolve(false)
          }
        }
        this.serverSocket!.on("error", onError)
        this.serverSocket!.listen({ port, host: "0.0.0.0", exclusive: false }, () => {
          this.serverSocket!.off("error", onError)
          resolve(true)
        })
      })
      if (listened) {
        this.actualPort = port
        break
      }
      this.log.debug("Port %d busy, trying next...", port)
    }

    if (this.actualPort === 0) {
      this.log.error("No free TCP port found (tried %d-65535)", preferredPort)
      throw new Error("No free TCP port found")
    }

    this.running = true
    this.log.log("Listening on 0.0.0.0:%d -> remote port %d", this.actualPort, this.remotePort)
    return this.actualPort
  }

  sendToClient(data: Buffer): void {
    if (this.clientSocket && !this.clientSocket.destroyed) {
      try {
        this.clientSocket.write(data)
        this.bytesToClient += data.length
      } catch (e) {
        this.log.warning("Failed to send %d bytes to MC client: %s", data.length, e instanceof Error ? e.message : String(e))
      }
    }
  }

  stop(): void {
    this.log.log("Stopping proxy (from_client=%dB, to_client=%dB)...", this.bytesFromClient, this.bytesToClient)
    this.running = false
    if (this.clientSocket) {
      try { this.clientSocket.destroy() } catch { /* noop */ }
      this.clientSocket = null
    }
    if (this.serverSocket) {
      try { this.serverSocket.close() } catch { /* noop */ }
      this.serverSocket = null
    }
  }
}

export async function startProxyServer(
  remotePort: number,
  onClientConnect: (client: net.Socket, addr: { address: string; port: number }) => void,
  log: P2PLogger,
): Promise<ServerProxy> {
  const proxy = new ServerProxy(remotePort, onClientConnect, log)
  await proxy.start(remotePort)
  return proxy
}
