import assert from "node:assert/strict"
import { mock } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { appIdentifier } from "../electrobun/main/app-identity"
import { nativeTarExecutable } from "./native-tar"

assert.equal(process.platform, "win32")
const repo = path.resolve(import.meta.dir, "..")
const [channel, childRoot] = process.argv.slice(2)
assert.ok(channel === "stable" || channel === "canary")
const prefix = channel + "-win-x64"
const temp = path.join(repo, ".tmp")
mkdirSync(temp, { recursive: true })
const root = childRoot ?? mkdtempSync(path.join(temp, "native-update-" + channel + "-"))
assert.match(path.relative(temp, root), /^native-update-(stable|canary)-[\w-]+$/)
const artifacts = path.join(repo, "release-electrobun", channel)
const manifest = JSON.parse(readFileSync(path.join(artifacts, prefix + "-update-v2.json"), "utf8"))
assert.equal(manifest.identifier, appIdentifier)
assert.equal(manifest.channel, channel)
assert.equal(manifest.artifact.file, path.basename(manifest.artifact.file))
const archive = path.join(artifacts, manifest.artifact.file)
process.env.LOCALAPPDATA = path.join(root, "local")
process.env.APPDATA = path.join(root, "roaming")
process.env.TEMP = process.env.TMP = path.join(root, "temp")
mkdirSync(process.env.TEMP, { recursive: true })
const channelRoot = path.join(process.env.LOCALAPPDATA, manifest.identifier, channel)
const app = path.join(channelRoot, "app")
const bin = path.join(app, "bin")
if (!childRoot) {
  mkdirSync(app, { recursive: true })
  const extract = Bun.spawnSync([nativeTarExecutable(), "-xf", archive, "-C", app, "--strip-components", "1"])
  assert.equal(extract.exitCode, 0, extract.stderr.toString())
  const child = Bun.spawnSync([path.join(bin, "bun.exe"), import.meta.path, channel, root], {
    env: process.env, stdout: "inherit", stderr: "inherit",
  })
  process.exit(child.exitCode)
}

// Локальный сервер заменяет GitHub Releases на время проверки: SDK принимает только
// https или loopback http, поэтому 127.0.0.1 подходит. Канал задаёт само содержимое
// version.json — bridge с проекцией канала больше не нужен.
let wrongDigest = true
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const name = new URL(request.url).pathname.slice(1)
    if (name === prefix + "-update-v2.json") {
      return Response.json(wrongDigest
        ? { ...manifest, artifact: { ...manifest.artifact, tarSha256: "0".repeat(64) } }
        : manifest)
    }
    if (name === manifest.artifact.file) return new Response(Bun.file(archive))
    return new Response("Not found", { status: 404 })
  },
})

try {
  const metadata = path.join(app, "Resources", "version.json")
  const local = JSON.parse(readFileSync(metadata, "utf8"))
  assert.equal(local.hash, manifest.hash)
  // Локальная версия старее выпущенной: манифест обязан пройти по каналу и быть новее.
  const source = { ...local, version: "1.0.7", hash: "0000000000001", baseUrl: server.url.href }
  writeFileSync(metadata, JSON.stringify(source))
  // Изолируем интерфейс завершения процесса. Проверка и нативная подготовка
  // архива идут через настоящий SDK и бинарный helper.
  mock.module(path.join(repo, ".hutch/devkit/api/sdks/main/core/Utils.ts"), () => ({
    requestQuitApproval: () => null,
    quitAfterApproval: () => { throw new Error("Unexpected native quit") },
    cancelQuitApproval: () => {},
  }))
  process.chdir(bin)
  const { Updater } = await import("../.hutch/devkit/api/sdks/main/core/Updater.ts")
  Updater.onStatusChange(({ status, message }) => console.log(channel, status, message))
  // Сначала подпорченный digest: нативный helper обязан отклонить архив.
  assert.equal((await Updater.checkForUpdate()).updateAvailable, true)
  await Updater.downloadUpdate()
  assert.equal(Updater.updateInfo().updateReady, false)
  assert.match(Updater.updateInfo().error, /ArchiveHashMismatch/)
  // Корректный манифест: тот же канал, подготовка до состояния ready.
  wrongDigest = false
  assert.equal((await Updater.checkForUpdate()).updateAvailable, true)
  await Updater.downloadUpdate()
  assert.equal(Updater.updateInfo().updateReady, true, Updater.updateInfo().error)
  assert.deepEqual(JSON.parse(readFileSync(metadata, "utf8")), source)
  console.log("Native update prepared without replacing the source installation:", root)
} finally {
  server.stop(true)
}