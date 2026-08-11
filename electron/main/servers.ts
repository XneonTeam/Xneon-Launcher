// ============================================================
// Servers IPC Handlers
// - "servers:list": read servers from a build's servers.dat
// - "servers:write-dat": write servers.dat into a build's intent dir
// - "servers:ping": check server status using the native SLP
//   protocol (no external API dependency)
// ============================================================

import { ipcMain } from "electron"
import fs from "fs"
import path from "path"
import { NBTReader, NBTWriter } from "@xnlc/nbt"
import { getBuildIntentPath } from "./builds/helpers"
import { pingServer } from "./server-status"

function readServersDat(datPath: string): any {
  const data = fs.readFileSync(datPath)
  return new NBTReader(data).read()
}

function writeServersDatFile(datPath: string, nbt: any): void {
  const buffer = new NBTWriter().write(nbt)
  fs.writeFileSync(datPath, buffer)
}

export function registerServerHandlers() {
  ipcMain.handle("servers:list", async (_event, buildName: string): Promise<Array<{ name: string; ip: string }>> => {
    try {
      const intentPath = getBuildIntentPath(buildName)
      const datPath = path.join(intentPath, "servers.dat")
      if (!fs.existsSync(datPath)) return []
      const nbt = readServersDat(datPath)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const servers = (nbt as any).servers
      if (!servers?.values) return []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return servers.values.map((s: any) => ({
        name: String(s.name ?? ""),
        ip: String(s.ip ?? ""),
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle(
    "servers:write-dat",
    async (_event, buildName: string, servers: Array<{ name: string; ip: string }>) => {
      try {
        const intentPath = getBuildIntentPath(buildName)
        if (!fs.existsSync(intentPath)) {
          fs.mkdirSync(intentPath, { recursive: true })
        }
        const datPath = path.join(intentPath, "servers.dat")

        let nbt: any
        if (fs.existsSync(datPath)) {
          try {
            nbt = readServersDat(datPath)
          } catch {
            nbt = { servers: { type: 10, values: [] } }
          }
        } else {
          nbt = { servers: { type: 10, values: [] } }
        }

        nbt.servers.values = servers.map((s) => ({
          name: s.name,
          ip: s.ip,
          hidden: 0,
        }))

        writeServersDatFile(datPath, nbt)
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
