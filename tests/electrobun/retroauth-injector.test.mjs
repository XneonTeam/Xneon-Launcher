import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL("../../packages/xnlc-core/src/launch-utils.ts", import.meta.url), "utf8")
const code = transformSync(source + "\nexport { ensureDownloadedFile };", { loader: "ts", format: "cjs" }).code
const releaseUrl = "https://github.com/MAINER4IK/RetroAuth-injector/releases/download/1.0.4/retroauth-injector-1.0.4.jar"
const releaseHash = "8653b24cf088b11630184e574d2258b6ca1d7c4ab89914a636d6785403fad4b0"
const jar = Buffer.alloc(2048, 1)
jar.write("PK\x03\x04", 0, "binary")
const oldJar = Buffer.from(jar)
oldJar[100] = 2
const hash = createHash("sha256").update(jar).digest("hex")

function fixture(t, respond = () => new Response(jar)) {
  const directory = path.resolve(".tmp")
  fs.mkdirSync(directory, { recursive: true })
  const root = fs.mkdtempSync(path.join(directory, "retroauth-download-test-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls = []
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, Buffer, URL, AbortController, setTimeout, clearTimeout, process,
    require(name) {
      if (name === "./auth/auth-manager.js") return { AuthManager: {} }
      if (name === "./config.js") return { getAuthlibInjectorAllowedHosts: () => [] }
      if (name === "./constants/urls.js") return { URLS: { official: {} } }
      return require(name)
    },
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (options.signal?.aborted) throw new Error("Aborted")
      return respond(url, options)
    },
  })
  const file = path.join(root, "retroauth-injector.jar")
  const download = signal => module.exports.ensureDownloadedFile(file, releaseUrl, "retroauth-injector", signal, hash)
  return { root, file, calls, download, ensureRetroAuthInjector: module.exports.ensureRetroAuthInjector }
}

test("RetroAuth: старый кэш не мешает переходу на релиз 1.0.4", async t => {
  const f = fixture(t)
  fs.writeFileSync(f.file, oldJar)
  // Контрольная сумма синтетического JAR отличается: ожидаем отказ, но не запуск старого агента.
  await assert.rejects(f.ensureRetroAuthInjector(f.root), /SHA-256/)
  assert.equal(f.calls[0].url, releaseUrl)
  assert.deepEqual(fs.readFileSync(f.file), oldJar)
  assert.ok(source.includes(releaseHash), "Должен быть закреплён SHA-256 опубликованного JAR")
})

test("RetroAuth: скачанный JAR проверяется и повторно используется без сети", async t => {
  const f = fixture(t)
  assert.equal(await f.download(), f.file)
  assert.deepEqual(fs.readFileSync(f.file), jar)
  assert.equal(await f.download(), f.file)
  assert.equal(f.calls.length, 1)
  assert.equal(fs.existsSync(f.file + ".part"), false)
})

test("RetroAuth: старый JAR атомарно заменяется проверенным", async t => {
  const f = fixture(t)
  fs.writeFileSync(f.file, oldJar)
  assert.equal(await f.download(), f.file)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(fs.readFileSync(f.file), jar)
})

test("RetroAuth: несовпадение SHA-256 не заменяет существующий файл", async t => {
  const f = fixture(t, () => new Response(oldJar))
  fs.writeFileSync(f.file, oldJar)
  await assert.rejects(f.download(), /SHA-256/)
  assert.deepEqual(fs.readFileSync(f.file), oldJar)
  assert.equal(fs.existsSync(f.file + ".part"), false)
})

test("RetroAuth: ошибка HTTP сохраняет предыдущий файл и не выдаёт его как актуальный", async t => {
  const f = fixture(t, () => new Response("Unavailable", { status: 503 }))
  fs.writeFileSync(f.file, oldJar)
  await assert.rejects(f.download(), /503/)
  assert.deepEqual(fs.readFileSync(f.file), oldJar)
})

test("RetroAuth: вместо JAR нельзя сохранить HTML", async t => {
  const f = fixture(t, () => new Response("<html>" + "error".repeat(500)))
  await assert.rejects(f.download(), /invalid archive/)
  assert.equal(fs.existsSync(f.file), false)
  assert.equal(fs.existsSync(f.file + ".part"), false)
})

test("RetroAuth: отменённое обновление не портит старый JAR", async t => {
  const f = fixture(t)
  fs.writeFileSync(f.file, oldJar)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(f.download(controller.signal), /Aborted/)
  assert.deepEqual(fs.readFileSync(f.file), oldJar)
})
