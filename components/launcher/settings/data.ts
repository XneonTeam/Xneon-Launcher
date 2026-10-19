import type { Theme, Resolution } from "./types"

// `applyTheme` живёт в модели (`theme-model.ts`), но исторически импортируется
// из `./data` — реэкспорт сохраняет совместимость со всеми вызовами.
export { applyTheme } from "./theme-model"

/**
 * Встроенные темы меняют только акцент (primary/accent), фон окна общий —
 * поэтому у них нет собственной палитры. Полноценная палитра есть только
 * у кастомных тем из «Моих тем».
 */
export const presetThemes: Theme[] = [
  { id: "orange", name: "Core", primary: "#f64b00", accent: "#ef9900", primaryOklch: "0.65 0.22 40", accentOklch: "0.75 0.18 75" },
  { id: "neon", name: "Violet", primary: "#8611e8", accent: "#bc1eff", primaryOklch: "0.52 0.27 300", accentOklch: "0.62 0.3 310" },
  { id: "fire", name: "Blaze", primary: "#e60023", accent: "#fb7c00", primaryOklch: "0.58 0.24 25", accentOklch: "0.72 0.19 55" },
  { id: "minecraft", name: "Verdant", primary: "#11ad32", accent: "#7eba27", primaryOklch: "0.65 0.2 145", accentOklch: "0.72 0.18 130" },
  { id: "ocean", name: "Aqua", primary: "#008cea", accent: "#6fc8ff", primaryOklch: "0.62 0.18 245", accentOklch: "0.80 0.12 240" },
  { id: "gold", name: "Solar", primary: "#efb300", accent: "#fb7c00", primaryOklch: "0.80 0.17 85", accentOklch: "0.72 0.19 55" },
  { id: "rose", name: "Rose", primary: "#d90079", accent: "#fd00a6", primaryOklch: "0.55 0.27 355", accentOklch: "0.65 0.28 350" },
  { id: "arctic", name: "Arctic", primary: "#627f8e", accent: "#abbac2", primaryOklch: "0.58 0.04 230", accentOklch: "0.78 0.02 230" },
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
  { id: "ai", labelKey: "settings.tab.ai", icon: "IconRobot" },
  { id: "storage", labelKey: "settings.tab.storage", icon: "IconDatabase" },
  { id: "about", labelKey: "settings.tab.about", icon: "IconInfoCircle" },
]
