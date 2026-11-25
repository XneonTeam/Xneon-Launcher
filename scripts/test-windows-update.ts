/**
 * Локальный E2E-харнесс Windows-обновления без публикации релиза.
 *
 * Проверяет настоящий путь `update:check → update:download → update:defer →
 * следующий запуск` на реальном HTTP, реальных файлах и реальном Ed25519:
 *   - подписанный Manifest v1 читается через `resolveVerifiedUpdate`;
 *   - NSIS-установщик качается по подписи, размер и SHA-256 сверяются;
 *   - `UpdateStateStore` копирует установщик, а `peek`/`defer` переживают restart;
 *   - `resumeDeferredUpdate` запускает только явно отложенный установщик;
 *   - подмена подписи, байтов установщика или исходной сборки отклоняется.
 *
 * Сеть наружу не нужна: фид подменяется `mock.module("update-public-keys")`,
 * всё остальное — боевые модули лаунчера.
 *
 * Запуск: `bun scripts/test-windows-update.ts`
 */
import assert from "node:assert/strict"
import { mock } from "bun:test"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { appIdentifier } from "../electrobun/main/app-identity"
import * as identityRules from "../lib/repository-identity"

const repo = path.resolve(import.meta.dir, "..")
const temp = path.join(repo, ".tmp")
mkdirSync(temp, { recursive: true })
const root = mkdtempSync(path.join(temp, "windows-update-"))
assert.match(path.relative(temp, root), /^windows-update-[\w-]+$/)

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keys = { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }
const version = "1.0.8"
const channel = "stable"
const installerFile = `xneon-launcher-${version}-win-x64.exe`
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

const archive = randomBytes(8 * 1024)
const installer = Buffer.concat([Buffer.from("MZ"), randomBytes(192 * 1024)])
const manifest = {
  schemaVersion: 1, identifier: appIdentifier, channel, platform: "win", arch: "x64",
  version, hash: "next123",
  artifact: {
    file: "stable-win-x64-XneonLauncher.tar.zst", downloadSize: archive.length, downloadSha256: sha256(archive),
    tarSize: archive.length, tarSha256: sha256(archive),
  },
  installer: { file: installerFile, size: installer.length, sha256: sha256(installer) },
}
const manifestBytes = Buffer.from(JSON.stringify(manifest))
const signatureBytes = Buffer.from(JSON.stringify({ keyId: "fixture", signature: sign(null, manifestBytes, privateKey).toString("base64") }))

// Режимы сервера: штатный ответ и две порчи для негативных сценариев.
let mode: "ok" | "bad-signature" | "bad-installer" = "ok"
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const name = new URL(request.url).pathname.slice(1)
    if (name === `${channel}-win-x64-update-v2.json`) return new Response(manifestBytes)
    if (name === `${channel}-win-x64-update-v2.json.sig`) {
      if (mode === "bad-signature") {
        const envelope = JSON.parse(signatureBytes.toString("utf8"))
        const forged = Buffer.from(envelope.signature, "base64")
        forged[0] ^= 0xff
        return Response.json({ ...envelope, signature: forged.toString("base64") })
      }
      return new Response(signatureBytes)
    }
    if (name === installerFile) {
      if (mode === "bad-installer") {
        const broken = Buffer.from(installer)
        broken[broken.length - 1] ^= 0xff
        return new Response(broken)
      }
      return new Response(installer)
    }
    return new Response("Not found", { status: 404 })
  },
})

const base = server.url.href.replace(/\/$/, "")
mock.module(path.join(repo, "electrobun/main/update-public-keys.ts"), () => ({
  updatePublicKeys: keys,
}))
// Фид локального сервера: идентичность подменяется, правила редиректов — настоящие.
const testRepository = "fixture/fork"
mock.module(path.join(repo, "electrobun/main/repository-identity.ts"), () => ({
  repository: testRepository,
  updateBaseUrls: { stable: base, canary: base },
  expectedUpdateBaseUrl: () => base,
  updateReleaseDownloadPath: () => identityRules.releaseDownloadPathFor(testRepository),
  isAllowedUpdateRedirect: (url: URL) => identityRules.isAllowedUpdateRedirectFor(url, testRepository),
}))

const { resolveVerifiedUpdate } = await import("../electrobun/main/verified-update-feed")
const { downloadChannelInstaller } = await import("../electrobun/main/channel-switch")
const { UpdateStateStore } = await import("../electrobun/main/update-state")
const { resumeDeferredUpdate } = await import("../electrobun/main/update-startup")

const local = { channel: "stable" as const, version: "1.0.7", hash: "old123" }

try {
  // 1. Проверка: та же версия — «обновлений нет» без ошибки, более новая — доступна.
  assert.equal(await resolveVerifiedUpdate("1.0.8", channel), null)
  const update = await resolveVerifiedUpdate("1.0.7", channel)
  assert.ok(update, "resolveVerifiedUpdate did not find the signed update")
  assert.equal(update.manifest.version, version)
  assert.equal(update.manifest.hash, "next123")
  assert.equal(update.manifest.installer?.sha256, sha256(installer))
  console.log("check: подписанный манифест 1.0.8 проверен, актуальная 1.0.8 = not-available")

  // 2. Скачивание: прогресс до 100% только после сверки размера и SHA-256.
  const progress: number[] = []
  const downloaded = await downloadChannelInstaller(channel, event => progress.push(event.percent), { version, hash: "next123" })
  assert.equal(downloaded.version, version)
  assert.equal(downloaded.file, installerFile)
  assert.deepEqual(readFileSync(downloaded.path), installer)
  assert.equal(progress[0], 0)
  assert.equal(progress.at(-1), 100)
  assert.ok(progress.every((percent, index) => index === 0 || percent >= progress[index - 1]), "прогресс должен расти")
  console.log(`download: ${installer.length} байт, SHA-256 совпал, прогресс ${progress[0]}…${progress.at(-1)}`)

  // 3. Staging/defer/restart: установщик копируется в состояние и переживает перезапуск.
  const pendingDirectory = path.join(root, "system-cache", "updates")
  const store = new UpdateStateStore(pendingDirectory, keys)
  await store.stage(local, update, downloaded.path)
  const stagedNow = await store.peek(local)
  assert.equal(stagedNow?.update.manifest.version, version)
  assert.equal(stagedNow?.deferred, false)
  await store.defer(local)
  const restarted = new UpdateStateStore(pendingDirectory, keys)
  const pending = await restarted.peek(local)
  assert.equal(pending?.deferred, true)
  assert.equal(pending?.kind, "installer")
  assert.deepEqual(readFileSync(pending!.path), installer)
  console.log("defer: установщик сохранён, pending пережил новый экземпляр хранилища")

  const order: string[] = []
  const applied = await resumeDeferredUpdate({
    local,
    store: restarted,
    launchInstaller: async file => { order.push("launch:" + file) },
    quit: async () => { order.push("quit") },
    onError: error => { order.push("error:" + (error as Error).message) },
  })
  assert.equal(applied, true)
  assert.deepEqual(order, ["launch:" + pending!.path, "quit"])
  assert.equal(await restarted.peek(local), null, "pending снимается до запуска установщика")
  console.log("startup: отложенный установщик запущен один раз, pending снят")

  // 4. Подделка подписи и байтов установщика отклоняется.
  mode = "bad-signature"
  await assert.rejects(resolveVerifiedUpdate("1.0.7", channel), /signature/i)
  mode = "bad-installer"
  const brokenProgress: number[] = []
  await assert.rejects(downloadChannelInstaller(channel, event => brokenProgress.push(event.percent), { version, hash: "next123" }), /hash/i)
  assert.ok(!brokenProgress.includes(100), "100% нельзя показывать до проверки SHA-256")
  mode = "ok"
  console.log("отказы: подпись и SHA-256 установщика отклонены, 100% не показано")

  // 5. Чужая сборка и подмена файла в состоянии не применяются.
  // Негативный download выше перезаписал общий временный файл: берём свежий.
  const fresh = await downloadChannelInstaller(channel, undefined, { version, hash: "next123" })
  await store.stage(local, update, fresh.path)
  await assert.rejects(store.peek({ ...local, hash: "other123" }), /installed build/)
  const staged = await store.peek(local)
  writeFileSync(staged!.path, Buffer.alloc(installer.length, 1))
  await assert.rejects(store.peek(local), /hash/)
  await store.clearPending()
  console.log("отказы: pending чужой сборки и подменённый установщик не применяются")

  // 6. Смена версии после check не подменяет установщик.
  await assert.rejects(
    downloadChannelInstaller(channel, undefined, { version: "1.0.7", hash: "stale" }),
    /changed after checking/,
  )
  console.log("отказы: несовпадение манифеста с моментом проверки отклонено")

  console.log("Windows update E2E: OK (" + root + ")")
} finally {
  server.stop(true)
  rmSync(root, { recursive: true, force: true })
}