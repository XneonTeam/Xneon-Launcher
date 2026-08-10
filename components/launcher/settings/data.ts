import type { Theme, Resolution } from "./types"

export const presetThemes: Theme[] = [
  {
    id: "orange", name: "Core",
    primary: "#f97316", accent: "#fbbf24", background: "#18181b",
    primaryOklch: "0.65 0.22 40", accentOklch: "0.75 0.18 75", backgroundOklch: "0.08 0.01 260",
  },
  {
    id: "neon", name: "Violet",
    primary: "#9C27B0", accent: "#E040FB", background: "#0d0d1a",
    primaryOklch: "0.52 0.27 300", accentOklch: "0.62 0.3 310", backgroundOklch: "0.10 0.02 270",
  },
  {
    id: "fire", name: "Blaze",
    primary: "#F44336", accent: "#FF9800", background: "#1a0a0a",
    primaryOklch: "0.58 0.24 25", accentOklch: "0.72 0.19 55", backgroundOklch: "0.11 0.02 30",
  },
  {
    id: "minecraft", name: "Verdant",
    primary: "#4CAF50", accent: "#8BC34A", background: "#1a1a2e",
    primaryOklch: "0.65 0.2 145", accentOklch: "0.72 0.18 130", backgroundOklch: "0.12 0.01 260",
  },
  {
    id: "ocean", name: "Aqua",
    primary: "#4A8FE7", accent: "#80CAFF", background: "#111419",
    primaryOklch: "0.62 0.18 245", accentOklch: "0.80 0.12 240", backgroundOklch: "0.09 0.015 250",
  },
  {
    id: "gold", name: "Solar",
    primary: "#FFC107", accent: "#FF9800", background: "#1a1509",
    primaryOklch: "0.80 0.17 85", accentOklch: "0.72 0.19 55", backgroundOklch: "0.12 0.02 80",
  },
  {
    id: "rose", name: "Rose",
    primary: "#E91E63", accent: "#FF4081", background: "#1a0a12",
    primaryOklch: "0.55 0.27 355", accentOklch: "0.65 0.28 350", backgroundOklch: "0.11 0.02 340",
  },
  {
    id: "arctic", name: "Arctic",
    primary: "#78909C", accent: "#B0BEC5", background: "#0f1318",
    primaryOklch: "0.58 0.04 230", accentOklch: "0.78 0.02 230", backgroundOklch: "0.09 0.01 240",
  },
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
  root.style.setProperty("--background", `oklch(${theme.backgroundOklch})`)
  root.style.setProperty("--sidebar", `oklch(${theme.backgroundOklch})`)
}
