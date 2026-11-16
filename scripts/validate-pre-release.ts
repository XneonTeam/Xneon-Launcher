import assert from "node:assert/strict"
import packageJson from "../package.json"
import { stageElectrobunRelease } from "./electrobun-artifacts"

const [input, output, version = packageJson.version] = Bun.argv.slice(2)
assert.ok(input && output, "Usage: validate-pre-release <native-candidate> <new-output> [expected-version]")
assert.equal(process.platform, "win32")
assert.equal(process.arch, "x64")
assert.equal(Bun.version, "1.4.4")
assert.equal(version, packageJson.version, "Expected the actual package version; artifact version aliases are not supported")
const verified = await stageElectrobunRelease(input, output, { platform: "win", arch: "x64", channel: "stable", version, nsis: true })
console.log("Validated NSIS and native Electrobun distribution:\n" + verified.files.join("\n"))
