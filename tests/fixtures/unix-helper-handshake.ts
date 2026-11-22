import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

// Только fixture протокола: не заменяет приложение, не является native update E2E.
const file = Bun.argv[2], directory = path.dirname(file), job = JSON.parse(await readFile(file, "utf8"))
await writeFile(path.join(directory, "ready.json"), JSON.stringify({ schemaVersion: 1, nonce: job.nonce, pid: process.pid }), { mode: 0o600 })
const deadline = performance.now() + 10_000
while (performance.now() < deadline) {
  if (await Bun.file(path.join(directory, "fixture-finish")).exists()) break
  await Bun.sleep(20)
}
await writeFile(path.join(directory, "result.json"), JSON.stringify({ nonce: job.nonce, status: "protocol-fixture-only" }), { mode: 0o600 })
