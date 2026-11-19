// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import test, { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once, EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import os, { tmpdir } from "node:os"
import { spawn, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { loadReactModule } from "../helpers/react-module.mjs"
import packageJson from "../../package.json"
import { APP_USER_AGENT } from "../../lib/app-meta.ts"
import { describe, expect, test as bunTest } from "bun:test"
import { createHash } from "node:crypto"
import { prepareOptionsCompatibility as prepare, projectOptions } from "../../electrobun/main/options-compatibility.ts"
import net from "node:net"
import { runTunnel } from "../../electrobun/main/xn-connect/relay.ts"

{
  async function fixture(t) {
    const requests = []
    const server = createServer(async (request, response) => {
      const pathname = request.url
      requests.push({ method: request.method, url: pathname, headers: request.headers })
      if (pathname === "/slow-headers") return
      if (pathname === "/slow-body") { response.writeHead(200, { "Content-Type": "application/json" }); response.write('{"pending":'); return }
      if (pathname === "/offline") { request.socket.destroy(); return }
      if (pathname === "/redirect") { response.writeHead(302, { Location: "/json" }); response.end(); return }
      if (pathname === "/404" || pathname === "/503") { response.writeHead(Number(pathname.slice(1))); response.end("failure"); return }
      if (pathname === "/empty") { response.writeHead(204); response.end(); return }
      if (pathname === "/binary") { response.end(Buffer.from([0, 255, 128, 195, 169, 0])); return }
      if (pathname === "/large") {
        response.writeHead(200, { "Content-Type": "application/octet-stream" })
        const chunk = Buffer.alloc(64 * 1024, 0x5a)
        for (let index = 0; index < 128; index++) if (!response.write(chunk)) await once(response, "drain")
        response.end(); return
      }
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      if (pathname === "/text") { response.end("not JSON: Привет"); return }
      if (pathname === "/stream-upload") { response.end(JSON.stringify({ bytes: Buffer.concat(chunks).length })); return }
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({ ok: true, method: request.method, body: Buffer.concat(chunks).toString("utf8"), headers: request.headers }))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => { server.closeAllConnections(); server.close() })
    return { url: `http://127.0.0.1:${server.address().port}`, requests }
  }
  describe("native-api-migration", () => {
    test("native HTTP: методы, JSON, авторизация, текст, бинарные ответы, redirect и UA", async t => {
      const { avatarJson, avatarBuffer } = await import("../../electrobun/main/avatar-http.ts")
      const { APP_USER_AGENT } = await import("../../lib/app-meta.ts")
      const { url } = await fixture(t)
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const result = await avatarJson(url + "/json", { method, headers: { Authorization: "Bearer fixture-only", "Content-Type": "application/json" }, ...(method !== "GET" ? { body: JSON.stringify(["Игрок"]) } : {}) })
        assert.equal(result.method, method)
        assert.equal(result.headers.authorization, "Bearer fixture-only")
        assert.equal(result.headers["user-agent"], APP_USER_AGENT)
        if (method !== "GET") assert.deepEqual(JSON.parse(result.body), ["Игрок"])
      }
      assert.equal(await avatarJson(url + "/text"), "not JSON: Привет")
      assert.equal(await avatarJson(url + "/empty"), "")
      assert.equal((await avatarJson(url + "/redirect")).ok, true)
      assert.deepEqual(await avatarBuffer(url + "/binary"), Buffer.from([0, 255, 128, 195, 169, 0]))
    })

    test("native HTTP: 4xx/5xx не становятся успехом, нет скрытых retry", async t => {
      const { avatarJson, AvatarHttpError } = await import("../../electrobun/main/avatar-http.ts")
      const { url, requests } = await fixture(t)
      for (const status of [404, 503]) await assert.rejects(avatarJson(url + "/" + status), error => error instanceof AvatarHttpError && error.status === status && error.url.endsWith(String(status)))
      assert.equal(requests.length, 2)
      await assert.rejects(avatarJson(url + "/offline"))
    })

    test("native HTTP: timeout включает тело, отмена не теряется", async t => {
      const { avatarJson } = await import("../../electrobun/main/avatar-http.ts")
      const { url } = await fixture(t)
      for (const pathname of ["/slow-headers", "/slow-body"]) {
        const started = performance.now()
        await assert.rejects(avatarJson(url + pathname, {}, 80))
        assert.ok(performance.now() - started < 1500)
      }
      const controller = new AbortController()
      const pending = avatarJson(url + "/slow-body", { signal: controller.signal })
      controller.abort(new Error("Fixture cancellation"))
      await assert.rejects(pending, /Fixture cancellation/)
    })

    test("native HTTP: multipart, streaming upload и большой download", async t => {
      const { avatarJson, avatarBuffer } = await import("../../electrobun/main/avatar-http.ts")
      const { url } = await fixture(t)
      const form = new FormData()
      form.set("name", "Игрок")
      form.set("file", new Blob(["fixture"]), "skin.png")
      const multipart = await avatarJson(url + "/json", { method: "POST", body: form })
      assert.match(multipart.headers["content-type"], /multipart\/form-data; boundary=/)
      assert.match(multipart.body, /Игрок/)
      assert.match(multipart.body, /skin.png/)
      const body = new ReadableStream({ start(controller) { for (let i = 0; i < 8; i++) controller.enqueue(new Uint8Array(65536)); controller.close() } })
      const uploaded = await avatarJson(url + "/stream-upload", { method: "POST", body, duplex: "half" })
      assert.equal(uploaded.bytes, 8 * 65536)
      const downloaded = await avatarBuffer(url + "/large")
      assert.equal(downloaded.length, 8 * 1024 * 1024)
      assert.equal(downloaded[downloaded.length - 1], 0x5a)
    })

    test("native encoding: точные байты Java argfile UTF-8/UTF-16LE/1251/CP866 и запрет потери данных", async () => {
      const { encodeJavaArgFile } = await import("../../packages/xnlc-core/src/core/java-encoding.ts")
      const samples = [
        ["UTF-8", "Привет", "d09fd180d0b8d0b2d0b5d182"],
        ["UTF-16LE", "Привет", "1f0440043804320435044204"],
        ["windows-1251", "Привет", "cff0e8e2e5f2"],
        ["Cp866", "Привет", "8fe0a8a2a5e2"],
        ["UTF-8", "世界 😀", "e4b896e7958c20f09f9880"],
        ["US-ASCII", "-cp game.jar Main", "2d63702067616d652e6a6172204d61696e"],
        ["windows-1252", "€", "80"],
        ["ISO-8859-1", "é", "e9"],
        ["windows-31j", "日本語", "93fa967b8cea"],
        ["GBK", "中文", "d6d0cec4"],
      ]
      for (const [encoding, text, hex] of samples) assert.equal(Buffer.from(await encodeJavaArgFile(text, encoding)).toString("hex"), hex, encoding)
      for (const [encoding, text] of [["windows-1251", "世界"], ["Cp866", "😀"], ["US-ASCII", "€"], ["ISO-8859-1", "€"], ["UTF-8", "\uD800"]]) {
        await assert.rejects(encodeJavaArgFile(text, encoding), /cannot represent/)
      }
      await assert.rejects(encodeJavaArgFile("path", "not-an-encoding"))
    })

    test("native decoding: UTF-8/UTF-16LE/1251/CP866, разрезанные чанки логов и ошибки байтов", () => {
      for (const [label, bytes] of [["windows-1251", "cff0e8e2e5f2"], ["ibm866", "8fe0a8a2a5e2"], ["utf-16le", "1f0440043804320435044204"]]) {
        assert.equal(new TextDecoder(label).decode(Buffer.from(bytes, "hex")), "Привет")
      }
      const line = "[12:34:56] [Render thread/INFO]: Привет, Minecraft! 世界 😀\r\n"
      const bytes = new TextEncoder().encode(line)
      const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
      let text = ""
      for (const byte of bytes) text += decoder.decode(Uint8Array.of(byte), { stream: true })
      text += decoder.decode()
      assert.equal(text, line)
      assert.equal(new TextDecoder().decode(Uint8Array.of(0xc3, 0x28)), "�(")
      const truncated = new TextDecoder()
      assert.equal(truncated.decode(Uint8Array.of(0xe2, 0x82), { stream: true }), "")
      assert.equal(truncated.decode(), "�")
    })

    test("avatar: реальные функции сохраняют выбор провайдера, POST и PNG-фолбэк после HTTP ошибки", async t => {
      const http = await import("../../electrobun/main/avatar-http.ts")
      const { PNG } = createRequire(import.meta.url)("pngjs")
      const skin = PNG.sync.write(new PNG({ width: 64, height: 64 }))
      const calls = []
      const textures = { SKIN: { url: "https://textures.fixture/skin.png" }, CAPE: { url: "https://textures.fixture/cape.png" } }
      const server = createServer(async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const upstream = new URL(request.headers["x-fixture-upstream"])
        calls.push({ host: upstream.hostname, method: request.method, body: Buffer.concat(chunks).toString("utf8"), ua: request.headers["user-agent"] })
        if (upstream.hostname === "api.mojang.com") return response.end('{"id":"fixture-uuid"}')
        if (upstream.hostname === "skins.xneon.org" && request.method === "POST") return response.end('[{"id":"fixture-uuid","name":"Player"}]')
        if (upstream.pathname.endsWith(".png")) { response.end(skin); return }
        if (upstream.hostname === "skinsystem.ely.by") { response.end(JSON.stringify(textures)); return }
        response.end(JSON.stringify({ properties: [{ name: "textures", value: Buffer.from(JSON.stringify({ textures })).toString("base64") }] }))
      })
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      t.after(() => { server.closeAllConnections(); server.close() })
      const local = `http://127.0.0.1:${server.address().port}`
      const options = (url, init = {}) => ({ ...init, headers: { ...init.headers, "X-Fixture-Upstream": url } })
      const avatar = loadReactModule(new URL("../../electrobun/main/avatar.ts", import.meta.url), {
        "../platform/resources": { launcherViewAssets: "" },
        "../platform/desktop": { protocol: {}, rpcRegistry: {} },
        "./runtime": { logRuntime() {} },
        "./avatar-http": { avatarJson: (url, init) => http.avatarJson(local, options(url, init)), avatarBuffer: url => http.avatarBuffer(local, options(url)) },
      }, { __dirname: path.resolve("electrobun/main"), Buffer, process, URL })
      assert.ok((await avatar.getXnSkinsTextures("Player")).SKIN)
      assert.deepEqual(JSON.parse(calls[0].body), ["Player"])
      assert.equal(calls[0].method, "POST")
      calls.length = 0
      await avatar.getTextures("MojangPlayer", { type: "microsoft" })
      assert.ok(calls.every(call => ["api.mojang.com", "sessionserver.mojang.com"].includes(call.host)))
      calls.length = 0
      await avatar.getTextures("ElyPlayer", { type: "elyby" })
      assert.deepEqual(calls.map(call => call.host), ["skinsystem.ely.by"])
      assert.ok(PNG.sync.read(await avatar.getHeadBuffer("ElyPlayer", 32, { type: "elyby" })))
      const failing = loadReactModule(new URL("../../electrobun/main/avatar.ts", import.meta.url), {
        "../platform/resources": { launcherViewAssets: "" }, "../platform/desktop": {}, "./runtime": { logRuntime() {} },
        "./avatar-http": { avatarJson: async () => { throw new http.AvatarHttpError(503, "https://fixture", "Unavailable") }, avatarBuffer: async () => { throw new Error("Offline") } },
      }, { __dirname: path.resolve("electrobun/main"), Buffer, process, URL })
      assert.equal(await failing.getTextures("Unavailable", { type: "elyby" }), null)
      assert.equal(PNG.sync.read(await failing.getHeadBuffer("Unavailable", 32, { type: "elyby" })).width, 32)
    })

    test("Java: настоящий @argfile сохраняет кириллические аргументы в native.encoding JVM", { timeout: 120_000 }, async t => {
      const java = process.env.XNLC_TEST_JAVA ?? (process.platform === "win32" ? "C:/Program Files/Microsoft/jdk-17.0.20.8-hotspot/bin/java.exe" : "java")
      const probe = spawnSync(java, ["-version"], { encoding: "utf8", windowsHide: true })
      if (probe.error || probe.status !== 0) { t.skip("Нужна установленная Java 11+ для source-mode smoke"); return }
      const { writeJavaArgFileIfTooLong } = await import("../../packages/xnlc-core/src/core/java-runner.ts")
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-native-java-"))
      let argfile
      try {
        const source = path.join(directory, "ArgEcho.java")
        await fs.writeFile(source, 'import java.nio.charset.StandardCharsets; import java.util.Base64; class ArgEcho { public static void main(String[] args) { for(String arg:args) System.out.println(Base64.getEncoder().encodeToString(arg.getBytes(StandardCharsets.UTF_8))); } }')
        const expected = ["Путь к сборке", "", "C:\\Игры\\Сборка с пробелами", "#hash"]
        const prepared = await writeJavaArgFileIfTooLong([source, ...expected], 100000, 100, 17, java)
        argfile = prepared.cleanupPath
        assert.ok(argfile?.endsWith(".txt"))
        const child = spawn(java, prepared.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
        let output = "", error = ""
        child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk })
        child.stderr.setEncoding("utf8").on("data", chunk => { error += chunk })
        const [code] = await once(child, "close")
        assert.equal(code, 0, error)
        assert.deepEqual(output.replace(/\r/g, "").split("\n").slice(0, -1).map(line => Buffer.from(line, "base64").toString("utf8")), expected)
      } finally { if (argfile) await fs.rm(argfile, { force: true }); await fs.rm(directory, { recursive: true, force: true }) }
    })

    test("JavaRunner: настоящий обработчик stdout/stderr сохраняет разрезанный UTF-8, BOM и хвост логов", async () => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.pid = 123
      const written = []
      let ended = false
      const require = createRequire(import.meta.url)
      const { JavaRunner } = loadReactModule(new URL("../../packages/xnlc-core/src/core/java-runner.ts", import.meta.url), {
        child_process: { spawn: () => child },
        fs: { existsSync: () => true, createWriteStream: () => ({ write: text => written.push(text), end: () => { ended = true } }) },
        "../utils/index.js": { getLogsDir: dir => path.join(dir, "logs"), cleanEnvForGame: env => env },
        "./java-encoding.js": { encodeJavaArgFile: async () => { throw new Error("Short command must not require argfile") } },
        "@xnlc/archives": require("@xnlc/archives"),
      }, { process, Buffer, TextDecoder, TextEncoder })
      const runner = new JavaRunner()
      runner.setPipeOutputToConsole(false)
      const result = await runner.launch(["java", "Main"], os.tmpdir())
      const line = "\uFEFF[12:34:56] [Render thread/INFO]: Привет, Minecraft! 世界 😀\r\n"
      for (const byte of Buffer.from(line, "utf8")) child.stdout.emit("data", Buffer.from([byte]))
      child.stderr.emit("data", Buffer.from("Предупреждение: ", "utf8"))
      child.stderr.emit("data", Buffer.from([0xe2, 0x82]))
      child.emit("close", 0)
      assert.equal(await result.wait(), 0)
      assert.equal(written.join(""), line + "Предупреждение: �")
      assert.equal(ended, true)
    })

    test("Downloader: большой HTTP-файл по-прежнему пишется потоком с прогрессом", async t => {
      const { Downloader } = await import("../../packages/xnlc-core/src/core/downloader.ts")
      const { url } = await fixture(t)
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xnlc-native-download-"))
      try {
        const file = path.join(directory, "library.jar")
        const progress = []
        await new Downloader().download({ url: url + "/large", dest: file, size: 8 * 1024 * 1024, onProgress: event => progress.push(event.downloaded) })
        assert.equal((await fs.stat(file)).size, 8 * 1024 * 1024)
        assert.ok(progress.length > 1, "Прогресс приходит по чанкам, не только после буферизации")
        assert.equal(progress.at(-1), 8 * 1024 * 1024)
        assert.deepEqual(await fs.readdir(directory), ["library.jar"])
      } finally { await fs.rm(directory, { recursive: true, force: true }) }
    })
  })
}

{
  describe("user-agent", () => {
    test('User-Agent приложения следует app metadata, а не literal текущего релиза', () => {
      assert.equal(APP_USER_AGENT, `Xneon-Launcher/${packageJson.version}`)
      assert.match(APP_USER_AGENT, /^Xneon-Launcher\/\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
    })

    for (const override of [undefined, APP_USER_AGENT, 'CustomLauncher/9.9.9']) {
      test(`Modrinth-клиент: реальный HTTP header, standalone default / build override (${override ?? 'default'})`, async () => {
        const directory = await fs.mkdtemp(path.join(tmpdir(), 'xnlc-ua-'))
        const previous = globalThis.fetch
        try {
          const result = await Bun.build({ entrypoints: [path.resolve('packages/xnlc-mods/src/modrinth-client.ts')], outdir: directory, target: 'bun',
            define: override ? { XNLC_APPLICATION_USER_AGENT: JSON.stringify(override) } : {}, naming: '[name].js' })
          assert.equal(result.success, true)
          const headers = []
          globalThis.fetch = async (_url, options) => { headers.push(new Headers(options.headers).get('User-Agent')); return Response.json([]) }
          const client = await import(path.join(directory, 'modrinth-client.js'))
          await client.modrinthGetProjectsByIds(['project'])
          assert.deepEqual(headers, [override ?? 'xnlc-mods'])
        } finally { globalThis.fetch = previous; await fs.rm(directory, { recursive: true, force: true }) }
      })
    }
  })
}

{
  const test = bunTest
  async function prepareOptionsCompatibility(...args: Parameters<typeof prepare>) {
    const transaction = await prepare(...args)
    await transaction.commit()
    return transaction
  }

  const old = "lang:ru_RU\nviewDistance:1\nfpsLimit:2\nao:true\nclouds:true\nfancyGraphics:false\nfov:0.25\nmusic:0.3\nsound:0.7\nkey_key.forward:17\nkey_key.attack:-100\n"
  const recent = "version:99999\nlang:ru_ru\ngraphicsPreset:fancy\nrenderDistance:12\nmaxFps:120\nao:true\nrenderClouds:true\nfov:0.25\nsoundCategory_music:0.3\nsoundCategory_master:0.7\nkey_key.forward:key.keyboard.w\nkey_key.attack:key.mouse.left\nmod_setting:opaque:data\n"
  async function fixture(run: (dir: string, file: string) => Promise<void>) {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "xnlc-a25-"))
    try { await run(dir, path.join(dir, "options.txt")) } finally { await fs.rm(dir, { recursive: true, force: true }) }
  }
  describe("options-compatibility", () => {
    for (const [first, second, text] of [["26.3", "1.1", recent], ["1.1", "26.3", old], ["1.8", "1.7.2", "lang:ru_RU\nrenderDistance:12\nrenderClouds:fast\nao:2\nkey_key.forward:17\n"], ["1.21.10", "26.3", "lang:ru_ru\ngraphicsMode:2\nrenderDistance:12\nfov:0.25\n"]]) {
      test(first + " → " + second + " → " + first + ": точный снимок и изменения каждой версии", () => fixture(async (dir, file) => {
        await fs.writeFile(file, text)
        await prepareOptionsCompatibility(dir, first, true)
        const original = await fs.readFile(file)
        await prepareOptionsCompatibility(dir, second, true)
        const converted = await fs.readFile(file, "utf8")
        expect(converted).toContain("lang:")
        await fs.writeFile(file, converted + "custom_second:kept\n")
        await prepareOptionsCompatibility(dir, first, true)
        expect(await fs.readFile(file)).toEqual(original)
        await prepareOptionsCompatibility(dir, second, true)
        expect(await fs.readFile(file, "utf8")).toContain("custom_second:kept")
      }))
    }

    test("подтверждённые язык, бинды, графика, звук; неизвестные остаются в исходном снимке", () => {
      const converted = projectOptions(recent, "1.1")
      for (const line of ["lang:ru_RU", "key_key.forward:17", "key_key.attack:-100", "music:0.3", "sound:0.7", "ao:true", "clouds:true", "fov:0.25"]) expect(converted).toContain(line)
      expect(converted).not.toContain("renderDistance")
      expect(converted).not.toContain("mod_setting")
      expect(projectOptions(old, "26.3")).toContain("key_key.forward:key.keyboard.w")
      expect(projectOptions("graphicsMode:2\n", "26.3")).toContain("improvedTransparency:true")
      expect(projectOptions("renderClouds:fast\n", "1.7.2")).toBe("clouds:true\n")
    })

    test("первый запуск старой версии с современным файлом сохраняет исходник для возвращения", () => fixture(async (dir, file) => {
      await fs.writeFile(file, recent)
      await prepareOptionsCompatibility(dir, "1.1", true)
      expect(await fs.readFile(file, "utf8")).toContain("lang:ru_RU")
      await prepareOptionsCompatibility(dir, "26.3", true)
      expect(await fs.readFile(file, "utf8")).toBe(recent)
    }))

    test("отсутствующий, пустой, повреждённый файл и неизвестные версии", () => fixture(async (dir, file) => {
      await prepareOptionsCompatibility(dir, "1.1", true)
      expect(await fs.stat(file).catch(() => null)).toBeNull()
      await fs.writeFile(file, "")
      await prepareOptionsCompatibility(dir, "26.3", true)
      expect(await fs.readFile(file, "utf8")).toBe("")
      await fs.writeFile(file, "broken\0line\nlang:ru_ru\nao:NaN\nkey_key.forward:bad\n")
      const transaction = await prepare(dir, "26.3", true)
      expect(await fs.readFile(file, "utf8")).toBe("version:5023\nlang:ru_ru\n")
      await transaction.rollback()
      expect(await fs.readFile(file, "utf8")).toContain("broken\0line")
      const before = await fs.readFile(file)
      await prepareOptionsCompatibility(dir, "custom-version", true)
      expect(await fs.readFile(file)).toEqual(before)
    }))

    test("инстанс не создаёт служебные файлы; совместимый запуск не меняет options.txt", () => fixture(async (dir, file) => {
      await fs.writeFile(file, old + "unknown:safe\n")
      await prepareOptionsCompatibility(dir, "26.3", false)
      expect(await fs.readdir(dir)).toEqual(["options.txt"])
      const info = await fs.stat(file), before = await fs.readFile(file)
      await prepareOptionsCompatibility(dir, "1.1", true)
      expect(await fs.readFile(file)).toEqual(before)
      expect((await fs.stat(file)).mtimeMs).toBe(info.mtimeMs)
    }))

    test("журнал аварийного прерывания восстанавливает оригинал до подготовки", () => fixture(async (dir, file) => {
      const root = path.join(dir, ".xneon-options")
      await fs.mkdir(root)
      await fs.writeFile(file, "partial")
      await fs.writeFile(path.join(root, "pending.json"), JSON.stringify({ original: Buffer.from(old).toString("base64"), state: null }))
      await prepareOptionsCompatibility(dir, "1.1", true)
      expect(await fs.readFile(file, "utf8")).toBe(old)
      expect(await fs.stat(path.join(root, "pending.json")).catch(() => null)).toBeNull()
    }))

    test("ошибка чтения профиля не заменяет исходный файл", () => fixture(async (dir, file) => {
      await fs.writeFile(file, old)
      await prepareOptionsCompatibility(dir, "1.1", true)
      const hash = createHash("sha256").update("26.3").digest("hex")
      await fs.mkdir(path.join(dir, ".xneon-options", hash + ".options"))
      await expect(prepareOptionsCompatibility(dir, "26.3", true)).rejects.toBeDefined()
      expect(await fs.readFile(file, "utf8")).toBe(old)
    }))

    test("незавершённая подготовка откатывается после перезапуска, commit сохраняет результат", () => fixture(async (dir, file) => {
      await fs.writeFile(file, recent)
      await prepare(dir, "1.1", true)
      expect(await fs.readFile(file, "utf8")).not.toBe(recent)
      // Следующий процесс обнаруживает pending, а не принимает чужой файл за настройки игры.
      const restarted = await prepare(dir, "26.3", true)
      expect(await fs.readFile(file, "utf8")).toBe(recent)
      await restarted.commit()
      await restarted.rollback()
      expect(await fs.readFile(file, "utf8")).toBe(recent)
    }))

    test("rollback восстанавливает язык после следующего этапа и допускает повторный вызов", () => fixture(async (dir, file) => {
      await fs.writeFile(file, old)
      const transaction = await prepare(dir, "1.1", true)
      await fs.writeFile(file, old.replace("ru_RU", "en_US"))
      await transaction.rollback()
      await transaction.rollback()
      expect(await fs.readFile(file, "utf8")).toBe(old)
    }))

    test("формат биндов проверяется без маркеров графики, mod-бинды тоже преобразуются", () => fixture(async (dir, file) => {
      await fs.writeFile(file, "key_Zoom:key.keyboard.c\nkey_key.forward:key.keyboard.w\n")
      await prepareOptionsCompatibility(dir, "1.1", true)
      const result = await fs.readFile(file, "utf8")
      expect(result).toContain("key_Zoom:46")
      expect(result).toContain("key_key.forward:17")
    }))

    test("журнал переживает аварийное завершение отдельного процесса", () => fixture(async (dir, file) => {
      await fs.writeFile(file, recent)
      const modulePath = path.resolve("electrobun/main/options-compatibility.ts")
      const child = Bun.spawnSync([process.execPath, "-e", 'const {prepareOptionsCompatibility}=await import(process.env.A25_MODULE); await prepareOptionsCompatibility(process.env.A25_ROOT,"1.1",true); process.exit(23)'], {
        env: { ...process.env, A25_MODULE: modulePath, A25_ROOT: dir }, stdout: "pipe", stderr: "pipe",
      })
      expect(child.exitCode).toBe(23)
      expect(await fs.readFile(file, "utf8")).not.toBe(recent)
      await prepareOptionsCompatibility(dir, "26.3", true)
      expect(await fs.readFile(file, "utf8")).toBe(recent)
    }))

    test("контракт launch pipeline: только общий каталог, commit после старта, rollback при ошибке", async () => {
      const source = await fs.readFile(path.resolve("electrobun/main/launch-orchestrator.ts"), "utf8")
      expect(source).toContain("!request.buildName && !request.buildId && sameRoot")
      expect(source.indexOf("optionsTransaction = await prepareOptionsCompatibility")).toBeLessThan(source.indexOf("await syncMinecraftLanguage"))
      expect(source.indexOf("await syncMinecraftLanguage")).toBeLessThan(source.indexOf("const worker = fork"))
      const started = source.slice(source.indexOf('case "started":'), source.indexOf('case "stdout":'))
      expect(started).toContain("optionsTransaction?.commit()")
      expect(source).toContain("optionsTransaction.rollback()")
    })

    test("повреждённый журнал не удаляет настройки", () => fixture(async (dir, file) => {
      await fs.writeFile(file, recent)
      await fs.mkdir(path.join(dir, ".xneon-options"))
      await fs.writeFile(path.join(dir, ".xneon-options", "pending.json"), JSON.stringify({ original: "invalid!", state: null }))
      await expect(prepare(dir, "1.1", true)).rejects.toThrow("Invalid options recovery bytes")
      expect(await fs.readFile(file, "utf8")).toBe(recent)
    }))
  })
}

{
  const test = nodeTest
  describe("xn-connect-relay", () => {
    test("XN-Connect forwards TCP and reports running after the relay handshake", async () => {
      const sockets = new Set()
      const sid = "qa-session"
      const encode = (type, payload) => {
        const out = Buffer.alloc(15 + payload.length)
        out.writeUInt32LE(payload.length)
        out[4] = type
        out.write(sid, 5, 10)
        payload.copy(out, 15)
        return out
      }
      const listen = async server => { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port }
      const backend = net.createServer(socket => { sockets.add(socket); socket.on("data", data => socket.write(data)) })
      const backendPort = await listen(backend)
      let check
      const echoed = new Promise(resolve => { check = resolve })
      const relay = net.createServer(socket => {
        sockets.add(socket)
        let backlog = Buffer.alloc(0)
        socket.on("data", data => {
          backlog = Buffer.concat([backlog, data])
          while (backlog.length >= 15 && backlog.length >= 15 + backlog.readUInt32LE()) {
            const length = backlog.readUInt32LE()
            const frame = backlog.subarray(0, 15 + length)
            backlog = backlog.subarray(15 + length)
            if (frame[4] === 1) {
              assert.equal(frame.subarray(15).toString(), "qa-token")
              socket.write(encode(2, Buffer.from(sid)))
              const payload = Buffer.alloc(8)
              payload.writeUInt32LE(1)
              payload.write("ping", 4)
              setTimeout(() => socket.write(encode(3, payload)), 75)
            } else if (frame[4] === 3) check(frame.subarray(19).toString())
          }
        })
      })
      const relayPort = await listen(relay)
      const states = []
      const tunnel = await runTunnel({
        id: "qa-tunnel", name: "QA", protocol: "tcp", status: "active", access_token: "qa-token", public_host: "127.0.0.1",
        local_ip: "127.0.0.1", local_port: backendPort, public_port: 0, block_reason: "", is_blocked: false, node_count: 1,
        nodes: [{ id: "qa", name: "QA", location: "", flag: "", host: "127.0.0.1", public_host: "127.0.0.1", status: "online", port: relayPort }],
      }, { onLog: () => {}, onStateChange: state => states.push(state) })
      let timer
      try {
        assert.equal(await Promise.race([echoed, new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error("relay timeout")),5000) })]), "ping")
        assert(states.includes("running"))
        console.log("XN-Connect: Bun relay handshake and TCP round trip passed on loopback")
      } finally {
        clearTimeout(timer)
        tunnel.stop()
        for (const socket of sockets) socket.destroy()
        relay.close()
        backend.close()
      }
    })
  })
}
