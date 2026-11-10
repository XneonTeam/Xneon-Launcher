import { lockLauncherProfile } from "../platform/instance-lock"
import { readWindowsLauncherArgs } from "../platform/windows-native"
import { cli, forwardCli, parseCliLaunch, startCliListener } from "./cli"
import { launcherLocationConfig } from "./profile-path"

async function quitNative(code: number) {
  const { Utils } = await import("electrobun/main")
  Utils.quit(code)
}

async function start() {
  const primary = lockLauncherProfile(launcherLocationConfig)
  if (primary && process.platform === "win32") await startCliListener(launcherLocationConfig)

  const args = process.argv.slice(2)
  const build = parseCliLaunch(args.includes("--launch") ? args : await readWindowsLauncherArgs())
  if (!primary) {
    await forwardCli(launcherLocationConfig, build)
    await quitNative(0)
    return
  }
  if (build) cli.enqueue(build, error => { if (error) console.error("[CLI]", error) })
  await import("./index")
}

void start().catch(async error => {
  console.error("[Launcher]", error instanceof Error ? error.message : String(error))
  await quitNative(1)
})
