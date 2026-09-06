import { dbHelpers } from "../db"
import { getCloudCredentials } from "./cloud/credentials"

async function getSettingOrDefault(key: string, fallback: string): Promise<string> {
  const stored = await dbHelpers.getSetting(key)
  return stored || fallback
}

export const getCloudApiUrl = () =>
  getSettingOrDefault("cloudApiUrl", process.env.CLOUD_API_URL || "http://87.121.82.248:3001/api")

export const getXnClientId = () =>
  getSettingOrDefault("xnClientId", getCloudCredentials().xnskins.clientId)

export const getXnClientSecret = () =>
  getSettingOrDefault("xnClientSecret", getCloudCredentials().xnskins.clientSecret)

export const getElyClientId = () =>
  getSettingOrDefault("elyClientId", getCloudCredentials().elyby.clientId)

export const getElyClientSecret = () =>
  getSettingOrDefault("elyClientSecret", getCloudCredentials().elyby.clientSecret)

export const getElyDeviceClientId = () =>
  getSettingOrDefault("elyDeviceClientId", getCloudCredentials().elyby.deviceClientId || "xneon-launcher")

export const getMicrosoftClientId = () =>
  getSettingOrDefault("microsoftClientId", getCloudCredentials().microsoft.clientId)

export const getMicrosoftDeviceClientId = () =>
  getSettingOrDefault("microsoftDeviceClientId", getCloudCredentials().microsoftDevice.clientId)