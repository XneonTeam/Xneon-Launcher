import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

let electronBinary

try {
  electronBinary = require("electron")
} catch (error) {
  console.error("[launch-electron-dev] Electron is not installed correctly in node_modules.")
  console.error("[launch-electron-dev] Reinstall dependencies and try again.")
  console.error(error)
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

// Отладочный порт включается только по явному запросу (ELECTRON_DEBUG_PORT):
// иначе второй инстанс падал на занятом 9222, а порт был открыт всегда.
const debugPort = (process.env.ELECTRON_DEBUG_PORT || "").trim()
const debugArgs = debugPort ? [`--remote-debugging-port=${debugPort}`] : []

const child = spawn(electronBinary, ["--no-deprecation", ...debugArgs, "."], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

child.on("error", (error) => {
  console.error("[launch-electron-dev] Failed to start Electron:", error)
  process.exit(1)
})
