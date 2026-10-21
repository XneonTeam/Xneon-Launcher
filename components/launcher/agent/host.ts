import { configureAgentHost } from "@xnlc/agent/host"
import i18n from "@/src/i18n"
import * as launch from "@/src/hooks/use-build-launch"
import * as themes from "../settings/theme-model"
import { presetThemes } from "../settings/data"
configureAgentHost({
  api: () => { if (!window.electronAPI) throw new Error("Electron API unavailable"); return window.electronAPI },
  language: () => i18n.language || "ru",
  translate: (key, values) => String(i18n.t(key, values)),
  emit: (name, detail) => { window.dispatchEvent(new CustomEvent(name, { detail })) },
  launch,
  themes: { ...themes, presets: presetThemes },
})
