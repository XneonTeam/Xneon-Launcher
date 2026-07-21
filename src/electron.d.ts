import type {
  ElectronAPIExplicit,
  ImportableLauncherInstance,
} from '@xnlc/types'

export {}

declare global {
  interface Window {
    electronAPI?: ElectronAPIExplicit
  }

  // Re-export types as globals for backward compatibility
  // Components should migrate to importing from @xnlc/types directly
  type ImportableLauncherInstance = import('@xnlc/types').ImportableLauncherInstance
}
