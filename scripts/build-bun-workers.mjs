import { mkdir, rm } from "node:fs/promises"
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
if (status !== 0) process.exit(status ?? 1)
if (process.platform === "linux" || process.platform === "darwin") {
  const helper = spawnSync(process.execPath, ["build", "./electrobun/main/unix-update-helper-entry.ts", "--target=bun", "--format=cjs", "--outfile=dist-workers/unix-update-helper.js"], { stdio: "inherit" })
  if (helper.error) throw helper.error
  process.exitCode = helper.status ?? 1
} else {
  // Кэш Unix-сборки не должен протащить helper в неизменяемый Windows payload.
  await rm("dist-workers/unix-update-helper.js", { force: true })
}
