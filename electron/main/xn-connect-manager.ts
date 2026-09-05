import { BrowserWindow } from "electron"
import {
  apiValidToken,
  apiLoadToken,
  apiStartDeviceAuth,
  apiPollDeviceAuth,
  apiGetAccount,
  apiGetTunnels,
  apiGetNodes,
  apiCreateTunnel,
  apiDeleteTunnel,
  apiFindServerTunnel,
  apiIsTunnelBlocked,
  DEFAULT_API_URL,
  type Tunnel,
  type Node,
} from "./xn-connect/api"
import { runTunnel, type RelayCallbacks } from "./xn-connect/relay"
import { logRuntime } from "./runtime"

type RelayState =
  | { status: "stopped" }
  | { status: "auth_required"; authUrl: string }
  | { status: "starting" }
  | { status: "running"; publicAddress: string; tunnelId: string }
  | { status: "limit_reached"; used: number; max: number; plan: string }

export type XnConnectUsage = {
  used: number
  max: number
  plan: string
}

type RunningRelay = {
  state: RelayState
  stopFn: (() => void) | null
  stop: boolean
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export class XnConnectManager {
  private running = new Map<string, RunningRelay>()
  private usageCache: XnConnectUsage | null = null

  getUsage(): XnConnectUsage | null {
    return this.usageCache
  }

  // Refresh tunnel usage (used/max/plan) from the API. Returns null when
  // unauthorized or the API is unreachable. Result is cached for the UI counter.
  async refreshUsage(): Promise<XnConnectUsage | null> {
    const apiUrl = DEFAULT_API_URL
    const token = await apiLoadToken()
    if (!token) {
      this.usageCache = null
      return null
    }

    const account = await apiGetAccount(token, apiUrl)
    if (!account || account.maxTunnels <= 0) {
      this.usageCache = null
      return null
    }

    const tunnels = await apiGetTunnels(token, apiUrl)
    const usage: XnConnectUsage = {
      used: tunnels.length,
      max: account.maxTunnels,
      plan: account.plan,
    }
    this.usageCache = usage
    sendToRenderer("xn-connect:usage-updated", usage)
    return usage
  }

  getState(serverId: string): RelayState {
    return this.running.get(serverId)?.state ?? { status: "stopped" }
  }

  async start(
    serverId: string,
    serverName: string,
    port: number,
    ip: string = "127.0.0.1",
  ): Promise<RelayState> {
    if (this.running.has(serverId)) {
      return this.running.get(serverId)!.state
    }

    logRuntime(`[XN-Connect] Starting relay for server ${serverName} on port ${port}`)

    const relay: RunningRelay = {
      state: { status: "starting" },
      stopFn: null,
      stop: false,
    }
    this.running.set(serverId, relay)

    try {
      // 1. Authenticate
      const apiUrl = DEFAULT_API_URL
      let token: string | null = await apiLoadToken()

      if (!token || !await apiValidToken(token, apiUrl)) {
        logRuntime(`[XN-Connect] No valid token, starting auth flow...`)

        let authSession
        try {
          authSession = await apiStartDeviceAuth(apiUrl)
        } catch (err: any) {
          logRuntime(`[XN-Connect] Failed to start auth: ${err.message}`)
          this.cleanup(serverId)
          relay.state = { status: "stopped" }
          sendToRenderer("xn-connect:state", { serverId, state: relay.state })
          return relay.state
        }

        // Show auth URL in UI
        relay.state = { status: "auth_required", authUrl: authSession.authUrl }
        sendToRenderer("xn-connect:state", { serverId, state: relay.state })
        logRuntime(`[XN-Connect] Auth required: ${authSession.authUrl}`)

        // Poll for auth completion
        let authComplete = false
        for (let i = 0; i < Math.ceil(authSession.expiresIn / authSession.interval); i++) {
          if (relay.stop) break
          await sleep(authSession.interval * 1000)
          if (relay.stop) break

          try {
            const t = await apiPollDeviceAuth(apiUrl, authSession.deviceCode)
            if (t) {
              token = t
              authComplete = true
              logRuntime(`[XN-Connect] Authorization successful`)
              break
            }
          } catch (err: any) {
            logRuntime(`[XN-Connect] Auth poll error: ${err.message}`)
            break
          }
        }

        if (!authComplete) {
          logRuntime(`[XN-Connect] Auth timeout or cancelled`)
          this.cleanup(serverId)
          relay.state = { status: "stopped" }
          sendToRenderer("xn-connect:state", { serverId, state: relay.state })
          return relay.state
        }
      } else {
        logRuntime(`[XN-Connect] Using saved token`)
      }

      if (!token) {
        logRuntime(`[XN-Connect] No token available`)
        this.cleanup(serverId)
        relay.state = { status: "stopped" }
        sendToRenderer("xn-connect:state", { serverId, state: relay.state })
        return relay.state
      }

      // 2. Load tunnels
      logRuntime(`[XN-Connect] Loading tunnels...`)
      const tunnels = await apiGetTunnels(token, apiUrl)

      // Find existing tunnel for this server by name
      let tunnel: Tunnel | null = null
      for (const t of tunnels) {
        if (t.name === serverName &&
            t.local_port === port &&
            !apiIsTunnelBlocked(t)) {
          tunnel = t
          logRuntime(`[XN-Connect] Using existing tunnel: ${t.id}`)
          break
        }
      }

      // 3. Load relay nodes
      logRuntime(`[XN-Connect] Loading relay nodes...`)
      let nodes = await apiGetNodes(token, apiUrl)

      if (nodes.length === 0) {
        logRuntime(`[XN-Connect] No relay nodes from API, using fallback`)
        nodes = [{
          id: "fallback",
          name: "Fallback",
          location: "Global",
          flag: "",
          host: "connect.xneon.org",
          public_host: "connect.xneon.org",
          status: "online",
          port: 5000,
        }]
      }

      logRuntime(`[XN-Connect] Found ${nodes.length} relay nodes`)

      // 4. Create tunnel if needed
      if (!tunnel) {
        // Enforce the account tunnel limit — max_tunnels comes from /api/auth/me
        // and is fully account-specific (admin-settable). No local fallback: if the
        // API gives no limit we let the server decide (it returns 403 "tunnel limit reached").
        const account = await apiGetAccount(token, apiUrl)
        if (account && account.maxTunnels > 0) {
          this.usageCache = { used: tunnels.length, max: account.maxTunnels, plan: account.plan }
          sendToRenderer("xn-connect:usage-updated", this.usageCache)

          if (tunnels.length >= account.maxTunnels) {
            logRuntime(`[XN-Connect] Tunnel limit reached: ${tunnels.length}/${account.maxTunnels} (plan: ${account.plan})`)
            this.cleanup(serverId)
            relay.state = { status: "limit_reached", used: tunnels.length, max: account.maxTunnels, plan: account.plan }
            sendToRenderer("xn-connect:state", { serverId, state: relay.state })
            return relay.state
          }
        }

        logRuntime(`[XN-Connect] Creating tunnel...`)
        tunnel = await apiCreateTunnel(token, apiUrl, serverName, ip, port, nodes)
        if (!tunnel) {
          logRuntime(`[XN-Connect] Failed to create tunnel`)
          this.cleanup(serverId)
          relay.state = { status: "stopped" }
          sendToRenderer("xn-connect:state", { serverId, state: relay.state })
          return relay.state
        }
        logRuntime(`[XN-Connect] Tunnel created: ${tunnel.id}`)
      }

      // 5. Attach nodes to tunnel
      tunnel.nodes = nodes
      tunnel.node_count = nodes.length

      // 6. Start relay
      relay.state = { status: "starting" }
      sendToRenderer("xn-connect:state", { serverId, state: relay.state })

      const callbacks: RelayCallbacks = {
        onLog: (line) => sendToRenderer("xn-connect:log", { serverId, line }),
        onStateChange: (state) => {
          if (state === "running") {
            relay.state = {
              status: "running",
              publicAddress: `${tunnel!.public_host}:${tunnel!.public_port}`,
              tunnelId: tunnel!.id,
            }
            sendToRenderer("xn-connect:state", { serverId, state: relay.state })
            logRuntime(`[XN-Connect] Relay running: ${tunnel!.public_host}:${tunnel!.public_port}`)
          }
        },
      }

      const { stop } = await runTunnel(tunnel, callbacks)
      relay.stopFn = stop

      // Wait a moment for connection to establish
      await new Promise(r => setTimeout(r, 1500))

      if (relay.state.status === "starting") {
        // Still starting — mark as running with the address
        relay.state = {
          status: "running",
          publicAddress: `${tunnel.public_host}:${tunnel.public_port}`,
          tunnelId: tunnel.id,
        }
        sendToRenderer("xn-connect:state", { serverId, state: relay.state })
      }

      return relay.state
    } catch (err: any) {
      logRuntime(`[XN-Connect] Error: ${err.message}`)
      this.cleanup(serverId)
      relay.state = { status: "stopped" }
      sendToRenderer("xn-connect:state", { serverId, state: relay.state })
      return relay.state
    }
  }

  async stop(serverId: string): Promise<void> {
    const relay = this.running.get(serverId)
    if (!relay) return

    logRuntime(`[XN-Connect] Stopping relay for server ${serverId}`)
    relay.stop = true
    relay.stopFn?.()
    this.cleanup(serverId)
    sendToRenderer("xn-connect:state", { serverId, state: { status: "stopped" } })
  }

  async stopAll(): Promise<void> {
    for (const [id] of this.running) {
      await this.stop(id)
    }
  }

  // Best-effort removal of the XN Connect tunnel that belongs to a launcher
  // server (matched by name + local port). Never throws: returns false when
  // the tunnel was not found or could not be deleted (no token, offline, ...).
  async deleteTunnelForServer(serverName: string, port: number): Promise<boolean> {
    try {
      const apiUrl = DEFAULT_API_URL
      const token = await apiLoadToken()
      if (!token) return false

      const tunnels = await apiGetTunnels(token, apiUrl)
      const tunnel = apiFindServerTunnel(tunnels, serverName, port)
      if (!tunnel) return false

      const ok = await apiDeleteTunnel(token, apiUrl, tunnel.id)
      if (ok) {
        logRuntime(`[XN-Connect] Tunnel deleted: ${tunnel.id} (server "${serverName}", port ${port})`)
        // Counter changed — refresh and notify the UI
        this.refreshUsage().catch(() => {})
      }
      return ok
    } catch (err: any) {
      logRuntime(`[XN-Connect] Failed to delete tunnel for "${serverName}": ${err.message}`)
      return false
    }
  }

  isRunning(serverId: string): boolean {
    const relay = this.running.get(serverId)
    return relay?.state.status === "running"
  }

  // Performs XN-Connect device-flow authorization and saves the token, without
  // creating/running a tunnel. Used to authorize up front (e.g. at server creation)
  // so that starting a server later doesn't re-prompt for login.
  async authorize(
    onState: (state: RelayState) => void = () => {},
  ): Promise<boolean> {
    const apiUrl = DEFAULT_API_URL

    let token: string | null = await apiLoadToken()
    if (token && await apiValidToken(token, apiUrl)) {
      logRuntime(`[XN-Connect] Already authorized`)
      return true
    }

    logRuntime(`[XN-Connect] Authorizing...`)
    onState({ status: "starting" })

    let authSession
    try {
      authSession = await apiStartDeviceAuth(apiUrl)
    } catch (err: any) {
      logRuntime(`[XN-Connect] Authorize: failed to start auth: ${err.message}`)
      onState({ status: "stopped" })
      return false
    }

    onState({ status: "auth_required", authUrl: authSession.authUrl })
    logRuntime(`[XN-Connect] Authorize: auth required: ${authSession.authUrl}`)

    let authComplete = false
    for (let i = 0; i < Math.ceil(authSession.expiresIn / authSession.interval); i++) {
      await sleep(authSession.interval * 1000)
      try {
        const t = await apiPollDeviceAuth(apiUrl, authSession.deviceCode)
        if (t) {
          authComplete = true
          logRuntime(`[XN-Connect] Authorize: success`)
          break
        }
      } catch (err: any) {
        logRuntime(`[XN-Connect] Authorize: poll error: ${err.message}`)
        break
      }
    }

    if (!authComplete) {
      logRuntime(`[XN-Connect] Authorize: timeout or cancelled`)
      onState({ status: "stopped" })
      return false
    }

    // Publish fresh tunnel usage so the UI counter is up to date right after login
    this.refreshUsage().catch(() => {})

    return true
  }

  private cleanup(serverId: string): void {
    this.running.delete(serverId)
  }
}

export const xnConnectManager = new XnConnectManager()
