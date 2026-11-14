import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const files = [
  "lib/modrinth-metadata.ts",
  "electrobun/main/mc-server-handlers.ts",
  "electrobun/main/avatar.ts",
  "packages/xnlc-core/src/launch-utils.ts",
  "packages/xnlc-mods/src/modrinth-client.ts",
  "packages/xnlc-mods/src/ftb-client.ts",
  "packages/xnlc-servers/src/jar-downloader.ts",
  "packages/xnlc-share/src/sources.ts",
  "packages/xnlc-skins/src/laby/client.ts",
  "services/share/tests/live-modrinth.mjs",
]

for (const file of files) {
  test(`Единый User-Agent Xneon-Launcher/1.0.8: ${file}`, () => {
    const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
    const headers = [...source.matchAll(/["']User-Agent["']\s*:\s*["']([^"']+)["']/g)]
    for (const match of headers) assert.equal(match[1], "Xneon-Launcher/1.0.8")
    assert.ok(source.includes('"Xneon-Launcher/1.0.8"') || source.includes("'Xneon-Launcher/1.0.8'"))
    assert.doesNotMatch(source, /XNLauncher|XneonLauncher\/|Xneon-Launcher-Updater|Mozilla\/5\.0/)
  })
}
