export type SettingsTab = "game" | "java" | "themes" | "language" | "ai" | "storage" | "about"

export type { Theme, ThemeColorKey, ThemeGlow, ThemeFont, ThemeBackground, ThemeAppearance } from "@xnlc/types"
export interface Resolution {
  label: string
  width: number
  height: number
}

export interface Language {
  id: string
  name: string
  nativeName: string
  flagSvg: React.ReactNode
}

export interface JavaInstallation {
  path: string
  version: string
  label: string
  fullVersion?: string
  vendor?: string
  arch?: string
}
