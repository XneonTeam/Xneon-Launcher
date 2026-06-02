import { dbHelpers } from "../db"

export async function getCloudApiUrl(): Promise<string> {
  const stored = await dbHelpers.getSetting("cloudApiUrl")
  if (stored) return stored
  return process.env.CLOUD_API_URL || "http://87.121.82.248:3001/api"
}

export async function getXnClientId(): Promise<string> {
  const stored = await dbHelpers.getSetting("xnClientId")
  if (stored) return stored
  return process.env.XN_CLIENT_ID || "xneon-launcher-client"
}

export async function getXnClientSecret(): Promise<string> {
  const stored = await dbHelpers.getSetting("xnClientSecret")
  if (stored) return stored
  return process.env.XN_CLIENT_SECRET || ""
}

export async function getElyClientId(): Promise<string> {
  const stored = await dbHelpers.getSetting("elyClientId")
  if (stored) return stored
  return process.env.ELY_CLIENT_ID || "xneon-launcher-client"
}

export async function getElyClientSecret(): Promise<string> {
  const stored = await dbHelpers.getSetting("elyClientSecret")
  if (stored) return stored
  return process.env.ELY_CLIENT_SECRET || ""
}
