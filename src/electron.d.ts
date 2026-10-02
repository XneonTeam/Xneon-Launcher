import type { ElectronAPI } from '@xnlc/types'

export {}

// ── Launcher Extra API ─────────────────────────────────────
// window.electronAPI is typed by the single `ElectronAPI`
// contract from @xnlc/types (ElectronAPIExplicit & ElectronAPIExtra).
// Отдельного шима больше нет: pruneLoaderProfiles и
// checkBuildLoaderRequirements объявлены в самом пакете.

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
  type BuildLoaderRequirementIssue = import('@xnlc/types').BuildLoaderRequirementIssue
  type BuildLoaderRequirementReport = import('@xnlc/types').BuildLoaderRequirementReport
}
