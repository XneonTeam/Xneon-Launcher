import type { Theme, Resolution } from "./types"

/**
 * Темы меняют только акцент (primary/accent), фон окна общий для всех —
 * поэтому у темы нет собственного background.
 */
export const presetThemes: Theme[] = [
  { id: "orange", name: "Core", primary: "#f97316", accent: "#fbbf24", primaryOklch: "0.65 0.22 40", accentOklch: "0.75 0.18 75" },
  { id: "neon", name: "Violet", primary: "#9C27B0", accent: "#E040FB", primaryOklch: "0.52 0.27 300", accentOklch: "0.62 0.3 310" },
  { id: "fire", name: "Blaze", primary: "#F44336", accent: "#FF9800", primaryOklch: "0.58 0.24 25", accentOklch: "0.72 0.19 55" },
  { id: "minecraft", name: "Verdant", primary: "#4CAF50", accent: "#8BC34A", primaryOklch: "0.65 0.2 145", accentOklch: "0.72 0.18 130" },
  { id: "ocean", name: "Aqua", primary: "#4A8FE7", accent: "#80CAFF", primaryOklch: "0.62 0.18 245", accentOklch: "0.80 0.12 240" },
  { id: "gold", name: "Solar", primary: "#FFC107", accent: "#FF9800", primaryOklch: "0.80 0.17 85", accentOklch: "0.72 0.19 55" },
  { id: "rose", name: "Rose", primary: "#E91E63", accent: "#FF4081", primaryOklch: "0.55 0.27 355", accentOklch: "0.65 0.28 350" },
  { id: "arctic", name: "Arctic", primary: "#78909C", accent: "#B0BEC5", primaryOklch: "0.58 0.04 230", accentOklch: "0.78 0.02 230" },
]

export const presetResolutions: Resolution[] = [
  { label: "1920x1080 (Full HD)", width: 1920, height: 1080 },
  { label: "2560x1440 (2K)", width: 2560, height: 1440 },
  { label: "3840x2160 (4K)", width: 3840, height: 2160 },
  { label: "1366x768", width: 1366, height: 768 },
  { label: "1280x720 (HD)", width: 1280, height: 720 },
]

export const settingsTabs: { id: import("./types").SettingsTab; labelKey: string; icon: string }[] = [
  { id: "game", labelKey: "settings.tab.game", icon: "IconDeviceGamepad2" },
  { id: "java", labelKey: "settings.tab.java", icon: "IconCoffee" },
  { id: "themes", labelKey: "settings.tab.themes", icon: "IconPalette" },
  { id: "language", labelKey: "settings.tab.language", icon: "IconLanguage" },
  { id: "ai", labelKey: "settings.tab.ai", icon: "IconBrain" },
  { id: "storage", labelKey: "settings.tab.storage", icon: "IconDatabase" },
  { id: "about", labelKey: "settings.tab.about", icon: "IconInfoCircle" },
]

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.style.setProperty("--primary", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--ring", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--sidebar-primary", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--sidebar-ring", `oklch(${theme.primaryOklch})`)
  root.style.setProperty("--glow-primary", `oklch(${theme.primaryOklch} / 0.4)`)
  root.style.setProperty("--accent", `oklch(${theme.accentOklch})`)
  root.style.setProperty("--sidebar-accent", `oklch(${theme.accentOklch})`)
  root.style.setProperty("--glow-accent", `oklch(${theme.accentOklch} / 0.4)`)
  root.style.removeProperty("--background")
  root.style.removeProperty("--sidebar")
}
