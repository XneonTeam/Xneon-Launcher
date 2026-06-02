export type CloudItem = {
  id: string
  name: string
  size: string
  lastSynced: string
  type: "instance" | "account" | "skin"
  category?: string
  downloadUrl?: string
  icon?: string
  version?: string
}

export type StorageInfo = {
  used: number
  total: number
  usedFormatted: string
  totalFormatted: string
  percentage: number
}

export type CategoryStats = {
  [key: string]: { count: number; size: number }
}

export type LocalBuild = {
  id: string
  name: string
  description: string
  version: string
  modLoader: string
  createdAt: string
  icon?: string
}
