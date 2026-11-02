import os from "node:os"
import path from "node:path"
import { ShareError, assertRemoteServerOperation, serverPermissions } from "@xnlc/share"
import type { ServerHostSettings, ServerHostSettingsCommand } from "@xnlc/types"
import { dbHelpers } from "../../db"
import { detectJavaInstallations, findJavaBinarySync } from "../system"
import { serverManager } from "@xnlc/servers"
import { xnConnectManager } from "../xn-connect-manager"
import { logRuntime } from "../runtime"
import { registerMcServerHandler, runServerMutation } from "./handlers"

export function registerServerHostSettingsHandlers() {
  registerMcServerHandler("mc-server:host-settings", async (_event, id: string, command: ServerHostSettingsCommand): Promise<ServerHostSettings> => {
    assertRemoteServerOperation(serverPermissions(true), "mc-server:host-settings", [command])
    let row = await dbHelpers.getMcServer(id)
    if (!row) throw new ShareError("SERVER", "Server not found")
    const installations = await detectJavaInstallations()
    if (command.action !== "get") await runServerMutation(id, async () => {
      if (command.action === "java") {
        const samePath = (a: string, b: string) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
        const selected = command.path === null ? null : installations.find(java => samePath(java.path, command.path!))?.path ?? (row!.javaPath && samePath(row!.javaPath, command.path) ? row!.javaPath : undefined)
        if (selected === undefined) throw new ShareError("JAVA", "Select Java installed on the host")
        await dbHelpers.updateMcServer(id, { javaPath: selected })
      } else if (command.action === "relay") {
        await dbHelpers.updateMcServer(id, { relayEnabled: command.enabled ? 1 : 0 })
        if (!command.enabled) await xnConnectManager.stop(id)
        else if (["running", "starting"].includes(serverManager.getState(id).status)) {
          void xnConnectManager.start(id, row!.name, row!.port).catch(error => logRuntime(`[XN-Connect] ${String(error)}`))
        }
      } else throw new ShareError("INPUT", "Invalid host settings command")
    })
    row = (await dbHelpers.getMcServer(id))!
    const state = xnConnectManager.getState(id)
    const javaPath = row.javaPath && row.javaPath !== "auto" ? row.javaPath : null
    return { javaPath, resolvedJavaPath: javaPath || await dbHelpers.getSetting("javaPath") || findJavaBinarySync(), javaInstallations: installations, memoryTotalMb: Math.floor(os.totalmem() / 1024 / 1024), relayEnabled: row.relayEnabled === 1, relayState: state.status === "auth_required" ? { status: "auth_required", authUrl: "" } : state, usage: xnConnectManager.getUsage() }
  })
}
