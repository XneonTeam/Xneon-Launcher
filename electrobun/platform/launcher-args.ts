import { readWindowsLauncherArgs } from "./windows-native"
import { readUnixLauncherArgs } from "./unix-launcher-args"

export async function readLauncherArgs(): Promise<string[]> {
  return process.platform === "win32" ? readWindowsLauncherArgs() : readUnixLauncherArgs()
}
