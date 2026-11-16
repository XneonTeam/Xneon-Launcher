import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
const live = new Set(["real-world.test.ts"])
const integration = new Set(["adapter.test.ts", "cache-integration.test.ts", "launcher-scan-worker.test.ts"])

export function parserTestFiles(mode) {
  if (!["offline", "integration", "live"].includes(mode)) throw new Error("Unknown parser test suite: " + mode)
  const files = readdirSync(new URL("../packages/xnlc-parser/tests/", import.meta.url))
    .filter(file => file.endsWith(".test.ts"))
    .filter(file => mode === "live" ? live.has(file) : mode === "integration" ? integration.has(file) : !live.has(file) && !integration.has(file))
    .sort().map(file => "./packages/xnlc-parser/tests/" + file)
  if (!files.length) throw new Error("Empty parser test suite: " + mode)
  return files
}

if (import.meta.main) {
  const mode = process.argv[2] ?? "offline"
  // Сводку offline-gate собирает run-offline-tests.mjs; прямой запуск сюда не пишет.
  const junit = process.env.XNLC_PARSER_JUNIT
  const reporter = junit ? ["--reporter=junit", "--reporter-outfile=" + junit] : []
  const result = spawnSync(process.execPath, ["test", ...reporter, ...parserTestFiles(mode)], {
    cwd: root, stdio: "inherit", env: { ...process.env, XNLC_PARSER_LIVE_TESTS: mode === "live" ? "1" : "0" },
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
