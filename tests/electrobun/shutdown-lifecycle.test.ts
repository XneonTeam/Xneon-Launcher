import { expect, test } from "bun:test"
import { ShutdownCoordinator } from "../../electrobun/platform/shutdown"

test("завершение ждёт все задачи и закрывает БД после файлов даже при ошибке", async () => {
  const calls: string[] = []
  const shutdown = new ShutdownCoordinator({ deadlineMs: 300, log: () => {} })
  shutdown.register("files", async () => {
    await new Promise(resolve => setTimeout(resolve, 15))
    calls.push("files")
  }, { priority: 1 })
  shutdown.register("network", () => { throw new Error("offline") }, { priority: 1 })
  shutdown.register("db", () => { calls.push("db") }, { priority: 0 })
  shutdown.onExit(() => { calls.push("exit") })
  const first = shutdown.run()
  expect(shutdown.run()).toBe(first)
  const outcome = await first
  expect(calls).toEqual(["files", "db", "exit"])
  expect(outcome.failed.map(item => item.name)).toEqual(["network"])
})

test("локальный таймаут не отменяет остальные задачи, общий дедлайн ограничивает выход", async () => {
  const calls: string[] = []
  const shutdown = new ShutdownCoordinator({ deadlineMs: 60, log: () => {} })
  shutdown.register("stuck", () => new Promise(() => {}), { priority: 2, timeoutMs: 10 })
  shutdown.register("db", () => { calls.push("db") }, { priority: 1 })
  shutdown.register("stuck-again", () => new Promise(() => {}), { priority: 0 })
  shutdown.onExit(() => { calls.push("exit") })
  const result = await shutdown.run()
  expect(result.status).toBe("deadline")
  expect(result.timedOut).toEqual(["stuck"])
  expect(calls).toEqual(["db", "exit"])
})

test("staged files участвуют в общем барьере, без повторных app.quit", () => {
  const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import { EventEmitter } from "node:events"
    import { access } from "node:fs/promises"
    const app = Object.assign(new EventEmitter(), { quit() { throw new Error("unexpected recursive quit") } })
    mock.module("./electrobun/platform/desktop.ts", () => ({ app }))
    const { beginUpload, appendUpload, registerStagedFileCleanup } = await import("./electrobun/platform/staged-files.ts")
    const { launcherShutdown } = await import("./electrobun/platform/shutdown.ts")
    registerStagedFileCleanup()
    const upload = await beginUpload("test.zip", 3)
    const file = await appendUpload(upload.id, Buffer.from("zip").toString("base64"), true)
    await launcherShutdown.run()
    await assert.rejects(access(file), { code: "ENOENT" })
  `
  const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})
