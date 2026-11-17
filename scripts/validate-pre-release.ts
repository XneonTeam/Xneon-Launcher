import assert from "node:assert/strict"
import packageJson from "../package.json"
import { stageElectrobunRelease } from "./electrobun-artifacts"

const [input, output, channel = "stable"] = Bun.argv.slice(2)
assert.ok(input && output, "Usage: validate-pre-release <native-candidate> <new-output> [stable|canary]")
assert.ok(channel === "stable" || channel === "canary", "Unknown release channel: " + channel)
assert.equal(process.platform, "win32")
assert.equal(process.arch, "x64")
assert.equal(Bun.version, "1.4.4")
const version = packageJson.version
// NSIS-установщик существует только в стабильном канале.
const verified = await stageElectrobunRelease(input, output, { platform: "win", arch: "x64", channel, version, nsis: channel === "stable" })
console.log("Validated native Electrobun distribution:\n" + verified.files.join("\n"))
