import type { ElectronAPI } from '@xnlc/types'

export {}

// ── Launcher Extra API ─────────────────────────────────────
// window.electronAPI is now typed by the single `ElectronAPI`
// contract from @xnlc/types (ElectronAPIExplicit & ElectronAPIExtra).

export type LauncherCloudFile = {
  id: string
  name: string
  size: number
  modifiedAt?: string
  path: string
  isDir: boolean
  category?: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }

  // Re-export types as globals for backward compatibility
  // Components should migrate to importing from @xnlc/types directly
  type ImportableLauncherInstance = import('@xnlc/types').ImportableLauncherInstance
}