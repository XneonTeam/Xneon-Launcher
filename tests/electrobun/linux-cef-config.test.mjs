import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import vm from "node:vm"
import { createHash } from "node:crypto"
import { transformSync } from "esbuild"

const root = path.resolve(import.meta.dir, "../..")
function config() {
  const code = transformSync(fs.readFileSync(path.join(root, "electrobun.config.ts"), "utf8"), { loader: "ts", format: "cjs" }).code
  const module = { exports: {} }
  vm.runInNewContext(code, { module, process: { platform: "linux", arch: "x64", env: {} }, require: name => {
    if (name === "./package.json") return { version: "1.0.8", description: "test" }
    if (name.endsWith("app-identity")) return { appIdentifier: "test", portableAppIdentifier: "test.portable" }
    throw new Error("Unexpected dependency: " + name)
  } })
  return module.exports.default
}

test("CEF включён и выбран по умолчанию только для Linux", () => {
  const { build } = config()
  assert.equal(build.linux.bundleCEF, true)
  assert.equal(build.linux.defaultRenderer, "cef")
  for (const platform of ["win", "mac"]) {
    assert.equal(build[platform].bundleCEF, false)
    assert.equal(build[platform].defaultRenderer, "native")
  }
})

test("Linux CEF сохраняет раскладку FFI-бинарников и SHA-256", () => {
  const { build } = config()
  assert.equal(build.copy["assets/native/nfd"], "native/nfd")
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "xneon-cef-layout-"))
  try {
    const resources = path.join(staging, "Resources/app")
    fs.mkdirSync(resources, { recursive: true })
    fs.cpSync(path.join(root, "assets/native/nfd"), path.join(resources, build.copy["assets/native/nfd"]), { recursive: true })
    const manifest = JSON.parse(fs.readFileSync(path.join(resources, "native/nfd/manifest.json"), "utf8"))
    for (const entry of manifest.files) {
      assert.equal(createHash("sha256").update(fs.readFileSync(path.join(resources, "native/nfd", entry.path))).digest("hex"), entry.sha256)
    }
    assert.ok(fs.statSync(path.join(resources, "native/nfd/linux-x64/libnfd.so")).isFile())
  } finally { fs.rmSync(staging, { recursive: true, force: true }) }
})
