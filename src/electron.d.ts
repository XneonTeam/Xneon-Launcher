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
    electronAPI?: ElectronAPI & LauncherExtraElectronAPI
  }

  // Re-export types as globals for backward compatibility
  // Components should migrate to importing from @xnlc/types directly
  type ImportableLauncherInstance = import('@xnlc/types').ImportableLauncherInstance

  interface BuildLoaderRequirementIssue {
    fileName: string
    /** Имя мода из его метаданных, если удалось прочитать */
    modName?: string
    modId?: string
    /** Загрузчик, к которому относится требование */
    loaderId: string
    /** Диапазон версий из метаданных мода (как записан в JAR) */
    requirement: string
    /** Версия загрузчика в сборке */
    buildLoaderVersion?: string
    satisfied: boolean
    reason?: string
  }

  interface BuildLoaderRequirementReport {
    /** Профиль загрузчика сборки, к которому относятся требования */
    loaderId: string
    loaderVersion?: string
    /** Моды, объявившие требование к версии текущего загрузчика */
    issues: BuildLoaderRequirementIssue[]
    /** Сколько JAR-файлов удалось прочитать */
    checked: number
  }
}

/**
 * Каналы, которых ещё нет в опубликованном `@xnlc/types` (источник истины —
 * `packages/xnlc-types/src/ipc-contracts.ts`). Держим их здесь, чтобы рендерер
 * типизировался и до пересборки локального пакета.
 */
export interface LauncherExtraElectronAPI {
  /** Удаляет из папки сборки профили загрузчиков, не совпадающие с выбором. */
  pruneLoaderProfiles: (
    buildName: string,
    modLoader?: string,
    loaderVersion?: string,
  ) => Promise<{ removed: string[]; kept: string[] }>
  /** Требования модов сборки к версии загрузчика (читаются из самих JAR). */
  checkBuildLoaderRequirements: (
    buildName: string,
    modLoader?: string,
    loaderVersion?: string,
  ) => Promise<BuildLoaderRequirementReport>
}