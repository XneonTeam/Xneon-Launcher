import { ShareError } from "./types.js"

export const SERVER_PERMISSION_KEYS = ["start", "stop", "console", "readFiles", "writeFiles", "properties", "settings", "players", "invite", "versions"] as const
export type ServerPermission = typeof SERVER_PERMISSION_KEYS[number]
export type ServerPermissions = Record<ServerPermission, boolean>
export const serverPermissions = (enabled = false): ServerPermissions => Object.fromEntries(SERVER_PERMISSION_KEYS.map(key => [key, enabled])) as ServerPermissions
export function validateServerPermissions(value: unknown): ServerPermissions {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !SERVER_PERMISSION_KEYS.includes(key as ServerPermission))) throw new ShareError("PERMISSIONS", "Invalid server permissions")
  const result = serverPermissions()
  for (const key of SERVER_PERMISSION_KEYS) {
    const flag = (value as ServerPermissions)[key]
    if (flag !== undefined && typeof flag !== "boolean") throw new ShareError("PERMISSIONS", "Invalid server permission")
    result[key] = flag === true
  }
  return result
}
export function remoteFilePath(value: unknown, root = false): string {
  if (typeof value !== "string" || value.length > 1000 || /[\x00-\x1f\x7f:]/.test(value)) throw new ShareError("PATH", "Invalid server file path")
  const normalized = value.replace(/\\/g, "/")
  if (root && normalized === "") return ""
  if (normalized.startsWith("/") || normalized.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /[<>"|?*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) throw new ShareError("PATH", "Unsafe server file path")
  return normalized
}
/** Разрешённые операции одинаковы на ретрансляторе и компьютере владельца. */
export function assertRemoteServerOperation(permissions: ServerPermissions, channel: string, args: unknown[]): void {
  const require = (key: ServerPermission) => { if (!permissions[key]) throw new ShareError("FORBIDDEN", `Server permission required: ${key}`) }
  if (!Array.isArray(args) || args.length > 4 || !channel.startsWith("mc-server:")) throw new ShareError("INPUT", "Invalid command arguments")
  const operation = channel.slice("mc-server:".length)
  if (operation === "host-settings") {
    require("settings")
    const command = args[0] as { action?: string; path?: unknown; enabled?: unknown }
    if (args.length !== 1 || !command || typeof command !== "object" || Array.isArray(command)) throw new ShareError("INPUT", "Invalid host settings command")
    const keys = command.action === "get" ? ["action"] : command.action === "java" ? ["action", "path"] : command.action === "relay" ? ["action", "enabled"] : []
    if (!keys.length || Object.keys(command).some(key => !keys.includes(key))) throw new ShareError("INPUT", "Invalid host settings command")
    if (command.action === "java" && command.path !== null && (typeof command.path !== "string" || !command.path || command.path.length > 16384 || /[\x00-\x1f]/.test(command.path))) throw new ShareError("INPUT", "Invalid Java selection")
    if (command.action === "relay" && typeof command.enabled !== "boolean") throw new ShareError("INPUT", "Invalid relay setting")
    return
  }
  if (operation === "history") {
    const command = args[0] as { action?: string }
    if (args.length !== 1 || !command || typeof command !== "object" || !["get", "details", "file", "scan", "commit", "branch", "deleteBranch", "preview", "apply", "pullRequest", "closePullRequest", "commentPullRequest", "review"].includes(command.action ?? "")) throw new ShareError("INPUT", "Invalid server history command")
    require("readFiles")
    if (!["get", "details", "file", "review"].includes(command.action!)) require("versions")
    if (["preview", "apply"].includes(command.action!)) { require("writeFiles"); require("properties"); require("settings") }
    return
  }
  if (operation.startsWith("datapacks-")) {
    require("readFiles")
    if (operation === "datapacks-list") { if (args.length) throw new ShareError("INPUT", "Unexpected arguments"); return }
    require("writeFiles")
    if (operation === "datapacks-cancel" && args.length === 1 && typeof args[0] === "string" && /^[a-z0-9-]{1,64}$/i.test(args[0])) return
    const filename = remoteFilePath(args[0])
    if (filename.includes("/")) throw new ShareError("PATH", "Datapack filename must be a basename")
    if (operation === "datapacks-delete" && args.length === 1) return
    if (operation === "datapacks-install" && args.length === 2) {
      const source = args[1] as { url?: string; base64?: string; requestId?: string }
      if (!source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).some(key => !["url", "base64", "requestId"].includes(key)) || Boolean(source.url) === Boolean(source.base64)) throw new ShareError("INPUT", "Invalid datapack source")
      if (source.url) assertRemoteServerOperation(permissions, "mc-server:fs-download", ["world/datapacks", source.url, filename])
      else if (typeof source.base64 !== "string" || source.base64.length > 45 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.base64)) throw new ShareError("SIZE", "Invalid datapack data")
      return
    }
    throw new ShareError("INPUT", "Invalid datapack operation")
  }
  if (["get", "status", "logs", "install-state", "get-addresses", "check-eula", "read-properties"].includes(operation)) { if (args.length) throw new ShareError("INPUT", "Unexpected arguments"); return }
  if (["start", "accept-eula"].includes(operation)) { require("start"); if (args.length) throw new ShareError("INPUT", "Unexpected arguments"); return }
  if (["stop", "kill"].includes(operation)) { require("stop"); if (args.length) throw new ShareError("INPUT", "Unexpected arguments"); return }
  if (operation === "send-command") {
    require("console")
    if (args.length !== 1 || typeof args[0] !== "string" || !args[0].trim() || args[0].length > 2000 || /[\x00\r\n]/.test(args[0])) throw new ShareError("INPUT", "Invalid console command")
    if (/(?:^|\brun\s+)\/?(?:[a-z0-9_.-]+:)?(?:stop|restart|end)(?:\s|$)/i.test(args[0].trim())) require("stop")
    return
  }
  if (operation === "write-properties") {
    require("properties")
    if (args.length !== 1 || !args[0] || typeof args[0] !== "object" || Array.isArray(args[0]) || Object.entries(args[0]).some(([key, value]) => !/^[a-zA-Z0-9._-]{1,100}$/.test(key) || typeof value !== "string" || value.length > 16384 || value.includes("\0"))) throw new ShareError("INPUT", "Invalid server properties")
    return
  }
  if (operation === "update") {
    require("settings")
    const update = args[0]
    const keys = ["name", "xmx", "xms", "extraJavaArgs", "autoRestart", "icon", "group", "port", "onlineMode", "maxPlayers"]
    if (args.length !== 1 || !update || typeof update !== "object" || Array.isArray(update) || Object.keys(update).some(key => !keys.includes(key))) throw new ShareError("INPUT", "Invalid remote server settings")
    for (const [key, value] of Object.entries(update)) {
      if (["port", "onlineMode", "maxPlayers"].includes(key)) require("properties")
      if (["port", "maxPlayers", "xmx", "xms"].includes(key)) {
        if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > (key === "xmx" || key === "xms" ? 1048576 : 65535)) throw new ShareError("INPUT", "Invalid numeric server setting")
      } else if (["autoRestart", "onlineMode"].includes(key)) { if (typeof value !== "boolean") throw new ShareError("INPUT", "Invalid server setting") }
      else if (value !== null && (typeof value !== "string" || value.length > (key === "icon" ? 32768 : 16384) || value.includes("\0"))) throw new ShareError("INPUT", "Invalid server setting")
    }
    return
  }
  if (["get-whitelist", "add-whitelist", "remove-whitelist", "get-ops", "add-op", "remove-op", "get-banned", "ban-player", "unban-player", "get-banned-ips", "ban-ip", "unban-ip"].includes(operation)) {
    require("players")
    if (!operation.startsWith("get-") && (args.length !== 1 || typeof args[0] !== "string" || args[0].length > 100 || /[\x00\r\n]/.test(args[0]))) throw new ShareError("INPUT", "Invalid player")
    return
  }
  if (["fs-list", "fs-read", "resolve-installed", "fs-write", "fs-delete", "fs-rename", "fs-mkdir", "fs-download"].includes(operation)) {
    const read = ["fs-list", "fs-read", "resolve-installed"].includes(operation)
    require(read ? "readFiles" : "writeFiles")
    const source = remoteFilePath(args[0], ["fs-list", "resolve-installed", "fs-download"].includes(operation))
    const paths = [source]
    if (operation === "fs-rename") paths.push(remoteFilePath(args[1]))
    if (operation === "fs-download") {
      const filename = remoteFilePath(args[2])
      if (filename.includes("/")) throw new ShareError("PATH", "Download filename must be a basename")
      paths.push([source, filename].filter(Boolean).join("/"))
    }
    if (!read && paths.some(path => path.toLowerCase() === "server.properties")) require("properties")
    if (operation === "fs-write" && (args.length !== 2 || typeof args[1] !== "string" || new TextEncoder().encode(args[1]).length > 2 * 1024 * 1024)) throw new ShareError("SIZE", "Remote text file exceeds 2 MiB")
    if (operation === "fs-download") {
      let url: URL
      try { url = new URL(String(args[1])) } catch { throw new ShareError("URL", "Invalid download URL") }
      if (url.protocol !== "https:" || url.username || url.password || !["cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net"].includes(url.hostname)) throw new ShareError("URL", "Unsupported remote download host")
    }
    return
  }
  throw new ShareError("FORBIDDEN", "Remote operation is not allowed")
}
