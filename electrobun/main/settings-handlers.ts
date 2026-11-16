import { rpcRegistry } from "../platform/ipc"
import { dbHelpers } from "../db"
import { writeStartupTheme } from "./startup-theme"
import { sendToRenderer } from "./runtime"
import { selectLiveopsTheme } from "./liveops"
import { EVENT_THEME_SETTING, SELECTED_THEME_SETTING, LIVEOPS_AUTO_APPLY_SETTING, refFromThemeId } from "../../lib/liveops-theme-refs"

const privateAiSettings = new Set(["aiApiKey", "aiEndpoint", "aiModel", "aiProtocol", "aiModels", "accounts.legacyImported"])

export function registerSettingsHandlers(): void {
  rpcRegistry.handle("settings:get", async (_event, key: string) => {
    if (typeof key !== "string" || privateAiSettings.has(key)) return undefined
    return dbHelpers.getSetting(key)
  })
  rpcRegistry.handle("settings:get-many", async (_event, keys: string[]) => {
    if (!Array.isArray(keys) || keys.length > 128) throw new Error("Invalid settings keys")
    const allowed = [...new Set(keys)].filter(key => typeof key === "string" && !privateAiSettings.has(key))
    return Object.fromEntries(await Promise.all(allowed.map(async key => [key, await dbHelpers.getSetting(key)])))
  })
  rpcRegistry.handle("settings:set", async (_event, key: string, value: string) => {
    if (typeof key !== "string" || privateAiSettings.has(key)) throw new Error("Use the AI settings API")
    if (typeof value !== "string") throw new Error("Invalid setting value")
    if (key === LIVEOPS_AUTO_APPLY_SETTING && !["true", "false"].includes(value)) throw new Error("Expected true or false")
    if (key === "_startupThemeSnapshot") { writeStartupTheme(value); return }
    if (key === EVENT_THEME_SETTING) throw new Error("Event theme is managed by LiveOps")
    if (key === SELECTED_THEME_SETTING) {
      const ref = refFromThemeId(value)
      if (!ref) throw new Error("Invalid theme reference")
      await selectLiveopsTheme(ref)
      return
    }
    await dbHelpers.setSetting(key, value)
    sendToRenderer("settings:updated", { key, value })
  })
}
