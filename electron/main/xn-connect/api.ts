import https from "https"
import http from "http"
import fs from "fs"
import path from "path"

export const DEFAULT_API_URL = "https://connect.xneon.org"
export const DEFAULT_RELAY_ADDR = "relay.xneon.org:5000"

export type Node = {
  id: string
  name: string
  location: string
  flag: string
  host: string
  public_host: string
  status: string
  port: number
}

export type Tunnel = {
  id: string
  name: string
  protocol: string
  status: string
  access_token: string
  public_host: string
  local_ip: string
  local_port: number
  public_port: number
  block_reason: string
  is_blocked: boolean
  nodes: Node[]
  node_count: number
}

function tokenPath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || "."
  return path.join(home, ".xnconnect", "tokens.json")
}

function loadToken(): string | null {
  try {
    const data = fs.readFileSync(tokenPath(), "utf-8")
    const match = data.match(/"access_token"\s*:\s*"([^"]+)"/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function saveToken(accessToken: string, refreshToken: string): void {
  const dir = path.dirname(tokenPath())
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(tokenPath(), JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }))
}

function httpRequest(
  method: string,
  url: string,
  auth: string | null,
  body: string | null,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === "https:" ? https : http

    const headers: Record<string, string> = {}
    if (auth) headers["Authorization"] = `Bearer ${auth}`
    if (body) headers["Content-Type"] = "application/json"

    const req = mod.request(
      parsed,
      {
        method,
        headers,
        timeout: 15000,
      },
      (res) => {
        let data = ""
        res.on("data", (chunk: Buffer) => { data += chunk.toString() })
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )

    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })

    if (body) req.write(body)
    req.end()
  })
}

function jsonString(json: string, key: string): string | null {
  const needle = `"${key}"`
  const p = json.indexOf(needle)
  if (p === -1) return null
  const colon = json.indexOf(":", p + needle.length)
  if (colon === -1) return null
  let i = colon + 1
  while (i < json.length && /\s/.test(json[i])) i++
  if (json[i] !== '"') return null
  i++
  const start = i
  while (i < json.length && json[i] !== '"') {
    if (json[i] === "\\") i++
    i++
  }
  return json.slice(start, i).replace(/\\(["\\/bfnrt])/g, "$1")
}

function jsonInt(json: string, key: string, def: number): number {
  const needle = `"${key}"`
  const p = json.indexOf(needle)
  if (p === -1) return def
  const colon = json.indexOf(":", p + needle.length)
  if (colon === -1) return def
  return parseInt(json.slice(colon + 1), 10) || def
}

function jsonBool(json: string, key: string): boolean {
  const needle = `"${key}"`
  const p = json.indexOf(needle)
  if (p === -1) return false
  const colon = json.indexOf(":", p + needle.length)
  if (colon === -1) return false
  return json.slice(colon + 1).trimStart().startsWith("true")
}

function parseNode(j: string): Node {
  return {
    id: jsonString(j, "id") ?? "",
    name: jsonString(j, "name") ?? "",
    location: jsonString(j, "location") ?? "",
    flag: jsonString(j, "flag") ?? "",
    host: jsonString(j, "host") ?? "",
    public_host: jsonString(j, "public_host") ?? "",
    status: jsonString(j, "status") ?? "",
    port: jsonInt(j, "port", 0),
  }
}

function parseTunnel(j: string): Tunnel {
  return {
    id: jsonString(j, "id") ?? "",
    name: jsonString(j, "name") ?? "",
    protocol: jsonString(j, "protocol") ?? "",
    status: jsonString(j, "status") ?? "",
    access_token: jsonString(j, "access_token") ?? "",
    public_host: jsonString(j, "public_host") ?? "",
    local_ip: jsonString(j, "local_ip") ?? "",
    local_port: jsonInt(j, "local_port", 0),
    public_port: jsonInt(j, "public_port", 0),
    block_reason: jsonString(j, "block_reason") ?? "",
    is_blocked: jsonBool(j, "is_blocked"),
    nodes: [],
    node_count: 0,
  }
}

function splitObjects<T>(json: string, kind: "node" | "tunnel"): T[] {
  const results: T[] = []
  let depth = 0
  let start = -1
  let inString = false

  for (let i = 0; i < json.length && results.length < 100; i++) {
    const ch = json[i]
    if (ch === '"' && (i === 0 || json[i - 1] !== "\\")) {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") {
      if (depth++ === 0) start = i
    } else if (ch === "}") {
      if (--depth === 0 && start >= 0) {
        const obj = json.slice(start, i + 1)
        if (kind === "node") results.push(parseNode(obj) as unknown as T)
        else results.push(parseTunnel(obj) as unknown as T)
        start = -1
      }
    }
  }
  return results
}

export async function apiValidToken(token: string, apiUrl: string): Promise<boolean> {
  if (!token) return false
  try {
    const res = await httpRequest("GET", `${apiUrl}/api/auth/me`, token, null)
    return res.status === 200
  } catch {
    return false
  }
}

export async function apiLoadToken(): Promise<string | null> {
  return loadToken()
}

export type DeviceAuthSession = {
  authUrl: string
  deviceCode: string
  expiresIn: number
  interval: number
}

export async function apiStartDeviceAuth(apiUrl: string): Promise<DeviceAuthSession> {
  const res = await httpRequest("POST", `${apiUrl}/api/auth/cli/device`, null, "{}")
  if (res.status !== 200) throw new Error("device auth failed")

  const code = jsonString(res.body, "device_code") ?? ""
  if (!code) throw new Error("no device_code in response")

  const expiresIn = jsonInt(res.body, "expires_in", 600)
  const interval = jsonInt(res.body, "interval", 5)

  return {
    authUrl: `${apiUrl}/cli-auth?code=${code}`,
    deviceCode: code,
    expiresIn,
    interval,
  }
}

export async function apiPollDeviceAuth(apiUrl: string, deviceCode: string): Promise<string | null> {
  const tokenRes = await httpRequest(
    "POST",
    `${apiUrl}/api/auth/cli/token`,
    null,
    JSON.stringify({ device_code: deviceCode }),
  )

  if (tokenRes.status === 200) {
    const access = jsonString(tokenRes.body, "access_token") ?? ""
    const refresh = jsonString(tokenRes.body, "refresh_token") ?? ""
    const error = jsonString(tokenRes.body, "error") ?? ""

    if (access) {
      saveToken(access, refresh)
      return access
    }
    if (error && error !== "authorization_pending") {
      throw new Error(`auth error: ${error}`)
    }
  }

  return null
}

export async function apiBrowserAuth(apiUrl: string): Promise<string> {
  const session = await apiStartDeviceAuth(apiUrl)

  for (let i = 0; i < Math.ceil(session.expiresIn / session.interval); i++) {
    if (i > 0) await new Promise(r => setTimeout(r, session.interval * 1000))

    const token = await apiPollDeviceAuth(apiUrl, session.deviceCode)
    if (token) return token
  }

  throw new Error("auth timeout")
}

export type XnConnectAccount = {
  username: string
  plan: string
  maxTunnels: number
}

// GET /api/auth/me — returns account info including tunnel limits
// (e.g. { max_tunnels: 10, plan: "premium", ... }). Verified against
// https://connect.xneon.org: max_tunnels is the authoritative limit.
export async function apiGetAccount(token: string, apiUrl: string): Promise<XnConnectAccount | null> {
  try {
    const res = await httpRequest("GET", `${apiUrl}/api/auth/me`, token, null)
    if (res.status !== 200) return null
    const username = jsonString(res.body, "username") ?? ""
    const plan = jsonString(res.body, "plan") ?? "free"
    const maxTunnels = jsonInt(res.body, "max_tunnels", 0)
    if (!username && maxTunnels === 0) return null
    return { username, plan, maxTunnels }
  } catch {
    return null
  }
}

export async function apiGetNodes(token: string, apiUrl: string): Promise<Node[]> {
  const res = await httpRequest("GET", `${apiUrl}/api/v1/nodes/available`, token, null)
  if (res.status !== 200) return []
  return splitObjects<Node>(res.body, "node")
}

export async function apiGetTunnels(token: string, apiUrl: string): Promise<Tunnel[]> {
  const res = await httpRequest("GET", `${apiUrl}/api/v1/tunnels`, token, null)
  if (res.status !== 200) return []
  return splitObjects<Tunnel>(res.body, "tunnel")
}

export async function apiCreateTunnel(
  token: string,
  apiUrl: string,
  name: string,
  ip: string,
  port: number,
  nodes: Node[],
): Promise<Tunnel | null> {
  const best = nodes.find(n => n.status === "online") ?? nodes[0]
  if (!best) return null

  const body = JSON.stringify({
    name: name.replace(/"/g, '\\"'),
    game: "minecraft-java",
    protocol: "TCP",
    local_port: port,
    local_ip: ip,
    node_id: best.id,
  })

  const res = await httpRequest("POST", `${apiUrl}/api/v1/tunnels`, token, body)
  if (res.status !== 200) return null
  return parseTunnel(res.body)
}

export function apiIsTunnelBlocked(t: Tunnel): boolean {
  return t.is_blocked || /blocked|banned|suspended/i.test(t.status)
}
