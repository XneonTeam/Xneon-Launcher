import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { ServerManager } from "../../packages/xnlc-servers/src/server-manager.ts"
import { readWindowsProcessMetrics } from "../../electrobun/platform/process-metrics.ts"

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
