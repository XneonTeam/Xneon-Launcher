import { build } from "vite"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs/promises"
import path from "node:path"
const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, "..")
const output = path.join(root, ".tmp", "theme-rendering")
await fs.mkdir(path.join(output, "profile"), { recursive: true })
await build({ configFile: path.join(root, "vite.config.mts"), logLevel: "error", build: { outDir: path.join(output, "dist"), copyPublicDir: false, rolldownOptions: { input: path.join(root, "scripts/fixtures/theme-rendering/index.html") } } })
const report = path.join(output, "report.json")
await fs.rm(report, { force: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require("electron"), [path.join(root, "scripts/fixtures/theme-rendering/main.cjs"), path.join(output, "dist/scripts/fixtures/theme-rendering/index.html"), report, path.join(output, "profile")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
let diagnostics = ""
child.stdout.on("data", data => { diagnostics += data.toString() })
child.stderr.on("data", data => { diagnostics += data.toString() })
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve) })
const result = JSON.parse(await fs.readFile(report, "utf8").catch(() => { throw new Error(`Electron exited (${code}) before reporting: ${diagnostics}`) }))
for (const check of result.checks ?? []) console.log("✓ " + check)
if (code || !result.passed) throw new Error(result.error || "Theme rendering failed")
console.log(`Проверок в Electron пройдено: ${result.checks.length}`)
