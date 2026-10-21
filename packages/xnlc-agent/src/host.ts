import type { ElectronAPI, Theme, ThemeColorKey } from "@xnlc/types"

export interface AgentLaunchSettings {
  authlibEnabled?: string; savedJavaArgs?: string; savedMemoryMin?: string; savedMemoryMax?: string;
  savedUseCustomRes?: string; savedCustomW?: string; savedCustomH?: string; savedResLabel?: string;
  savedAutoJoinServer?: string; savedServer?: string; savedServerPort?: string
}
/** Адаптер приложения: пакет не импортирует Electron, React, БД или модули лаунчера. */
export interface AgentHost {
  api(): ElectronAPI
  translate(key: string, values?: Record<string, unknown>): string
  language(): string
  emit(name: string, detail?: unknown): void
  launch: {
    loadLaunchSettings(): Promise<AgentLaunchSettings>
    normalizeJavaPath(path?: string): string | undefined
    resolveLaunchDimensions(settings: AgentLaunchSettings): { width: number; height: number }
    saveLastLaunchedPrefs(version: string, modLoader: string, loaderVersion?: string): void
  }
  themes: {
    presets: Theme[]
    createCustomTheme(name: string, base?: Theme | null, existingIds?: string[]): Theme
    duplicateTheme(theme: Theme, name: string, existingIds?: string[]): Theme
    parseThemes(raw: string | null | undefined): Theme[]
    serializeThemes(themes: Theme[]): string
    sanitizeTheme(value: unknown): Theme | null
    normalizeHex(value: unknown): string | null
    themePreviewColors(theme: Theme): Record<ThemeColorKey, string>
  }
}
let host: AgentHost | undefined
export function configureAgentHost(value: AgentHost) { host = value }
export function getAgentHost(): AgentHost { if (!host) throw new Error("Agent host is not configured"); return host }
export const THEME_COLOR_KEYS: ThemeColorKey[] = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "muted",
  "mutedForeground",
  "border",
  "input",
  "primary",
  "primaryForeground",
  "accent",
  "accentForeground",
  "ring",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
]
export const loadLaunchSettings = () => getAgentHost().launch.loadLaunchSettings()
export const normalizeJavaPath = (path?: string) => getAgentHost().launch.normalizeJavaPath(path)
export const resolveLaunchDimensions = (settings: AgentLaunchSettings) => getAgentHost().launch.resolveLaunchDimensions(settings)
export const saveLastLaunchedPrefs = (version: string, loader: string, loaderVersion?: string) => getAgentHost().launch.saveLastLaunchedPrefs(version, loader, loaderVersion)
export const createCustomTheme: AgentHost["themes"]["createCustomTheme"] = (...args) => getAgentHost().themes.createCustomTheme(...args)
export const duplicateTheme: AgentHost["themes"]["duplicateTheme"] = (...args) => getAgentHost().themes.duplicateTheme(...args)
export const parseThemes: AgentHost["themes"]["parseThemes"] = (...args) => getAgentHost().themes.parseThemes(...args)
export const serializeThemes: AgentHost["themes"]["serializeThemes"] = (...args) => getAgentHost().themes.serializeThemes(...args)
export const sanitizeTheme: AgentHost["themes"]["sanitizeTheme"] = (...args) => getAgentHost().themes.sanitizeTheme(...args)
export const normalizeHex: AgentHost["themes"]["normalizeHex"] = (...args) => getAgentHost().themes.normalizeHex(...args)
export const themePreviewColors: AgentHost["themes"]["themePreviewColors"] = (...args) => getAgentHost().themes.themePreviewColors(...args)
