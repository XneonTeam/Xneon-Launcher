import path from "node:path"
import { ShareError, type ServerHistoryCommand, type ServerHistoryActor } from "@xnlc/share"
import { dbHelpers } from "../../db"
import { getLauncherDataRoot, getMcServerDir } from "../paths"
import { serverManager } from "@xnlc/servers"
import { shareConfiguration } from "../share/auth"
import { hasPendingMcServerOperation } from "../mc-server-handlers"
import { registerMcServerHandler, executeLocalServerOperation, serverHistoryLocks, serverMutations } from "./handlers"
import { ServerHistory } from "./history"
import fs from "node:fs/promises"
import { inspectJar } from "../builds/jar-inspector"
import { loadAdmZip } from "../builds/archive-utils"
import { ShareWorktree } from "../share/worktree"
import { enrichServerContent } from "./content-presentation"

const engines = new Map<string, ServerHistory>()
const deleting = new Set<string>()
const generations = new Map<string, number>()
const maxIconLength = 128 * 1024
const settingsKeys = ["name", "xmx", "xms", "extraJavaArgs", "javaPath", "autoRestart", "relayEnabled", "port", "onlineMode", "maxPlayers", "icon", "group"] as const
export async function deleteServerHistory(id: string): Promise<void> {
  const base = path.resolve(getLauncherDataRoot(), "server-history"), directory = path.resolve(base, id)
  if (!/^[a-f0-9-]{36}$/i.test(id) || path.dirname(directory) !== base) throw new ShareError("PATH", "Invalid server history directory")
  if (deleting.has(id)) throw new ShareError("BUSY", "Server history deletion is already running")
  deleting.add(id); generations.set(id, (generations.get(id) ?? 0) + 1)
  try {
    const engine = engines.get(id)
    engines.delete(id)
    await engine?.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  } finally { deleting.delete(id) }
}
export function registerServerHistoryHandlers() {
  registerMcServerHandler("mc-server:history", async (_event, id: string, command: ServerHistoryCommand, trustedActor?: ServerHistoryActor) => {
    const generation = generations.get(id) ?? 0
    if (!/^[a-f0-9-]{36}$/i.test(id) || !(await dbHelpers.getMcServer(id))) throw new ShareError("SERVER", "Server not found")
    const actor = trustedActor ?? await shareConfiguration().then(value => ({ id: value.userId, name: value.name })).catch(async () => { const accounts = await dbHelpers.loadAccounts(); const account = accounts.find(value => value.isActive) ?? accounts[0]; return { id: account?.id ?? "local-owner", name: account?.username ?? "Owner" } })
    if (deleting.has(id) || generation !== (generations.get(id) ?? 0)) throw new ShareError("REMOTE_DELETED", "Server publication history was deleted")
    let engine = engines.get(id)
    if (!engine) {
      engine = new ServerHistory({
        root: getMcServerDir(id), store: path.join(getLauncherDataRoot(), "server-history", id),
        isRunning: () => serverManager.getState(id).status !== "stopped" || hasPendingMcServerOperation(id),
        settings: async () => {
          const row = await dbHelpers.getMcServer(id), props = await executeLocalServerOperation("mc-server:read-properties", id)
          if (!row) throw new ShareError("SERVER", "Server not found")
          const values = Object.fromEntries(settingsKeys.map(key => [key, row[key] ?? null]))
          if (props?.["server-port"] && Number.isInteger(Number(props["server-port"]))) values.port = Number(props["server-port"])
          if (props?.["max-players"] && Number.isInteger(Number(props["max-players"]))) values.maxPlayers = Number(props["max-players"])
          if (props?.["online-mode"] !== undefined) values.onlineMode = props["online-mode"] === "true" ? 1 : 0
          return values
        },
        saveSettings: async values => { await dbHelpers.updateMcServer(id, Object.fromEntries(settingsKeys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]))) },
      })
      engines.set(id, engine)
    }
    const writing = !["get", "details", "file", "branch", "deleteBranch", "pullRequest", "closePullRequest", "commentPullRequest", "review"].includes(command.action)
    if (writing && (serverHistoryLocks.has(id) || serverMutations.has(id))) throw new ShareError("BUSY", "Server version operation is already running")
    if (writing) serverHistoryLocks.add(id)
    try {
      const result = await engine.run(command, actor)
      if (result.changes) {
        const presentation: NonNullable<typeof result.presentation> = {}
        result.presentation = presentation
        const entries = [...new Map(result.changes.filter(change => /^(mods|plugins)\//.test(change.path) && /\.jar(?:\.disabled)?$/i.test(change.path)).flatMap(change => [change.before, change.after].filter(Boolean).map(entry => [entry!.sha256, { path: change.path, ...entry! }] as const))).values()].slice(0, 300)
        let cursor = 0, budget = 512 * 1024
        const metadataEntries: Parameters<typeof enrichServerContent>[0] = []
        await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
          while (cursor < entries.length) {
            const entry = entries[cursor++]
            try {
              let archive = path.join(getLauncherDataRoot(), "server-history", id, "objects", entry.sha256)
              if (!await fs.stat(archive).then(() => true).catch(() => false)) {
                if (await new ShareWorktree(getMcServerDir(id)).hash(entry.path).then(hash => hash.sha256 !== entry.sha256)) continue
                archive = path.join(getMcServerDir(id), entry.path)
              }
              const inspected = await inspectJar(archive, { metadata: true, sha1: true })
              const cached = inspected.sha1 ? (await dbHelpers.getResources([inspected.sha1]))[0] : undefined
              let name = cached?.name || inspected.metadata?.name, version = cached?.version || inspected.metadata?.version, author = cached?.author || inspected.metadata?.author
              if (!name && entry.path.startsWith("plugins/")) {
                const AdmZip = await loadAdmZip(), zip = new AdmZip(await fs.readFile(archive)), plugin = (zip.getEntry("plugin.yml") ?? zip.getEntry("paper-plugin.yml") ?? zip.getEntry("bungee.yml")) as { header?: { size: number }; getData(): Buffer } | null
                if (plugin && plugin.header && plugin.header.size < 65536) {
                  const text = plugin.getData().toString("utf8")
                  const value = (key: string) => new RegExp(`^${key}:\\s*([^\\r\\n#]+)`, "m").exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "")
                  name = value("name"); version = value("version"); author = value("author") ?? value("authors")
                }
              }
              const icon = cached?.icon || inspected.metadata?.icon_url
              const iconUrl = icon && icon.length < maxIconLength && icon.length < budget ? icon : undefined
              budget -= iconUrl?.length ?? 0
              presentation[entry.sha256] = { name: name || path.basename(entry.path).replace(/\.jar(?:\.disabled)?$/i, ""), version, author, iconUrl, source: cached?.source === "modrinth" || cached?.source === "curseforge" ? cached.source : "local" }
              if (inspected.sha1) metadataEntries.push({ sha1: inspected.sha1, metadata: presentation[entry.sha256] })
            } catch { /* Неизвестный архив остаётся обычным файлом, сохранение версии не зависит от его метаданных. */ }
          }
        }))
        await enrichServerContent(metadataEntries)
        budget = 512 * 1024
        for (const metadata of Object.values(presentation)) {
          if (metadata.iconUrl && (metadata.iconUrl.length >= maxIconLength || metadata.iconUrl.length > budget)) delete metadata.iconUrl
          budget -= metadata.iconUrl?.length ?? 0
        }
      }
      return result
    } finally { if (writing) serverHistoryLocks.delete(id) }
  })
}
