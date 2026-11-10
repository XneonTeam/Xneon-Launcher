import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const cwd = fileURLToPath(new URL("../", import.meta.url))
for (const args of [["install", "--frozen-lockfile"], ["run", "--filter", "@xnlc/*", "build"]]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
