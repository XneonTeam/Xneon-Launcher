// ICE / TURN credentials — mirrors client/ice.py.

import axios from "axios"
import type { RtcConfig, IceServer } from "node-datachannel"
import { P2PLogger } from "./logger.js"

export interface TurnResponse {
  username: string
  credential: string
  ttl: number
  uris: string[]
  stuns: string[]
}

export async function fetchTurnCredentials(
  httpHost: string,
  token: string,
  log: P2PLogger,
): Promise<TurnResponse | null> {
  const url = `${httpHost.replace(/\/+$/, "")}/turn-credentials`
  log.log("Requesting TURN credentials from %s", url)
  try {
    const resp = await axios.get<TurnResponse>(url, {
      timeout: 15000,
      headers: { Authorization: `Bearer ${token}` },
    })
    log.debug("HTTP %d from %s", resp.status, url)
    const data = resp.data
    log.log("TURN credentials received:")
    log.log("  Username: %s", data.username)
    log.log("  TTL: %s", data.ttl)
    data.uris?.forEach((u, i) => log.debug("  TURN[%d]: %s", i, u))
    data.stuns?.forEach((s, i) => log.debug("  STUN[%d]: %s", i, s))
    log.log("Total: %d TURN URIs, %d STUN URIs", data.uris?.length ?? 0, data.stuns?.length ?? 0)
    return data
  } catch (e) {
    const msg = axios.isAxiosError(e) ? e.message : String(e)
    log.error("TURN fetch failed: %s", msg)
    return null
  }
}

// Parse a URI like "turn:host:port" or "turns:host:port?transport=tcp" into an IceServer.
// Only include username/password when BOTH are present — node-datachannel rejects partial credentials.
function parseIceUri(uri: string, username?: string, password?: string): IceServer {
  const m = uri.match(/^(turn|turns|stun):([^:]+):(\d+)(\?.*)?$/i)
  const creds = username && password ? { username, password } : {}
  if (!m) {
    return { hostname: uri, port: 3478, ...creds }
  }
  const proto = m[1].toLowerCase()
  const hostname = m[2]
  const port = parseInt(m[3], 10)
  const query = m[4] || ""
  const relayType: IceServer["relayType"] | undefined =
    proto === "turns" ? (query.includes("transport=tcp") ? "TurnTcp" : "TurnTls")
    : proto === "turn" ? "TurnUdp"
    : undefined
  return { hostname, port, relayType, ...creds }
}

export function buildIceConfig(turn?: TurnResponse | null, extraServers: IceServer[] = []): RtcConfig {
  const servers: IceServer[] = []
  const hasCreds = Boolean(turn?.username && turn?.credential)
  if (turn) {
    for (const u of turn.uris ?? []) {
      servers.push(parseIceUri(u, hasCreds ? turn.username : undefined, hasCreds ? turn.credential : undefined))
    }
    for (const s of turn.stuns ?? []) {
      servers.push(parseIceUri(s))
    }
  }
  for (const s of extraServers) servers.push(s)
  return {
    iceServers: servers,
    enableIceTcp: true,
    enableIceUdpMux: true,
  }
}
