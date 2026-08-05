// ============================================================
// Servers IPC Handlers
// - "servers:write-dat": generate a Minecraft servers.dat (NBT)
//   into the .minecraft root using prismarine-nbt
// - "servers:ping": check server status using the native SLP
//   protocol (no external API dependency)
// ============================================================

import { ipcMain } from "electron"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import { comp, list, string, writeUncompressed } from "prismarine-nbt"
import { pingServer } from "./server-status"

let xnlcModulePromise: Promise<any> | null = null

function loadXnlcModule(): Promise<any> {
  if (!xnlcModulePromise) {
    xnlcModulePromise = import("@xnlc/core")
  }
  return xnlcModulePromise
}

async function getMinecraftRoot(): Promise<string> {
  const { getDefaultMinecraftRootFromEnv } = await loadXnlcModule()
  return getDefaultMinecraftRootFromEnv()
}

function generateServersDat(servers: Array<{ name: string; ip: string }>): Buffer {
  const root = comp(
    {
      servers: list(
        comp(
          servers.map((server) => ({
            name: string(server.name),
            ip: string(server.ip),
          }))
        )
      ),
    },
    ""
  )

  return zlib.gzipSync(writeUncompressed(root as unknown as Parameters<typeof writeUncompressed>[0]))
}

export function registerServerHandlers() {
  ipcMain.handle(
    "servers:write-dat",
    async (_event, servers: Array<{ name: string; ip: string }>) => {
      try {
        const root = await getMinecraftRoot()
        if (!fs.existsSync(root)) {
          fs.mkdirSync(root, { recursive: true })
        }
        const datPath = path.join(root, "servers.dat")
        const compressed = generateServersDat(servers)
        fs.writeFileSync(datPath, compressed)
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle("servers:ping", async (_event, address: string) => {
    try {
      return await pingServer(String(address ?? ""))
    } catch (e) {
      return {
        online: false,
        ip: String(address ?? ""),
        port: 0,
        players_online: 0,
        players_max: 0,
        version: "",
        latency_ms: 0,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })
}