export type SettingsTab = "game" | "java" | "themes" | "language" | "about"

export interface Theme {
  id: string
  name: string
  primary: string
  accent: string
  background: string
  primaryOklch: string
  accentOklch: string
  backgroundOklch: string
}

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
}
