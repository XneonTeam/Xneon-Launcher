import { lstatSync, mkdirSync } from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { lockLauncherProfile } from "../platform/instance-lock"
import { readLauncherArgs } from "../platform/launcher-args"
import { cli, forwardCli, parseCliLaunch, startCliListener } from "./cli"
import { getDefaultLauncherDataRoot, isPortable, launcherLocationConfig } from "./profile-path"

/**
 * Флаги WebView2, которые Electron-сборка выставляла через
 * `app.commandLine.appendSwitch` (см. `electron/main/window.ts`).
 * `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` читается native-слоем при создании
 * первого окна, поэтому выставлять его нужно до `import("./index")`.
 */
const WEBVIEW2_SWITCHES = [
  // Chromium 121+ на Windows рисует «Fluent»-скроллбары, а overlay-режим
  // игнорирует `::-webkit-scrollbar` — в читалке новостей скроллбар выглядел
  // чужим. Отключаем оба варианта, как в Electron.
  "--disable-features=FluentScrollbar,FluentOverlayScrollbars",
  // В dev-режиме Chromium не имеет доступа к каталогу кеша шейдеров и сыплет ошибками.
  "--disable-gpu-shader-disk-cache",
]

/**
 * Дописывает флаги к уже заданным аргументам WebView2, сливая списки
 * `--disable-features`, чтобы не затереть значения, выставленные снаружи.
 */
function appendWebView2Arguments() {
  if (process.platform !== "win32") return
  const existing = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.trim() ?? ""
  const merged: string[] = []
  const disabledFeatures = new Set<string>()
  for (const token of [existing, ...WEBVIEW2_SWITCHES].join(" ").split(/\s+/).filter(Boolean)) {
    if (token.startsWith("--disable-features=")) {
      for (const feature of token.slice("--disable-features=".length).split(",")) if (feature) disabledFeatures.add(feature)
      continue
    }
    if (!merged.includes(token)) merged.push(token)
  }
  if (disabledFeatures.size > 0) merged.push(`--disable-features=${[...disabledFeatures].join(",")}`)
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = merged.join(" ")
}

async function quitNative(code: number) {
  const { Utils } = await import("electrobun/main")
  Utils.quit(code)
}

async function start() {
  appendWebView2Arguments()
  if (isPortable) {
    const profile = getDefaultLauncherDataRoot()
    mkdirSync(profile, { recursive: true })
    if (!lstatSync(profile).isDirectory()) throw new Error("PortableProfile must be a local directory")
    process.env.WEBVIEW2_USER_DATA_FOLDER = path.join(profile, "WebView2")
  }
  const primary = lockLauncherProfile(launcherLocationConfig)
  if (primary) await startCliListener(launcherLocationConfig)

  const args = process.argv.slice(2)
  const build = parseCliLaunch(args.includes("--launch") ? args : await readLauncherArgs())
  if (!primary) {
    await forwardCli(launcherLocationConfig, build)
    await quitNative(0)
    return
  }
  if (!isPortable && process.platform === "win32" && process.arch === "x64") {
    try {
      const { Updater } = await import("electrobun/main")
      const local = await Updater.getLocalInfo()
      if (local.channel === "stable" || local.channel === "canary") {
        const { launcherUpdateState } = await import("./update-state")
        const { resumeDeferredUpdate } = await import("./update-startup")
        if (await resumeDeferredUpdate({
          local: { ...local, channel: local.channel }, sdkRoot: () => Updater.appDataFolder(), store: launcherUpdateState,
          launchInstaller: async file => {
            const child = spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" })
            await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
            child.unref()
          },
          applySdk: async () => {
            let restarting = false
            Updater.onStatusChange(({ status }) => { if (status === "launching-new-version") restarting = true })
            await Updater.applyUpdate()
            if (!restarting) throw new Error(Updater.updateInfo().error || "Deferred update restart did not start")
          },
          quit: () => quitNative(0), onError: error => console.error("[Updater] Deferred update was not applied", error),
        })) return
      }
    } catch (error) {
      // Повреждённый кэш обновлений не должен мешать открыть рабочий лаунчер.
      console.error("[Updater] Could not inspect deferred update", error)
    }
  }
  if (build) cli.enqueue(build, error => { if (error) console.error("[CLI]", error) })
  await import("./index")
}

void start().catch(async error => {
  console.error("[Launcher]", error instanceof Error ? error.message : String(error))
  await quitNative(1)
})
