import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import type { Account } from "@/src/AccountsContext"
import { useLaunchControls } from "@/src/LaunchLogsContext"

export type BuildLaunchParams = {
  name: string
  version: string
  modLoader: string
  loaderVersion?: string
  intentPath?: string
  javaOverride?: boolean
  javaPath?: string
  javaArgs?: string
  memoryMin?: string
  memoryMax?: string
  windowOverride?: boolean
  windowWidth?: number
  windowHeight?: number
  serverOverride?: boolean
  server?: string
  serverPort?: string
}

export function saveLastLaunchedPrefs(version: string, modLoader: string, loaderVersion?: string) {
  try {
    localStorage.setItem("xneon-launcher:lastVersion", version)
    localStorage.setItem("xneon-launcher:lastModLoader", modLoader)
    if (loaderVersion) localStorage.setItem("xneon-launcher:lastLoaderVersion", loaderVersion)
    else localStorage.removeItem("xneon-launcher:lastLoaderVersion")
  } catch {
    // ignore storage errors
  }
}

export function normalizeJavaPath(javaPath?: string) {
  if (!javaPath) return javaPath
  return javaPath.replace(/(^|[\\/])javaw\.exe$/i, "$1java.exe")
}

export function formatLoaderLabel(modLoader: string, loaderVersion?: string) {
  return loaderVersion ? `${modLoader} ${loaderVersion}` : modLoader
}

type LaunchSettings = {
  authlibEnabled: string | undefined
  savedJavaArgs: string | undefined
  savedMemoryMin: string | undefined
  savedMemoryMax: string | undefined
  savedUseCustomRes: string | undefined
  savedCustomW: string | undefined
  savedCustomH: string | undefined
  savedResLabel: string | undefined
  savedAutoJoinServer: string | undefined
  savedServer: string | undefined
  savedServerPort: string | undefined
}

export async function loadLaunchSettings(): Promise<LaunchSettings> {
  const api = window.electronAPI
  if (!api) {
    return { authlibEnabled: undefined, savedJavaArgs: undefined, savedMemoryMin: undefined, savedMemoryMax: undefined, savedUseCustomRes: undefined, savedCustomW: undefined, savedCustomH: undefined, savedResLabel: undefined, savedAutoJoinServer: undefined, savedServer: undefined, savedServerPort: undefined }
  }
  const [
    authlibEnabled,
    savedJavaArgs,
    savedMemoryMin,
    savedMemoryMax,
    savedUseCustomRes,
    savedCustomW,
    savedCustomH,
    savedResLabel,
    savedAutoJoinServer,
    savedServer,
    savedServerPort,
  ] = await Promise.all([
    api.getSetting("authlibInjectorEnabled"),
    api.getSetting("javaArgs"),
    api.getSetting("memoryMin"),
    api.getSetting("memoryMax"),
    api.getSetting("useCustomResolution"),
    api.getSetting("customWidth"),
    api.getSetting("customHeight"),
    api.getSetting("selectedResolution"),
    api.getSetting("autoJoinServer"),
    api.getSetting("server"),
    api.getSetting("serverPort"),
  ])
  return { authlibEnabled, savedJavaArgs, savedMemoryMin, savedMemoryMax, savedUseCustomRes, savedCustomW, savedCustomH, savedResLabel, savedAutoJoinServer, savedServer, savedServerPort }
}

function resolveLaunchDimensions(settings: LaunchSettings): { width: number; height: number } {
  let launchWidth = 1280
  let launchHeight = 720
  if (settings.savedUseCustomRes === "true" && settings.savedCustomW && settings.savedCustomH) {
    launchWidth = parseInt(settings.savedCustomW, 10) || 1280
    launchHeight = parseInt(settings.savedCustomH, 10) || 720
  } else if (settings.savedResLabel) {
    const match = settings.savedResLabel.match(/(\d+)\s*x\s*(\d+)/i)
    if (match) {
      launchWidth = parseInt(match[1], 10) || 1280
      launchHeight = parseInt(match[2], 10) || 720
    }
  }
  return { width: launchWidth, height: launchHeight }
}

export { resolveLaunchDimensions }

export function useBuildLaunch({ account }: { account?: Account }) {
  const { t } = useTranslation()
  const { isRunning, setIsRunning, clearLogs, addLog, launchUi, patchLaunchUi } = useLaunchControls()

  const launchInstance = useCallback(async (build: BuildLaunchParams) => {
    if (!account || !window.electronAPI) return

    const usesSkinInjector = account.type === "xnskins" || account.type === "elyby"
    const settings = await loadLaunchSettings()
    const buildWindow = build.windowOverride === true && build.windowWidth && build.windowHeight
    const { width, height } = buildWindow
      ? { width: build.windowWidth, height: build.windowHeight }
      : resolveLaunchDimensions(settings)
    const intentPath = await window.electronAPI.getBuildIntentPath(build.name) ?? ""

    // Per-build auto-join server override (falls back to global launcher settings)
    const useBuildServer = build.serverOverride === true
    const server = useBuildServer
      ? (build.server ?? "")
      : (settings.savedAutoJoinServer === "true" ? (settings.savedServer ?? "") : "")
    const serverPort = useBuildServer
      ? (build.serverPort ?? "")
      : (settings.savedServerPort ?? "")
    const serverEnabled = !!server.trim()

    // Per-build Java override (memory, java path, extra JVM args)
    const useBuildJava = build.javaOverride === true
    const memoryMin = useBuildJava && build.memoryMin ? build.memoryMin : settings.savedMemoryMin || "512M"
    const memoryMax = useBuildJava && build.memoryMax ? build.memoryMax : settings.savedMemoryMax || "4G"
    const buildJavaPath = useBuildJava && build.javaPath ? build.javaPath : undefined
    const normalizedJavaPath = normalizeJavaPath(buildJavaPath ?? await window.electronAPI.getSetting("javaPath"))
    const javaArgs = useBuildJava
      ? (build.javaArgs ?? "")
      : (settings.savedJavaArgs ?? "")

    patchLaunchUi({
      isLaunching: true,
      progress: 0,
      status: t("launcherStatus.preparing"),
      phase: "launching",
      downloadedBytes: 0,
      totalBytes: null,
      currentFile: null,
      totalFiles: null,
      currentFileName: null,
    })
    clearLogs()
    addLog(`[Запуск] Сборка ${build.name} · ${formatLoaderLabel(build.modLoader, build.loaderVersion)} · ${account.username}`)

    const result = await window.electronAPI.launchMinecraft({
      version: build.version,
      modLoader: build.modLoader as "vanilla" | "forge" | "fabric" | "quilt" | "liteloader" | "optifine" | "neoforge",
      ...(build.loaderVersion ? { loaderVersion: build.loaderVersion } : {}),
      account: { type: account.type, username: account.username, uuid: account.uuid, accessToken: account.accessToken },
      memory: { min: memoryMin, max: memoryMax },
      width,
      height,
      authlibInjectorEnabled: usesSkinInjector && settings.authlibEnabled !== "false",
      retroauthInjectorEnabled: usesSkinInjector,
      buildName: build.name,
      gameDir: intentPath,
      ...(normalizedJavaPath ? { javaPath: normalizedJavaPath } : {}),
      ...(javaArgs ? { javaArgs } : {}),
      ...(serverEnabled ? { server: server.trim(), serverPort: serverPort.trim() || "25565" } : {}),
    })

    patchLaunchUi(result.success
      ? { isLaunching: false, phase: "idle", progress: 100, status: t("launcherStatus.running") }
      : { isLaunching: false, status: result.error ?? "Ошибка запуска" })
    if (!result.success) addLog(`[Лаунчер] ${result.error ?? "Ошибка запуска"}`, "error")
    if (result.success) {
      setIsRunning(true)
      saveLastLaunchedPrefs(build.name, "instance")
    }
  }, [account, addLog, clearLogs, patchLaunchUi, setIsRunning, t])

  return { isRunning, launchUi, launchInstance }
}
