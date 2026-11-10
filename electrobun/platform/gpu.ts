import type { AgentHardware } from "@xnlc/types"

export async function queryGpuAdapters(platform: NodeJS.Platform, read: () => Promise<string>): Promise<AgentHardware["gpu"]> {
  if (platform !== "win32") return null
  try {
    const raw: unknown = JSON.parse(await read())
    const entries = Array.isArray(raw) ? raw : [raw]
    const adapters: NonNullable<AgentHardware["gpu"]> = []
    for (const entry of entries) {
      if (typeof entry?.Name !== "string" || !entry.Name.trim()) continue
      const pci = typeof entry.PNPDeviceID === "string"
        ? /^PCI\\VEN_([\da-f]{4})&DEV_([\da-f]{4})/i.exec(entry.PNPDeviceID)
        : null
      adapters.push({
        name: entry.Name.trim(),
        ...(pci ? { vendorId: Number.parseInt(pci[1], 16), deviceId: Number.parseInt(pci[2], 16) } : {}),
      })
    }
    return adapters.length ? adapters : null
  } catch {
    return null
  }
}
