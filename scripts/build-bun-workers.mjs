import { mkdir } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

await mkdir("dist-workers", { recursive: true })
const sources = [
  "./electrobun/main/minecraft-launch-worker.ts",
  "./electrobun/main/archives/archive.worker.ts",
  "./packages/xnlc-parser/src/scan-worker.ts",
]
const { status, error } = spawnSync(process.execPath, ["build", ...sources, "--target=bun", "--format=cjs", "--outdir=dist-workers", "--entry-naming=[name].js", `--define=XNLC_APPLICATION_USER_AGENT:${JSON.stringify(`Xneon-Launcher/${version}`)}`], {
  stdio: "inherit",
})
if (error) throw error
process.exitCode = status ?? 1
