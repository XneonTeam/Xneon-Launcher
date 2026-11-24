// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import test, { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { readWindowsProcessCommandLine } from "../../electrobun/platform/windows-command-line.ts"
import { readWindowsLauncherArgs } from "../../electrobun/platform/windows-native.ts"
import { fileURLToPath } from "node:url"
import os from "node:os"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { ServerManager } from "../../packages/xnlc-servers/src/server-manager.ts"
import { readWindowsProcessMetrics } from "../../electrobun/platform/process-metrics.ts"
import path from "node:path"
import { findExecutablesInPath } from "../../electrobun/platform/executable-path.ts"
import { readJavaHomesFromRegistry } from "../../electrobun/platform/java-registry.ts"
import { execFile } from "node:child_process"
import { execFileAsync as run } from "../../electrobun/main/import/helpers.ts"
import { getJavaInstallationInfo } from "../../electrobun/main/java-discovery.ts"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { launcherEntryUrl } from "../../electrobun/platform/dev-renderer.ts"

{
  describe("windows-launcher-args", () => {
    test("аргументы родителя не используют WMI/PowerShell", () => {
      const source = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
      const body = source.match(/export async function readWindowsLauncherArgs\([\s\S]*?\n\}/)[0]
      assert.doesNotMatch(body, /Get-CimInstance|exec\(|powershell/)
    })
    test("NT возвращает строку только для проверенного EXE", { skip: process.platform !== "win32" }, () => {
      const command = readWindowsProcessCommandLine(process.pid, process.execPath)
      assert.ok(command && command.includes("bun"))
      assert.equal(readWindowsProcessCommandLine(process.pid, "C:\\not-our-launcher.exe"), null)
      assert.equal(readWindowsProcessCommandLine(0xffffffff, process.execPath), null)
    })
    test("обычный запуск без --launch не требует внешнего процесса", { skip: process.platform !== "win32" }, async () => {
      assert.deepEqual(await readWindowsLauncherArgs(), [])
      const start = performance.now()
      for (let i = 0; i < 100; i++) await readWindowsLauncherArgs()
      console.log(`Аргументы без --launch, среднее: ${((performance.now() - start) / 100).toFixed(3)} ms`)
    })
    test("настоящий argv сохраняет Unicode, пробелы и флаг --launch", { skip: process.platform !== "win32" }, () => {
      const modulePath = fileURLToPath(new URL("../../electrobun/platform/windows-native.ts", import.meta.url))
      const code = `const {readWindowsLauncherArgs}=await import(${JSON.stringify(modulePath)}); console.log(JSON.stringify(await readWindowsLauncherArgs()));`
      const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code, "--", "--launch", "Сборка с пробелами 尾"], { stdout: "pipe", stderr: "pipe" })
      assert.equal(child.exitCode, 0)
      const args = JSON.parse(child.stdout.toString())
      assert.deepEqual(args.slice(-2), ["--launch", "Сборка с пробелами 尾"])
    })
  })
}

{
  describe("windows-process-metrics", () => {
    test("метрики Windows не запускают PowerShell", () => {
      const source = fs.readFileSync(new URL("../../packages/xnlc-servers/src/server-manager.ts", import.meta.url), "utf8")
      assert.doesNotMatch(source, /Get-Process|execAsync\(/)
    })
    test("порт метрик сохраняет формулу CPU и обрабатывает завершение процесса", async () => {
      const manager = new ServerManager()
      let sample = { cpuMilliseconds: 100, workingSetBytes: 32 * 1024 ** 2 }
      manager.setProcessMetricsReader(() => sample)
      manager.running.set("test", { process: { pid: process.pid }, startTime: Date.now() })
      const first = await manager.getMetrics("test")
      assert.equal(first.memoryMb, 32)
      assert.equal(first.cpuPercent, 0)
      manager.cpuSamples.set("test", { ticks: 100, at: Date.now() - 1000 })
      sample = { cpuMilliseconds: 1100, workingSetBytes: 64 * 1024 ** 2 }
      const second = await manager.getMetrics("test")
      assert.equal(second.memoryMb, 64)
      assert.ok(second.cpuPercent >= 0 && second.cpuPercent <= 100)
      assert.ok(Math.abs(second.cpuPercent - Math.round(100 / os.cpus().length)) <= 1)
      sample = null
      assert.equal((await manager.getMetrics("test")).memoryMb, 0)
    })
    for (const failure of ["exit", "times", "memory", "success"]) {
      test(`HANDLE закрывается после ${failure}`, () => {
        const source = fs.readFileSync(new URL("../../electrobun/platform/process-metrics.ts", import.meta.url), "utf8")
        const code = transformSync(source, { loader: "ts", format: "cjs" }).code
        const module = { exports: {} }
        let closed = 0
        vm.runInNewContext(code, { module, Buffer, process: { platform: "win32" }, require: () => ({
          ptr: data => data,
          dlopen: () => ({ symbols: {
            OpenProcess: () => 123,
            CloseHandle: handle => { assert.equal(handle, 123); closed++; return true },
            GetExitCodeProcess: (_handle, exit) => { exit[0] = failure === "exit" ? 0 : 259; return true },
            GetProcessTimes: () => failure !== "times",
            K32GetProcessMemoryInfo: () => failure !== "memory",
          } }),
        }) })
        const result = module.exports.readWindowsProcessMetrics(123)
        assert.equal(closed, 1)
        assert.equal(result !== null, failure === "success")
      })
    }
    test("WinAPI читает текущий процесс и безопасно отклоняет отсутствующий", { skip: process.platform !== "win32" }, () => {
      const sample = readWindowsProcessMetrics(process.pid)
      assert.ok(sample && sample.workingSetBytes > 0 && sample.cpuMilliseconds >= 0)
      assert.equal(readWindowsProcessMetrics(0xffffffff), null)
      assert.equal(readWindowsProcessMetrics(-1), null)
    })
  })
}

{
  function javaParser(execute = run) {
    return executable => getJavaInstallationInfo(executable, execute)
  }
  describe("java-discovery", () => {
    test("поиск Java и NSIS не запускает where/which", () => {
      const source = fs.readFileSync(new URL("../../electrobun/main/java-discovery.ts", import.meta.url), "utf8")
      assert.equal(/execAsync\("(?:where|which)|execFileSync\("where"/.test(source), false)
      const build = fs.readFileSync(new URL("../../scripts/build-windows-distribution.ts", import.meta.url), "utf8")
      assert.equal(build.includes('Bun.spawnSync(["where.exe"'), false)
    })
    test("PATH: все совпадения, PATHEXT, пробелы/кириллица и удаление дублей", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "java-path-"))
      try {
        const directories = ["Java папка 1", "Java папка 2"].map(name => path.join(root, name))
        for (const dir of directories) {
          fs.mkdirSync(dir)
          fs.writeFileSync(path.join(dir, "java.EXE"), "fixture", { mode: 0o755 })
        }
        const name = process.platform === "win32" ? "java" : "java.EXE"
        const found = findExecutablesInPath(name, { PATH: [...directories, directories[0]].join(path.delimiter), PATHEXT: ".EXE;.CMD" })
        assert.deepEqual(found.map(file => path.dirname(file)), directories)
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })

    test("проверка Java не использует shell-перенаправления или CP866", () => {
      const code = fs.readFileSync(new URL("../../electrobun/main/java-discovery.ts", import.meta.url), "utf8")
      assert.equal(/2>&1|cp866|execAsync\(/.test(code), false)
    })
    test("реестр Java не читается через reg.exe или shell", () => {
      const source = fs.readFileSync(new URL("../../electrobun/main/java-discovery.ts", import.meta.url), "utf8")
      assert.equal(/reg query|execAsync\(/.test(source), false)
    })

    test("прямой запуск: Unicode/пробелы в пути, отдельные потоки, shell-символы в аргументе", async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "Ява с пробелами-"))
      try {
        const executable = path.join(directory, process.platform === "win32" ? "java.exe" : "java")
        fs.linkSync(process.execPath, executable)
        const argument = 'кириллица & | > ; $() 尾'
        const result = await run(executable, ["-e", 'process.stdout.write(process.argv.at(-1)); process.stderr.write("version from stderr")', "--", argument], { timeout: 4000 })
        assert.equal(result.stdout, argument)
        assert.equal(result.stderr, "version from stderr")
        await assert.rejects(run(executable, ["-e", "setInterval(()=>{},1000)"], { timeout: 150 }))
        await assert.rejects(run(executable, ["-e", "process.exit(3)"], { timeout: 4000 }))
      } finally { fs.rmSync(directory, { recursive: true, force: true }) }
    })

    test("Java: разбор stderr/stdout и fallback -version", async () => {
      for (const stream of ["stdout", "stderr"]) {
        const parse = javaParser(async (_file, args) => {
          assert.deepEqual([...args], ["-XshowSettings:properties", "-version"])
          return { stdout: "", stderr: "", [stream]: ' java.version = 21.0.1\n java.vendor = Тестовый поставщик\n sun.arch.data.model = 64\n' }
        })
        assert.deepEqual({ ...await parse("C:\\Ява с пробелами\\java.exe") }, { version: "21.0.1", fullVersion: "21.0.1", vendor: "Тестовый поставщик", arch: "64" })
      }
      const calls = []
      const parse = javaParser(async (_file, args) => {
        calls.push([...args])
        return { stdout: "", stderr: args.length === 1 ? 'openjdk version "17.0.2"' : "no properties" }
      })
      assert.equal((await parse("java")).version, "17.0.2")
      assert.deepEqual(calls, [["-XshowSettings:properties", "-version"], ["-version"]])
    })

    test("реестр: оба WOW64-представления, Unicode и закрытие ключей при ошибке", () => {
      const source = fs.readFileSync(new URL("../../electrobun/platform/java-registry.ts", import.meta.url), "utf8")
      const code = transformSync(source, { loader: "ts", format: "cjs" }).code
      for (const fail of [false, true]) {
        let next = 1n
        const open = new Map()
        const views = new Set()
        let closed = 0
        const symbols = {
          RegOpenKeyExW: (parent, name, _options, flags, output) => {
            const key = name.toString("utf16le").replace(/\0$/, "")
            if (parent === 0xffffffff80000002n && !key.endsWith("\\JDK")) return 2
            const view = flags & 0x300
            assert.equal(flags & 0x20019, 0x20019)
            views.add(view)
            output[0] = next++
            open.set(output[0], { child: parent !== 0xffffffff80000002n, view })
            return 0
          },
          RegGetValueW: (key, _subkey, name, flags, _type, data, size) => {
            if (fail) throw new Error("simulated registry failure")
            const entry = open.get(key)
            if (!entry.child || name.toString("utf16le") !== "JavaHome\0") return 2
            assert.equal(flags, 6)
            const value = Buffer.from(`C:\\Ява с пробелами ${entry.view}\0`, "utf16le")
            size[0] = value.length
            if (data) value.copy(data)
            return 0
          },
          RegEnumKeyExW: (key, index, name, length) => {
            if (open.get(key).child || index > 0) return 259
            name.write("версия", "utf16le"); length[0] = 6; return 0
          },
          RegCloseKey: key => { assert.ok(open.delete(key)); closed++; return 0 },
        }
        let unloaded = false
        const module = { exports: {} }
        vm.runInNewContext(code, { module, Buffer, process: { platform: "win32" }, require: () => ({ ptr: value => value, dlopen: () => ({ symbols, close: () => { unloaded = true } }) }) })
        if (fail) assert.throws(module.exports.readJavaHomesFromRegistry, /simulated/)
        else {
          assert.deepEqual([...module.exports.readJavaHomesFromRegistry()], ["C:\\Ява с пробелами 256", "C:\\Ява с пробелами 512"])
          assert.deepEqual([...views], [0x100, 0x200])
        }
        assert.equal(open.size, 0)
        assert.ok(closed > 0)
        assert.equal(unloaded, true)
      }
    })

    // Каждая найденная JVM имеет собственный лимит 6 с + 4 с fallback; на CI установлено несколько JDK.
    test("реальная Windows: обнаруженные JDK из реестра и PATH запускаются напрямую", { skip: process.platform !== "win32", timeout: 120000 }, async () => {
      const homes = readJavaHomesFromRegistry()
      const candidates = [...homes.map(home => path.join(home, "bin/java.exe")), ...findExecutablesInPath("java")]
      const versions = []
      for (const file of new Set(candidates)) {
        if (!fs.existsSync(file) || !file.toLowerCase().endsWith(".exe")) continue
        const info = await javaParser()(file)
        if (info) versions.push(info.version)
      }
      console.log(`Java: реестр=${homes.length}, PATH=${findExecutablesInPath("java").length}, проверенные версии=${versions.join(", ") || "нет установленных JDK"}`)
      if (candidates.some(file => fs.existsSync(file) && file.toLowerCase().endsWith(".exe"))) assert.ok(versions.length > 0)
    })

    test("NSIS: переменная окружения важнее Bun.which, резервные пути сохранены", () => {
      const source = fs.readFileSync(new URL("../../scripts/build-windows-distribution.ts", import.meta.url), "utf8")
      const code = transformSync(source.slice(source.indexOf("function findMakensis")), { loader: "ts" }).code
      const f = (env, onPath = "path.exe") => vm.runInNewContext(code + "\nfindMakensis()", {
        process: { env }, assert, path: path.win32, existsSync: file => file === "custom.exe" || file.endsWith("NSIS\\makensis.exe"),
        Bun: { which: () => onPath }, readdirSyncSafe: () => [],
      })
      assert.equal(f({ XNEON_MAKENSIS: "custom.exe" }), "custom.exe")
      assert.equal(f({}), "path.exe")
      assert.equal(f({}, null), path.win32.join("C:\\Program Files", "NSIS", "makensis.exe"))
      assert.throws(() => f({ XNEON_MAKENSIS: "missing.exe" }), /does not exist/)
    })

    test("реальный JDK запускается через путь с пробелами и кириллицей", { skip: process.platform !== "win32" }, async context => {
      const home = readJavaHomesFromRegistry().find(home => fs.existsSync(path.join(home, "bin/java.exe")))
      if (!home) { context.skip("Нет установленного JDK в реестре"); return }
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "java-unicode-"))
      const link = path.join(directory, "Java кириллица с пробелами 尾")
      try {
        fs.symlinkSync(home, link, "junction")
        const info = await javaParser()(path.join(link, "bin/java.exe"))
        assert.ok(info?.version)
        console.log(`Настоящая Java через Unicode-путь: ${info.version}`)
      } finally {
        if (fs.existsSync(link)) fs.unlinkSync(link) // Удаляем только тестовую ссылку, не целевой JDK.
        fs.rmdirSync(directory)
      }
    })
  })
}

{
  const test = nodeTest
  const source = fs.readFileSync(new URL("../../electrobun/platform/desktop.ts", import.meta.url), "utf8")
  const code = transformSync(source.slice(source.indexOf("export class DesktopWindow"), source.indexOf("export const viewSession")), { loader: "ts", format: "cjs" }).code

  function fixture(platform, options, hmr = false, channel = "dev") {
    const calls = []
    let frame
    let renderer
    let windowOptions
    class NativeWindow extends EventEmitter {
      ptr = 1
      webview = { id: 1, on() {} }
      constructor(options) {
        super()
        windowOptions = options
        frame = { width: options.frame.width, height: options.frame.height }
        renderer = options.renderer
        calls.push("create")
      }
      setSize(width, height) { frame = { width, height }; calls.push("size") }
      center() { calls.push("center") }
      show() { calls.push("show") }
    }
    const module = { exports: {} }
    vm.runInNewContext(code, {
      module, exports: module.exports, NativeWindow, EventEmitter,
      BrowserView: { defineRPC: () => ({ send: { launcherEvent() {} } }) },
      ViewSession: class { id = 1; destroy() {} },
      process: { platform }, windows: new Map(), Electrobun: { events: new EventEmitter() },
      build: { isPackaged: false, channel }, appUserModelId: undefined,
      launcherEntryUrl, XNEON_DEV_HMR: hmr,
      startNativeSmokeProbe: () => () => {},
      enableWindowsWindowTransitions() {},
      setWindowsWindowIcons: () => () => {},
      setWindowsWindowClientWidth: (_handle, width) => { frame.width = width + 16; calls.push("client-size") },
    })
    new module.exports.DesktopWindow({ width: 1280, height: 800, launcher: true, ...options })
    return { frame, clientWidth: frame.width - 16, calls, renderer, windowOptions }
  }
  describe("launcher-window-size", () => {
    test("HMR меняет только entry dev-окна и сохраняет native RPC и ограничения навигации", () => {
      const dev = fixture("win32", {}, true).windowOptions
      assert.equal(dev.url, "http://127.0.0.1:5173/")
      assert.deepEqual(JSON.parse(dev.navigationRules), ["^*", dev.url, `${dev.url}#*`])
      assert.ok(dev.rpc)
      assert.equal(dev.sandbox, false)
      for (const channel of ["stable", "canary"]) assert.equal(fixture("win32", {}, true, channel).windowOptions.url, "views://launcher/index.html")
      assert.equal(fixture("win32", { launcher: false }, true).windowOptions.url, "about:blank")
    })
    test("Windows: внутренняя ширина лаунчера 1280 сохраняется до показа окна", () => {
      const f = fixture("win32")
      assert.equal(f.clientWidth, 1280)
      assert.deepEqual(f.frame, { width: 1296, height: 800 })
      assert.deepEqual(f.calls, ["create", "client-size", "center", "show"])
    })

    test("Windows: скрытое окно получает размер, но не показывается раньше времени", () => {
      const f = fixture("win32", { show: false })
      assert.equal(f.clientWidth, 1280)
      assert.deepEqual(f.frame, { width: 1296, height: 800 })
      assert.deepEqual(f.calls, ["create", "client-size", "center"])
    })

    test("Другие платформы и окна авторизации не меняют свою геометрию", () => {
      assert.deepEqual(fixture("linux").calls, ["create"])
      assert.deepEqual(fixture("darwin").calls, ["create"])
      assert.deepEqual(fixture("win32", { launcher: false }).calls, ["create"])
    })

    test("Окна лаунчера и OAuth используют CEF только на Linux", () => {
      for (const platform of ["win32", "darwin", "linux"]) {
        for (const launcher of [true, false]) {
          assert.equal(fixture(platform, { launcher }).renderer, platform === "linux" ? "cef" : "native")
        }
      }
    })

    function nativeClientSizer(initialWidth = 1280, clientWidth = 1264, fail = false) {
      const nativeSource = fs.readFileSync(new URL("../../electrobun/platform/windows-native.ts", import.meta.url), "utf8")
      const helper = nativeSource.match(/export function setWindowsWindowClientWidth\([\s\S]*?\n\}/)?.[0]
      assert.ok(helper)
      const code = transformSync(helper.replace("export ", ""), { loader: "ts" }).code
      let outer = initialWidth
      let client = clientWidth
      let closed = false
      const sizes = []
      const resize = vm.runInNewContext(`(${code})`, {
        process: { platform: "win32" },
        dlopen: () => ({
          symbols: {
            GetWindowRect: (_handle, rect) => { rect.set([100, 50, 100 + outer, 850]); return 1 },
            GetClientRect: (_handle, rect) => { rect.set([0, 0, client, 792]); return 1 },
            SetWindowPos: (_handle, _after, _x, _y, width, height, flags) => {
              sizes.push({ width, height, flags })
              if (fail) return 0
              client += width - outer
              outer = width
              return 1
            },
          },
          close() { closed = true },
        }),
      })
      return { resize, sizes, client: () => client, closed: () => closed }
    }

    test("Win32: ширина рамки измеряется, Client Width становится 1280 без изменения высоты", () => {
      for (const border of [16, 24, 0]) {
        const f = nativeClientSizer(1280, 1280 - border)
        f.resize(1, 1280)
        assert.equal(f.client(), 1280)
        assert.equal(f.closed(), true)
        if (border) assert.deepEqual(f.sizes, [{ width: 1280 + border, height: 800, flags: 0x16 }])
        else assert.equal(f.sizes.length, 0)
      }
    })

    test("Win32: ошибка изменения размера не скрывается и освобождает библиотеку", () => {
      const f = nativeClientSizer(1280, 1264, true)
      assert.throws(() => f.resize(1, 1280), /client width/i)
      assert.equal(f.closed(), true)
    })
  })
}

{
  const root = path.resolve(import.meta.dir, "../..")
  const source = fs.readFileSync(path.join(root, "electrobun/platform/windows-native.ts"), "utf8")
  const saveSource = source.match(/export async function saveFile\([\s\S]*?\n\}/)?.[0]
  assert.ok(saveSource)
  const saveCode = transformSync(saveSource + "\nmodule.exports = saveFile", { loader: "ts", format: "cjs" }).code

  function fixture({ selected = "C:\\Экспорт\\мир.zip", backend = "ffi", exists = true, error } = {}) {
    const calls = []
    const errors = []
    const file = "C:\\bundle\\Resources\\app\\native\\nfd\\win32-x64\\nfd.dll"
    const module = { exports: {} }
    vm.runInNewContext(saveCode, {
      module, exports: module.exports, path: path.win32,
      process: { platform: "win32" },
      nativeFileDialogLibraryPath: () => file,
      existsSync: name => { assert.equal(name, file); return exists },
      console: { error: (...args) => errors.push(args) },
      nfd: {
        setLibraryPath: directory => calls.push(["library", directory]),
        getBackendName: () => { calls.push(["backend"]); return backend },
        saveFile: async options => { calls.push(["save", options]); if (error) throw error; return selected },
      },
      powershell: "powershell.exe", startup: [],
      exec: () => { throw new Error("PowerShell save dialog must not be used") },
    })
    return { save: module.exports, calls, errors, file }
  }
  describe("native-save-dialog", () => {
    test("сохранение использует FFI и сохраняет контракт пути, имени и фильтров", async () => {
      const f = fixture()
      const filters = [{ name: "Архив", extensions: ["zip", "mrpack"] }]
      const result = await f.save("C:\\Экспорт\\сборка.zip", filters)
      assert.deepEqual({ ...result }, { canceled: false, filePath: "C:\\Экспорт\\мир.zip" })
      assert.deepEqual(f.calls.slice(0, 2), [["library", path.win32.dirname(f.file)], ["backend"]])
      assert.deepEqual({ ...f.calls[2][1] }, { defaultPath: "C:\\Экспорт", defaultName: "сборка.zip", filters })
    })

    test("отмена нативного диалога возвращает прежний canceled/filePath", async () => {
      const f = fixture({ selected: null })
      assert.deepEqual({ ...await f.save("theme.xntheme") }, { canceled: true, filePath: undefined })
      assert.equal(f.calls[2][1].defaultName, "theme.xntheme")
      assert.equal(f.calls[2][1].defaultPath, undefined)
    })

    test("вызов без параметров не подставляет имя или фильтр", async () => {
      const f = fixture()
      await f.save()
      assert.deepEqual({ ...f.calls[2][1] }, { defaultPath: undefined, defaultName: undefined, filters: undefined })
    })

    test("отсутствующий бинарник запрещает инициализацию и тихий фолбэк", async () => {
      const f = fixture({ exists: false })
      await assert.rejects(f.save("test.zip"), /Native file dialog library is missing/)
      assert.deepEqual(f.calls, [])
      assert.equal(f.errors.length, 1)
    })

    for (const backend of ["windows", "macos", "linux", "unknown"]) {
      test(`бэкенд ${backend} не открывает скриптовый диалог`, async () => {
        const f = fixture({ backend })
        await assert.rejects(f.save("test.zip"), /Native file dialog FFI backend is unavailable/)
        assert.equal(f.calls.some(([name]) => name === "save"), false)
        assert.equal(f.errors.length, 1)
      })
    }

    test("ошибка нативной библиотеки логируется и передаётся вызывающему коду", async () => {
      const error = new Error("NFD failed")
      const f = fixture({ error })
      await assert.rejects(f.save(), candidate => candidate === error)
      assert.equal(f.errors.length, 1)
    })

    function resourcesFixture(platform, arch, packaged) {
      const p = platform === "win32" ? path.win32 : path.posix
      const execPath = platform === "win32" ? "C:\\bundle\\bin\\bun.exe"
        : platform === "darwin" ? "/bundle/Contents/MacOS/bun" : "/bundle/bin/bun"
      const moduleDirectory = platform === "win32" ? "C:\\repo\\electrobun\\platform" : "/repo/electrobun/platform"
      const resources = p.resolve(p.dirname(execPath), "..", "Resources", "app")
      const module = { exports: {} }
      const resourceSource = fs.readFileSync(path.join(root, "electrobun/platform/resources.ts"), "utf8")
        .replaceAll("import.meta.dir", JSON.stringify(moduleDirectory))
      const code = transformSync(resourceSource, { loader: "ts", format: "cjs" }).code
      vm.runInNewContext(code, { module, exports: module.exports,
        require: name => name === "node:path" ? p : { existsSync: file => packaged && file === resources },
        process: { platform, arch, execPath },
      })
      assert.equal(typeof module.exports.nativeFileDialogLibraryPath, "function")
      return { resolve: module.exports.nativeFileDialogLibraryPath, resources, moduleDirectory, p }
    }

    for (const [platform, arch, filename] of [["win32", "x64", "nfd.dll"], ["darwin", "arm64", "libnfd.dylib"], ["darwin", "x64", "libnfd.dylib"], ["linux", "x64", "libnfd.so"]]) {
      for (const packaged of [true, false]) {
        test(`${platform}-${arch}: путь к библиотеке в ${packaged ? "бандле" : "исходниках"}`, () => {
          const f = resourcesFixture(platform, arch, packaged)
          const base = packaged ? f.p.join(f.resources, "native/nfd") : f.p.resolve(f.moduleDirectory, "../../assets/native/nfd")
          assert.equal(f.resolve(), f.p.join(base, `${platform}-${arch}`, filename))
        })
      }
    }

    test("неподдерживаемая архитектура не переключается на скриптовый бэкенд", () => {
      const f = resourcesFixture("linux", "arm64", false)
      assert.throws(f.resolve, /Unsupported native file dialog platform/)
    })

    test("все вендоренные бинарники совпадают с SHA-256 релиза", () => {
      const directory = path.join(root, "assets/native/nfd")
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"))
      assert.equal(manifest.version, "0.3.2")
      assert.equal(manifest.files.length, 4)
      for (const entry of manifest.files) {
        assert.equal(createHash("sha256").update(fs.readFileSync(path.join(directory, entry.path))).digest("hex"), entry.sha256)
      }
    })

    test("Electrobun копирует вендоренный каталог в Resources/app/native/nfd", () => {
      const code = transformSync(fs.readFileSync(path.join(root, "electrobun.config.ts"), "utf8"), { loader: "ts", format: "cjs" }).code
      const module = { exports: {} }
      vm.runInNewContext(code, { module, exports: module.exports, process: { platform: "win32", arch: "x64", env: {} }, require: name => {
        if (name === "./package.json") return { version: "1.0.8", description: "test" }
        if (name.endsWith("app-identity")) return { appIdentifier: "test", portableAppIdentifier: "test.portable" }
        if (name.endsWith("update-public-keys")) return { updateBaseUrls: { stable: "test", canary: "test-canary" } }
        if (name.endsWith("app-meta")) return { APP_NAME: "Xneon Launcher", APP_VERSION: "1.0.8", APP_USER_AGENT: "Xneon-Launcher/1.0.8" }
        throw new Error("Unexpected dependency: " + name)
      } })
      assert.equal(module.exports.default.build.copy["assets/native/nfd"], "native/nfd")
    })
  })
}
