import assert from "node:assert/strict"
import { createPrivateKey } from "node:crypto"
import path from "node:path"
import packageJson from "../package.json"
import { updatePublicKeys } from "../electrobun/main/update-public-keys"
import type { UpdateTarget } from "../electrobun/main/update-manifest"
import { signUpdateFeed } from "./update-feed"

const [channel, input, output, platform = "win", arch = "x64", packages] = Bun.argv.slice(2)
assert.ok((channel === "stable" || channel === "canary") && input && output && path.resolve(input) !== path.resolve(output),
  "Usage: sign-update-feed <stable|canary> <candidate> <new-output> [win|linux|macos] [x64|arm64] [packages]")
assert.ok(platform === "win" && arch === "x64" || platform === "linux" && arch === "x64" || platform === "macos" && arch === "arm64",
  "Unsupported update platform/architecture")
assert.equal(channel === "canary", packageJson.version.includes("-"), "Signing channel must match the package version")
assert.ok(platform === "linux" ? !!packages : !packages, "Only Linux signing accepts a distribution packages directory")

const keyId = process.env.XNLC_UPDATE_KEY_ID
const privatePem = process.env.XNLC_UPDATE_PRIVATE_KEY
assert.ok(keyId && Object.hasOwn(updatePublicKeys, keyId) && privatePem, "Configure a trusted key ID and provide the private key in the protected signing environment")
const privateKey = createPrivateKey(privatePem)
assert.equal(privateKey.asymmetricKeyType, "ed25519", "Invalid update key type")

const target = { channel, platform, arch } as UpdateTarget
const manifest = await signUpdateFeed(input, packages, output, target, packageJson.version, keyId, privateKey)
console.log(`Signed ${manifest.channel}-${manifest.platform}-${manifest.arch} Manifest v1 (-update.json and -update-v2.json) for key ${keyId}`)