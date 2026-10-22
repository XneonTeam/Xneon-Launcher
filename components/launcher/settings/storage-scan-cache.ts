import type { StorageScanResult } from "@xnlc/types"

// Снимок живёт до закрытия лаунчера, независимо от монтирования вкладки.
let cachedScan: StorageScanResult | null = null
let pendingScan: Promise<StorageScanResult | null> | null = null

export function getCachedStorageScan(): StorageScanResult | null {
  return cachedScan
}

export function loadStorageScan(refresh = false): Promise<StorageScanResult | null> {
  if (!refresh && cachedScan) return Promise.resolve(cachedScan)
  if (!refresh && pendingScan) return pendingScan

  const request: Promise<StorageScanResult | null> = Promise.resolve()
    .then(() => window.electronAPI?.scanStorage())
    .then(result => {
      // Ручной перескан или очистка могли начать более свежий запрос.
      if (pendingScan === request && result) cachedScan = result
      return result ?? null
    })
    .finally(() => {
      if (pendingScan === request) pendingScan = null
    })
  pendingScan = request
  return request
}
