import type { ElectrobunAPI } from '@xnlc/types'
// onAiMcpServersUpdated наследуется из общего IPC-контракта; событие не содержит секретов.
// liveopsStatus/liveopsSelect также наследуются из единого IPC-контракта @xnlc/types.
// loadAccounts/AuthPayload — публичные DTO; setActiveAccount/importLegacyAccounts
// объявлены в едином IPC-контракте. Сессионные секреты остаются в main.
// Чтение состава Modrinth-сборок без установки: modsModrinthPackContents — из общего контракта.
// XNLC/Share: shareExecute и типы запросов объявлены в общем контракте @xnlc/types.
// onShareProgress использует ShareProgress: действие, имя сборки и код ошибки.
// Удалённые mc-servers: mcServerRemote и события соединения объявлены в том же IPC-контракте.
// История mc-servers: mcServerHistory объявлен в общем контракте.
// Настройки хоста: mcServerHostSettings использует тот же контракт.

// Отмена контента: cancelContentDownload — из общего IPC-контракта.
// Буфер файлов агента: agentClipboardFiles — из общего IPC-контракта.
// Перенос сборок: getDataMoveStatus/restartForDataMove — из общего IPC-контракта.
export {}

// startupReady/startupThemeSnapshot объявлены в общем контракте @xnlc/types.
// getSettings(keys) читает разрешённые настройки одним IPC; секреты AI исключены в main.
// ── Launcher Extra API ─────────────────────────────────────
// window.electrobunAPI is typed by the single `ElectrobunAPI`
// contract from @xnlc/types (ElectrobunAPIExplicit & ElectrobunAPIExtra).
// Архив чатов: agentSetArchived объявлен в @xnlc/types.
// Xneon Agent: agentComplete/agentCancel, история чатов, файлы сборок и onAgentDelta
// также объявлены в этом едином контракте.
// Выбор медиафайлов темы: pickThemeMedia — из того же контракта.
// Облачные архивы тем: cloudUploadTheme/cloudImportTheme — из @xnlc/types.
// Локальная папка тем, импорт/экспорт и наблюдение: LocalTheme* — из @xnlc/types.
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
    electrobunAPI?: ElectrobunAPI
  }

  // Re-export types as globals for backward compatibility
  // Components should migrate to importing from @xnlc/types directly
  type ImportableLauncherInstance = import('@xnlc/types').ImportableLauncherInstance
  type LauncherNewsEntry = import('@xnlc/types').LauncherNewsEntry
  type BuildLoaderRequirementIssue = import('@xnlc/types').BuildLoaderRequirementIssue
  type BuildLoaderRequirementReport = import('@xnlc/types').BuildLoaderRequirementReport
}

// Серверные датапаки: mcServerDatapacksList/Install/Delete описаны в общем ElectrobunAPI.
