import type { ElectronAPI } from '@xnlc/types'

export {}

// startupReady/startupThemeSnapshot объявлены в общем контракте @xnlc/types.
// ── Launcher Extra API ─────────────────────────────────────
// window.electronAPI is typed by the single `ElectronAPI`
// contract from @xnlc/types (ElectronAPIExplicit & ElectronAPIExtra).
// Архив чатов: agentSetArchived объявлен в @xnlc/types.
// Xneon Agent: agentComplete/agentCancel, история чатов, файлы сборок и onAgentDelta
// также объявлены в этом едином контракте.
// Выбор медиафайлов темы: pickThemeMedia — из того же контракта.
// Облачные архивы тем: cloudUploadTheme/cloudImportTheme — из @xnlc/types.
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
  themePreview?: import('@xnlc/types').Theme
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }

  // Re-export types as globals for backward compatibility
  // Components should migrate to importing from @xnlc/types directly
  type ImportableLauncherInstance = import('@xnlc/types').ImportableLauncherInstance
  type LauncherNewsEntry = import('@xnlc/types').LauncherNewsEntry
  type BuildLoaderRequirementIssue = import('@xnlc/types').BuildLoaderRequirementIssue
  type BuildLoaderRequirementReport = import('@xnlc/types').BuildLoaderRequirementReport
}
