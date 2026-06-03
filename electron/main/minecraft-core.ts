// ============================================================
// XNLC — Minecraft Core (backward-compat re-export layer)
// Delegates to LaunchOrchestrator for worker lifecycle
// ============================================================

import type * as XnlcCoreNS from "@xnlc/core" with { "resolution-mode": "import" }
import type { XnlcHandler, ResolvedLaunchRequest } from "@xnlc/core" with { "resolution-mode": "import" }
import { logRuntimeDebug } from "./runtime"
import { LaunchOrchestrator, getLaunchOrchestrator } from "./launch-orchestrator"
import { dbHelpers, type DbAccount } from "../db"

type LaunchAccountPayload = {
  type: "elyby" | "xnskins" | "microsoft" | "offline"
  username: string
  uuid?: string
  accessToken?: string
}

type LaunchResultPayload = {
  success: boolean
  pid?: number
  error?: string
}

type XnlcModule = typeof XnlcCoreNS

let xnlcModulePromise: Promise<XnlcModule> | null = null
let handler: XnlcHandler | undefined

export function loadXnlcModule(): Promise<XnlcModule> {
  if (!xnlcModulePromise) {
    xnlcModulePromise = import("@xnlc/core")
  }
  return xnlcModulePromise
}

// ---------- Handler Management ----------

export async function getHandler(): Promise<XnlcHandler> {
  if (!handler) {
    const { createDefaultHandler } = await loadXnlcModule()
    handler = createDefaultHandler({
      memoryMax: "4G",
      memoryMin: "2G",
    })
  }

  return handler
}

export async function callHandler<T>(
  label: string,
  fallback: T,
  action: (handler: XnlcHandler) => Promise<T>,
): Promise<T> {
  try {
    return await action(await getHandler())
  } catch (error) {
    console.error(`Failed to ${label}:`, error)
    return fallback
  }
}

// ---------- Game Dir ----------

export async function getGameDir(): Promise<string> {
  const { getDefaultMinecraftRootFromEnv } = await loadXnlcModule()
  return getDefaultMinecraftRootFromEnv()
}

// ---------- Worker Lifecycle (delegated to LaunchOrchestrator) ----------

export function clearLaunchState(): void {
  getLaunchOrchestrator().clearState()
}

export function stopLaunchWorker(): void {
  getLaunchOrchestrator().stop()
}

export function isLaunchActive(): boolean {
  return getLaunchOrchestrator().isActive()
}

export async function resolveLaunchAccount(requestAccount?: LaunchAccountPayload): Promise<DbAccount | undefined> {
  return getLaunchOrchestrator().resolveLaunchAccount(requestAccount)
}

export async function runLaunchWorker(
  launchAccount: DbAccount,
  request: ResolvedLaunchRequest & { buildName?: string; gameDir?: string },
): Promise<LaunchResultPayload> {
  return getLaunchOrchestrator().runLaunch(launchAccount, request)
}
