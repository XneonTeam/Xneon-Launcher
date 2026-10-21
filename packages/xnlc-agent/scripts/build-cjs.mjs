import { cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
const require = createRequire(import.meta.url)
const root = new URL("../", import.meta.url)
const source = new URL("lib-cjs/.source/", root)
mkdirSync(source, { recursive: true })
cpSync(new URL("src/", root), source, { recursive: true })
writeFileSync(new URL("package.json", source), JSON.stringify({ type: "commonjs" }))
try {
  const result = spawnSync(process.execPath, [resolve(dirname(require.resolve("typescript")), "../bin/tsc"), "-p", "tsconfig.cjs.json"], { cwd: fileURLToPath(root), stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status) process.exitCode = result.status
  else writeFileSync(new URL("lib-cjs/package.json", root), JSON.stringify({ type: "commonjs" }))
} finally { rmSync(source, { recursive: true, force: true }) }
