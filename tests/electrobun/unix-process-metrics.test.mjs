import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { ServerManager } from "../../packages/xnlc-servers/src/server-manager.ts"
import { readProcessMetrics } from "../../electrobun/platform/process-metrics.ts"

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
