import type { SharedLaunchSettings } from "@xnlc/share"

interface Account { id: string; type: string; username: string; uuid?: string; serverUrl?: string; isActive?: boolean }
export interface JavaInstallation { path: string; version: string; vendor?: string }
export interface LocalLaunchSettings {
  javaOverride?: boolean; javaPath?: string; javaArgs?: string; memoryMin?: string; memoryMax?: string
  windowOverride?: boolean; windowWidth?: number; windowHeight?: number; defaultAccountId?: string
  serverOverride?: boolean; server?: string; serverPort?: string; group?: string
  preLaunchCommand?: string; postLaunchCommand?: string; wrapperCommand?: string; customEnv?: string
}
const normalizedPath = (value: string) => {
  const path = value.replace(/\\/g, "/").replace(/javaw\.exe$/i, "java.exe")
  return /^[a-z]:/i.test(path) ? path.toLowerCase() : path
}
const major = (version: string) => Number(version.startsWith("1.") ? version.split(".")[1] : version.split(/[._+-]/)[0]) || undefined
const uuid = (value: string) => value.replace(/-/g, "").toLowerCase()
function matchingAccount(preference: SharedLaunchSettings["account"], accounts: Account[]) {
  if (!preference) return undefined
  return accounts.find(account => account.type === preference.type
    && (account.serverUrl ?? "").replace(/\/$/, "") === (preference.serverUrl ?? "").replace(/\/$/, "")
    && (preference.uuid && account.uuid ? uuid(account.uuid) === uuid(preference.uuid) : account.username.toLowerCase() === preference.username.toLowerCase()))
}
function matchingJava(preference: SharedLaunchSettings["java"], installations: JavaInstallation[]) {
  if (!preference) return undefined
  return installations.find(java => preference.path && normalizedPath(java.path) === normalizedPath(preference.path))
    ?? installations.find(java => preference.major && major(java.version) === preference.major && (!preference.vendor || java.vendor === preference.vendor))
    ?? installations.find(java => preference.major && major(java.version) === preference.major)
}

export function serializeLaunchSettings(build: LocalLaunchSettings, accounts: Account[], installations: JavaInstallation[], baseline?: SharedLaunchSettings): SharedLaunchSettings {
  const account = accounts.find(account => account.id === build.defaultAccountId)
    ?? (!build.defaultAccountId && !(baseline?.account && !matchingAccount(baseline.account, accounts)) ? accounts.find(account => account.isActive) : undefined)
  const selectedJava = installations.find(java => build.javaPath && normalizedPath(java.path) === normalizedPath(build.javaPath))
  const mappedJava = baseline?.java ? matchingJava(baseline.java, installations)?.path ?? "" : undefined
  const java = baseline?.java && normalizedPath(build.javaPath ?? "") === normalizedPath(mappedJava ?? "") ? baseline.java
    : build.javaPath ? { path: build.javaPath, ...(selectedJava && major(selectedJava.version) ? { major: major(selectedJava.version) } : {}), ...(selectedJava?.vendor ? { vendor: selectedJava.vendor } : {}) } : null
  return {
    serverOverride: build.serverOverride === true, server: build.server ?? "", serverPort: build.serverPort ?? "",
    group: build.group ?? "", preLaunchCommand: build.preLaunchCommand ?? "", postLaunchCommand: build.postLaunchCommand ?? "",
    wrapperCommand: build.wrapperCommand ?? "", customEnv: build.customEnv ?? "",
    javaOverride: build.javaOverride === true, memoryMin: build.memoryMin ?? "", memoryMax: build.memoryMax ?? "", javaArgs: build.javaArgs ?? "", java,
    windowOverride: build.windowOverride === true, windowWidth: build.windowWidth ?? null, windowHeight: build.windowHeight ?? null,
    account: account && baseline?.account && matchingAccount(baseline.account, accounts)?.id === account.id ? baseline.account
      : account ? { type: account.type, username: account.username, ...(account.uuid ? { uuid: account.uuid } : {}), ...(account.serverUrl ? { serverUrl: account.serverUrl } : {}) } : baseline?.account ?? null,
  }
}

/** Чужие ID аккаунтов и пути Java сопоставляются с уже имеющимися локальными записями. */
export function resolveLaunchSettings(preferences: SharedLaunchSettings, accounts: Account[], installations: JavaInstallation[]): LocalLaunchSettings {
  return {
    ...Object.fromEntries((["serverOverride", "server", "serverPort", "group", "preLaunchCommand", "postLaunchCommand", "wrapperCommand", "customEnv"] as const).filter(key => preferences[key] !== undefined).map(key => [key, preferences[key]])),
    javaOverride: preferences.javaOverride, javaArgs: preferences.javaArgs, memoryMin: preferences.memoryMin, memoryMax: preferences.memoryMax,
    javaPath: matchingJava(preferences.java, installations)?.path ?? "",
    windowOverride: preferences.windowOverride, windowWidth: preferences.windowWidth ?? undefined, windowHeight: preferences.windowHeight ?? undefined,
    defaultAccountId: matchingAccount(preferences.account, accounts)?.id ?? "",
  }
}
