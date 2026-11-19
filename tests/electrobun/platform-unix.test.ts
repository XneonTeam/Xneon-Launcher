// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { parseLinuxCmdline, parseDarwinProcArgs } from "../../electrobun/platform/unix-launcher-args.ts"
import { spawnSync } from "node:child_process"
import { createConnection } from "node:net"
import { lockLauncherProfile, unlockLauncherProfile } from "../../electrobun/platform/instance-lock.ts"
import { startCliListener, launcherCliEndpoint, forwardCli, cli } from "../../electrobun/main/cli.ts"
import { ServerManager } from "../../packages/xnlc-servers/src/server-manager.ts"
import { readProcessMetrics } from "../../electrobun/platform/process-metrics.ts"
import { createHash } from "node:crypto"

{
  describe("unix-ipc", () => {
    test("Unix-блокировка и CLI не являются win32-заглушками", () => {
      const lock = fs.readFileSync(new URL("../../electrobun/platform/instance-lock.ts", import.meta.url), "utf8")
      const boot = fs.readFileSync(new URL("../../electrobun/main/bootstrap.ts", import.meta.url), "utf8")
      assert.equal(lock.includes("acquireUnixFileLock"), true)
      assert.equal(boot.includes('primary && process.platform === "win32"'), false)
    })

    for (const scenario of ["missing", "socket", "file", "symlink", "foreign", "unlocked"]) {
      test(`осиротевший сокет: ${scenario}`, () => {
        const source = fs.readFileSync(new URL("../../electrobun/platform/unix-socket.ts", import.meta.url), "utf8")
        const module = { exports: {} }
        const removed = []
        vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
          module, process: { getuid: () => 1000 }, require: () => ({
            lstatSync: () => {
              if (scenario === "missing") throw Object.assign(new Error("absent"), { code: "ENOENT" })
              return { isSocket: () => scenario !== "file", isSymbolicLink: () => scenario === "symlink", uid: scenario === "foreign" ? 999 : 1000 }
            },
            unlinkSync: file => removed.push(file),
          }),
        })
        const run = () => module.exports.removeStaleUnixSocket("/private/launcher.sock", scenario !== "unlocked")
        if (["file", "symlink", "foreign", "unlocked"].includes(scenario)) assert.throws(run, /Refusing/)
        else run()
        assert.equal(removed.length, scenario === "socket" ? 1 : 0)
      })
    }

    for (const platform of ["darwin", "linux"]) {
      for (const mode of ["success", "busy", "error"]) {
        test(`flock ${platform}: ${mode}, дескриптор закрывается ровно один раз`, () => {
          const source = fs.readFileSync(new URL("../../electrobun/platform/unix-file-lock.ts", import.meta.url), "utf8")
          const module = { exports: {} }
          let closed = 0
          let unloaded = 0
          const operations = []
          const errno = Buffer.alloc(4)
          errno.writeInt32LE(mode === "busy" ? (platform === "darwin" ? 35 : 11) : 9)
          vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
            module, process: { platform, getuid: () => 1000 }, require: name => {
              if (name === "node:path") return path.posix
              if (name === "bun:ffi") return { read: { i32: data => data.readInt32LE(0) }, dlopen: () => ({ close: () => unloaded++, symbols: {
                flock: (fd, flags) => { assert.equal(fd, 42); operations.push(flags); return mode === "success" || flags === 8 ? 0 : -1 },
                __error: () => errno, __errno_location: () => errno,
              } }) }
              return { constants: {}, mkdirSync() {}, openSync: () => 42, closeSync: () => closed++, fstatSync: () => ({ isFile: () => true, uid: 1000 }) }
            },
          })
          if (mode === "error") assert.throws(() => module.exports.acquireUnixFileLock("/profile.lock"), /errno 9/)
          else {
            const unlock = module.exports.acquireUnixFileLock("/profile.lock")
            if (mode === "busy") assert.equal(unlock, null)
            else { assert.equal(closed, 0); unlock(); unlock(); assert.deepEqual(operations, [6, 8]) }
          }
          assert.equal(closed, 1)
          assert.equal(unloaded, 1)
        })
      }
    }

  })
}

{
  describe("unix-launcher-args", () => {
    test("bootstrap использует общий адаптер аргументов launcher", () => {
      const source = fs.readFileSync(new URL("../../electrobun/main/bootstrap.ts", import.meta.url), "utf8")
      assert.equal(source.includes("await readLauncherArgs()"), true)
    })

    const argv = ["/app/launcher", "--launch", "Сборка с пробелами 尾", "", "--option"]
    test("Linux cmdline сохраняет Unicode и пустые аргументы", () => {
      assert.deepEqual(parseLinuxCmdline(Buffer.from(argv.join("\0") + "\0")), argv.slice(1))
      assert.deepEqual(parseLinuxCmdline(Buffer.from("truncated")), [])
      assert.deepEqual(parseLinuxCmdline(Buffer.alloc(0)), [])
    })

    function macBuffer(argumentsList = argv) {
      const argc = Buffer.alloc(4)
      argc.writeInt32LE(argumentsList.length)
      return Buffer.concat([argc, Buffer.from("/app/launcher\0\0\0\0"), Buffer.from(argumentsList.join("\0") + "\0"), Buffer.from("PRIVATE_ENV=not-an-argument\0")])
    }

    test("KERN_PROCARGS2: argc, executable, padding, Unicode, пустой аргумент; без env", () => {
      assert.deepEqual(parseDarwinProcArgs(macBuffer()), argv.slice(1))
      assert.deepEqual(parseDarwinProcArgs(macBuffer(["/app/launcher"])), [])
      const bad = macBuffer()
      bad.writeInt32LE(-1)
      assert.deepEqual(parseDarwinProcArgs(bad), [])
      assert.deepEqual(parseDarwinProcArgs(macBuffer().subarray(0, 10)), [])
    })

    for (const platform of ["linux", "darwin"]) {
      for (const matched of [true, false]) {
        test(`parent ${platform}: подтверждён=${matched}`, () => {
          const source = fs.readFileSync(new URL("../../electrobun/platform/unix-launcher-args.ts", import.meta.url), "utf8")
          const module = { exports: {} }
          let commandRead = false
          vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
            module, Buffer, process: { platform, ppid: 123, execPath: "/app/bun" }, require: name => {
              if (name === "node:path") return path.posix
              if (name === "node:fs") return {
                realpathSync: value => value,
                readlinkSync: () => matched ? "/app/launcher" : "/app/other",
                readFileSync: () => { commandRead = true; return Buffer.from(argv.join("\0") + "\0") },
              }
              return { ptr: value => value, dlopen: file => ({ close() {}, symbols: file.includes("libproc") ? {
                proc_pidpath: (pid, buffer) => { assert.equal(pid, 123); return buffer.write(matched ? "/app/launcher" : "/app/other") },
              } : {
                sysctl: (mib, count, buffer, size) => {
                  commandRead = true
                  assert.deepEqual([...mib], [1, 49, 123]); assert.equal(count, 3)
                  const data = macBuffer()
                  size[0] = BigInt(data.length)
                  if (buffer) data.copy(buffer)
                  return 0
                },
              } }) }
            },
          })
          assert.deepEqual([...module.exports.readUnixLauncherArgs()], matched ? argv.slice(1) : [])
          assert.equal(commandRead, matched)
        })
      }
    }
  })
}

{
  const unix = process.platform === "linux" || process.platform === "darwin"
  describe("unix-native-smoke", () => {
    test("native Unix: flock, stale socket, права 0600 и пересылка CLI", { skip: !unix }, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "xneon-native-ipc-"))
      const profile = path.join(root, "profile.json")
      const endpoint = launcherCliEndpoint(profile)
      let server
      try {
        const crash = spawnSync(process.execPath, ["--no-env-file", "-e", `import net from 'node:net'; net.createServer().listen(${JSON.stringify(endpoint.pipe)},()=>process.kill(process.pid,'SIGKILL'))`], { timeout: 5000 })
        assert.notEqual(crash.status, 0)
        assert.ok(fs.lstatSync(endpoint.pipe).isSocket())
        await assert.rejects(startCliListener(profile), /profile lock/)
        assert.equal(lockLauncherProfile(profile), true)
        const module = fileURLToPath(new URL("../../electrobun/platform/instance-lock.ts", import.meta.url))
        const contend = spawnSync(process.execPath, ["--no-env-file", "-e", `const m=await import(${JSON.stringify(module)}); console.log(m.lockLauncherProfile(${JSON.stringify(profile)}))`], { encoding: "utf8", timeout: 5000 })
        assert.equal(contend.status, 0, contend.stderr)
        assert.equal(contend.stdout.trim(), "false")
        server = await startCliListener(profile)
        assert.equal(fs.statSync(endpoint.pipe).mode & 0o777, 0o600)
        assert.equal(fs.statSync(endpoint.tokenPath).mode & 0o777, 0o600)
        let focused = 0
        cli.attach(() => focused++, () => {})
        const denial = await new Promise((resolve, reject) => {
          const socket = createConnection(endpoint.pipe)
          socket.setTimeout(3000, () => socket.destroy(new Error("Authentication test timed out")))
          socket.on("error", reject)
          socket.on("connect", () => socket.write(JSON.stringify({ token: "invalid-token", build: null }) + "\n"))
          socket.on("data", data => { socket.destroy(); resolve(JSON.parse(data.toString())) })
        })
        assert.equal(denial.error, "Invalid launcher command")
        assert.equal(focused, 0)
        await forwardCli(profile, null)
        assert.equal(focused, 1)
        unlockLauncherProfile()
        const reacquire = spawnSync(process.execPath, ["--no-env-file", "-e", `const m=await import(${JSON.stringify(module)}); console.log(m.lockLauncherProfile(${JSON.stringify(profile)})); m.unlockLauncherProfile()`], { encoding: "utf8", timeout: 5000 })
        assert.equal(reacquire.stdout.trim(), "true")
      } finally {
        cli.detach(-1)
        if (server) await new Promise(resolve => server.close(resolve))
        unlockLauncherProfile()
        try { fs.unlinkSync(endpoint.pipe) } catch {}
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    test("native Linux: libsecret без D-Bus отказывает без plaintext-фолбэка", { skip: process.platform !== "linux" }, () => {
      const module = fileURLToPath(new URL("../../electrobun/platform/unix-safe-storage.ts", import.meta.url))
      const code = `const {unixSafeStorage:s}=await import(${JSON.stringify(module)}); const available=s.isEncryptionAvailable(); let rejected=false; try{s.encryptString('test-only')}catch{rejected=true} console.log(JSON.stringify({available,rejected}))`
      const result = spawnSync(process.execPath, ["--no-env-file", "-e", code], {
        env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-xneon-test-bus", DISPLAY: "", WAYLAND_DISPLAY: "" },
        encoding: "utf8", timeout: 10000,
      })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), { available: false, rejected: true })
    })

    test("native Linux: аргументы подтверждённого родительского launcher", { skip: process.platform !== "linux" }, () => {
      const root = fs.mkdtempSync(path.join(path.dirname(process.execPath), "xneon-native-args-"))
      try {
        const childBun = path.join(root, "bun")
        const launcher = path.join(root, "launcher")
        fs.linkSync(process.execPath, childBun)
        fs.linkSync(process.execPath, launcher)
        const module = fileURLToPath(new URL("../../electrobun/platform/unix-launcher-args.ts", import.meta.url))
        const child = `const m=await import(${JSON.stringify(module)}); console.log(JSON.stringify(m.readUnixLauncherArgs()))`
        const parent = `const r=Bun.spawnSync([${JSON.stringify(childBun)},'--no-env-file','-e',${JSON.stringify(child)}]); process.stdout.write(r.stdout); process.exit(r.exitCode)`
        const result = spawnSync(launcher, ["--no-env-file", "-e", parent, "--", "--launch", "Сборка с пробелами 尾"], { encoding: "utf8", timeout: 5000 })
        assert.equal(result.status, 0, result.stderr)
        assert.deepEqual(JSON.parse(result.stdout).slice(-2), ["--launch", "Сборка с пробелами 尾"])
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })
  })
}

{
  function adapter(platform, libraries, readFile, arch = "arm64") {
    const source = fs.readFileSync(new URL("../../electrobun/platform/process-metrics.ts", import.meta.url), "utf8")
    const module = { exports: {} }
    vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
      module, Buffer, process: { platform, arch },
      require: name => {
        if (name === "bun:ffi") return { ptr: value => value, dlopen: file => ({ symbols: libraries(file), close() {} }) }
        if (name === "node:fs/promises") return { readFile }
        throw new Error("Unexpected dependency: " + name)
      },
    })
    return module.exports
  }
  describe("unix-process-metrics", () => {
    for (const [numer, denom] of [[125, 3], [1, 1]]) {
      test(`macOS: CPU timebase ${numer}/${denom}, RSS и однократная инициализация`, () => {
        let initialized = 0
        const api = adapter("darwin", file => file.includes("libproc") ? {
          proc_pidinfo: (pid, flavor, arg, data, size) => {
            assert.equal(pid, 123); assert.equal(flavor, 4); assert.equal(arg, 0n); assert.equal(size, 96)
            data.writeBigUInt64LE(64n * 1024n ** 2n, 8)
            data.writeBigUInt64LE(24000000n, 16)
            data.writeBigUInt64LE(12000000n, 24)
            return 96
          },
        } : {
          mach_timebase_info: data => { initialized++; data.writeUInt32LE(numer, 0); data.writeUInt32LE(denom, 4); return 0 },
        }, undefined, numer === 125 ? "arm64" : "x64")
        assert.equal(typeof api.readDarwinProcessMetrics, "function")
        const expected = Number(36000000n * BigInt(numer) / BigInt(denom)) / 1e6
        for (let i = 0; i < 2; i++) {
          const result = api.readDarwinProcessMetrics(123)
          assert.equal(result.cpuMilliseconds, expected)
          assert.equal(result.workingSetBytes, 64 * 1024 ** 2)
        }
        assert.equal(initialized, 1)
      })
    }

    for (const returned of [-1, 0, 95]) {
      test(`macOS: недоступный/усечённый proc_pidinfo (${returned}) возвращает null`, () => {
        const api = adapter("darwin", file => file.includes("libproc") ? { proc_pidinfo: () => returned } : {
          mach_timebase_info: data => { data.writeUInt32LE(1, 0); data.writeUInt32LE(1, 4); return 0 },
        })
        assert.equal(typeof api.readDarwinProcessMetrics, "function")
        assert.equal(api.readDarwinProcessMetrics(123), null)
      })
    }

    function linuxStat(name, user = "200", system = "50") {
      const fields = Array(22).fill("0")
      fields[0] = "S"; fields[11] = user; fields[12] = system
      return `123 (${name}) ${fields.join(" ")}`
    }

    for (const name of ["java", "Minecraft server", "server (inner (nested)) tail)"]) {
      test(`Linux: comm=${name}, CLK_TCK и размер страницы из sysconf`, async () => {
        const queried = []
        const api = adapter("linux", () => ({ sysconf: key => { queried.push(key); return key === 2 ? 250n : 16384n } }),
          async file => file.endsWith("/statm") ? "100 16 0 0 0 0 0\n" : linuxStat(name))
        assert.equal(typeof api.readLinuxProcessMetrics, "function")
        for (let i = 0; i < 2; i++) {
          const result = await api.readLinuxProcessMetrics(123)
          assert.equal(result.cpuMilliseconds, 1000)
          assert.equal(result.workingSetBytes, 16 * 16384)
        }
        assert.deepEqual(queried, [2, 30])
      })
    }

    for (const code of ["ENOENT", "ESRCH", "EACCES"]) {
      test(`Linux: ${code} возвращает null`, async () => {
        const api = adapter("linux", () => ({ sysconf: () => 100n }), async () => { throw Object.assign(new Error(code), { code }) })
        assert.equal(typeof api.readLinuxProcessMetrics, "function")
        assert.equal(await api.readLinuxProcessMetrics(123), null)
      })
    }

    test("server-manager не содержит платформенного сбора метрик", () => {
      const source = fs.readFileSync(new URL("../../packages/xnlc-servers/src/server-manager.ts", import.meta.url), "utf8")
      const method = source.slice(source.indexOf("private async collectMetrics"), source.indexOf("getLogBuffer"))
      assert.equal(/process.platform|\/proc\//.test(method), false)
    })

    test("macOS: невалидный timebase не делит на ноль и не повторяет инициализацию", () => {
      let calls = 0
      const api = adapter("darwin", () => ({ mach_timebase_info: () => { calls++; return 0 } }))
      assert.equal(api.readDarwinProcessMetrics(0), null)
      assert.equal(calls, 0)
      assert.equal(api.readDarwinProcessMetrics(123), null)
      assert.equal(api.readDarwinProcessMetrics(123), null)
      assert.equal(calls, 1)
    })

    test("Linux: резервные единицы, повреждённые записи и завершившийся процесс", async () => {
      let stat = linuxStat("java")
      let statm = "100 16 0"
      const api = adapter("linux", () => { throw new Error("libc unavailable") }, async file => file.endsWith("statm") ? statm : stat)
      let sample = await api.readLinuxProcessMetrics(123)
      assert.equal(sample.cpuMilliseconds, 2500)
      assert.equal(sample.workingSetBytes, 16 * 4096)
      for (const invalid of ["garbage", linuxStat("java", "invalid"), linuxStat("java").replace(") S", ") Z")]) {
        stat = invalid
        assert.equal(await api.readLinuxProcessMetrics(123), null)
      }
      stat = linuxStat("java", "0", "0")
      statm = "0 0 0"
      sample = await api.readLinuxProcessMetrics(123)
      assert.equal(sample.cpuMilliseconds, 0)
      assert.equal(sample.workingSetBytes, 0)
      statm = "broken"
      assert.equal(await api.readLinuxProcessMetrics(123), null)
    })

    test("менеджер ждёт асинхронный порт, сбрасывает базу CPU при null/ошибке", async () => {
      const manager = new ServerManager()
      manager.running.set("sample", { process: { pid: 123 }, startTime: Date.now() })
      manager.setProcessMetricsReader(async () => ({ cpuMilliseconds: 1250, workingSetBytes: 16 * 1024 ** 2 }))
      assert.equal((await manager.getMetrics("sample")).memoryMb, 16)
      assert.ok(manager.cpuSamples.has("sample"))
      manager.setProcessMetricsReader(async () => null)
      assert.equal((await manager.getMetrics("sample")).cpuPercent, 0)
      assert.equal(manager.cpuSamples.has("sample"), false)
      manager.setProcessMetricsReader(async () => { throw new Error("process exited") })
      assert.equal((await manager.getMetrics("sample")).memoryMb, 0)
    })

    test("нативный Unix smoke: текущий и отсутствующий PID", { skip: !["linux", "darwin"].includes(process.platform) }, async () => {
      const sample = await readProcessMetrics(process.pid)
      assert.ok(sample && sample.workingSetBytes > 0 && sample.cpuMilliseconds >= 0)
      assert.equal(await readProcessMetrics(0x7fffffff), null)
    })
  })
}

{
  const root = path.resolve(import.meta.dir, "../..")
  function config() {
    const code = transformSync(fs.readFileSync(path.join(root, "electrobun.config.ts"), "utf8"), { loader: "ts", format: "cjs" }).code
    const module = { exports: {} }
    vm.runInNewContext(code, { module, process: { platform: "linux", arch: "x64", env: {} }, require: name => {
      if (name === "./package.json") return { version: "1.0.8", description: "test" }
      if (name.endsWith("app-identity")) return { appIdentifier: "test", portableAppIdentifier: "test.portable" }
      if (name.endsWith("update-public-keys")) return { updateBaseUrls: { stable: "test", canary: "test-canary" } }
      throw new Error("Unexpected dependency: " + name)
    } })
    return module.exports.default
  }
  describe("linux-cef-config", () => {
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
  })
}
