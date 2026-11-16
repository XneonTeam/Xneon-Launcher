import { readdirSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
for (const directory of readdirSync("packages").sort()) {
  const config = `packages/${directory}/tsconfig.json`
  if (!existsSync(config)) continue
  console.log("Typecheck:", directory)
  const result = spawnSync(process.execPath, ["--bun", "run", "tsc", "--noEmit", "-p", config], { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
