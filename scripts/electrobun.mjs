import { spawnSync } from "node:child_process"

const hutch = process.env.XNEON_HUTCH_EXECUTABLE || "hutch"
const args = process.argv.slice(2)
const envIndex = args.indexOf("--env")
const channel = args.find(arg => arg.startsWith("--env="))?.slice(6)
  ?? (envIndex < 0 ? undefined : args[envIndex + 1])
  ?? "stable"
if (!["stable", "canary", "dev"].includes(channel)) throw new Error("Invalid build channel: " + channel)
const result = spawnSync(hutch, ["electrobun", ...args], {
  stdio: "inherit",
  env: { ...process.env, XNEON_ARTIFACT_CHANNEL: channel },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1

if (process.exitCode === 0 && args[0] === "build" && channel !== "dev") {
  const normalized = spawnSync(process.execPath, ["scripts/normalize-update-artifacts.ts", channel], { stdio: "inherit" })
  if (normalized.error) throw normalized.error
  process.exitCode = normalized.status ?? 1
}

if (process.exitCode === 0 && process.platform === "win32" && args[0] === "build" && channel !== "dev") {
  // NSIS нужен обоим каналам: это единственный способ сменить канал из приложения,
  // потому что SDK не принимает манифест другого канала.
  const installer = spawnSync(process.execPath, ["scripts/build-windows-distribution.ts", channel], { stdio: "inherit" })
  if (installer.error) throw installer.error
  process.exitCode = installer.status ?? 1
}
