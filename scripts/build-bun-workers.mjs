import { mkdir } from "node:fs/promises"
import { spawnSync } from "node:child_process"

await mkdir("dist-workers", { recursive: true })
const sources = [
  "./electrobun/main/minecraft-launch-worker.ts",
  "./electrobun/main/archives/archive.worker.ts",
]
const { status, error } = spawnSync(process.execPath, ["build", ...sources, "--target=bun", "--format=cjs", "--outdir=dist-workers", "--entry-naming=[name].js"], {
  stdio: "inherit",
})
if (error) throw error
process.exitCode = status ?? 1
