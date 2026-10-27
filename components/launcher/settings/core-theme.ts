import type { Theme, ThemeColorKey } from "./types"

/** Нейтральные тёмные поверхности разной глубины и один оранжевый акцент. */
const palette: Record<ThemeColorKey, string> = {
  background: "#000000",
  foreground: "#f0f0f0",
  card: "#070707",
  cardForeground: "#f0f0f0",
  muted: "#0d0d0d",
  mutedForeground: "#ababab",
  border: "#1c1c1c",
  input: "#111111",
  primary: "#f64b00",
  primaryForeground: "#090909",
  accent: "#f64b00",
  accentForeground: "#090909",
  ring: "#f64b00",
  sidebar: "#030303",
  sidebarForeground: "#bcbcbc",
  sidebarPrimary: "#f64b00",
  sidebarPrimaryForeground: "#090909",
  sidebarAccent: "#f64b00",
  sidebarAccentForeground: "#090909",
  sidebarBorder: "#171717",
}

/** Эти правила живут в CSS темы и целиком снимаются при переключении пресета. */
const css = `
:root {
  --ambient-primary: transparent;
  --ambient-accent: transparent;
}

#settings-page .settings-nav {
  background: var(--card);
  border-color: var(--border);
}

:where(#launcher-content, .launcher-modal-overlay) :is(button, a)[class~="bg-primary"],
#settings-page .settings-nav-item[data-active="true"] {
  box-shadow: 0 2px 5px #00000040;
}

#launcher-sidebar .sidebar-item-btn[data-active="true"] {
  background: color-mix(in oklab, var(--primary) 10%, var(--sidebar));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 28%, var(--sidebar));
}

#settings-page .settings-java-list > button:hover,
#settings-page [data-component="settings-versions"] > label:hover {
  background: color-mix(in oklab, var(--foreground) 3%, var(--card));
}
#settings-page [data-component="theme-card"][data-selected="true"] {
  background: color-mix(in oklab, var(--primary) 3%, var(--card));
  border-color: color-mix(in oklab, var(--primary) 75%, var(--border));
}
`

export const CORE_THEME: Pick<Theme, "palette" | "appearance" | "glow" | "css"> = {
  palette,
  glow: {
    primary: { color: "#f64b00", alpha: 0 },
    accent: { color: "#f64b00", alpha: 0 },
  },
  appearance: {
    radius: 12,
    titlebar: "#030303",
  },
  css,
}
