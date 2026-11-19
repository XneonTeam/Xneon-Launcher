import type { IpcInvokeMap } from "@xnlc/types"

const second = 1000
const minute = 60 * second
const localReads = new Set<string>(["settings:get", "db:load-builds-light", "db:load-build-content", "db:load-accounts"])
const filesystem = /^(storage:|build:(scan-|copy|export-|save-local|delete-|move-|restore-)|mc-server:fs-)/
const interactive = /^(auth:.*-login|authlib:login|common:pick-|theme:pick-|java:pick-|build:open-and-import)/
const transfers = /^(update:download|build:(import-|save-mod-to-intent|save-content-to-intent|fetch-missing-mods)|cloud:(upload-|download-|import-)|mc-server:(start|install-pack|datapacks-install)|minecraft:launch|share:execute|worlds:import-)/

export function rpcTimeout(channel: keyof IpcInvokeMap): number {
  if (localReads.has(channel)) return 10 * second
  if (interactive.test(channel) || transfers.test(channel)) return 15 * minute
  if (channel === "agent:complete" || channel === "agent:mcp-call") return 5 * minute
  if (filesystem.test(channel) || channel === "startup:ready") return 2 * minute
  // Сетевые запросы могут включать несколько HTTP-попыток.
  return 90 * second
}
