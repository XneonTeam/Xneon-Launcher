const prefix = "@instance/launchSettings/"
export function sharedSettingLabel(path: string, t: (key: string) => string): string {
  if (path.startsWith("@settings/")) return t(`serverHistory.setting.${path.slice(10)}`)
  return path.startsWith(prefix) ? t(`share.launchSettings.${path.slice(prefix.length)}`) : ["name", "description", "icon", "coverImage"].includes(path.slice("@instance/".length)) ? t(`share.instance.${path.slice("@instance/".length)}`) : t("share.flow.instanceSettings")
}
export function sharedSettingValue(path: string, value: string, t: (key: string) => string): string {
  if (path === "@settings/relayEnabled" && ["0", "1", "false", "true"].includes(value)) return t(value === "1" || value === "true" ? "share.launchSettings.enabled" : "share.launchSettings.disabled")
  if (!path.startsWith(prefix)) return value
  if (!value || value === "null") return t("share.launchSettings.default")
  if (value === "true" || value === "false") return t(value === "true" ? "share.launchSettings.enabled" : "share.launchSettings.disabled")
  if (path.endsWith("/java") || path.endsWith("/account")) {
    try {
      const setting = JSON.parse(value)
      return path.endsWith("/account") ? setting.username : setting.major ? `Java ${setting.major}${setting.vendor ? ` · ${setting.vendor}` : ""}` : setting.path || t("share.launchSettings.default")
    } catch { return value }
  }
  return value
}
