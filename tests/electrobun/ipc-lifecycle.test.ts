// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { rpcRegistry, invokeHandler, ViewSession } from "../../electrobun/platform/ipc.ts"
import { validateInvokeResult, validateRpcValue } from "../../electrobun/platform/ipc-validation.ts"
import assert from "node:assert/strict"
import nodeTest from "node:test"
import { createRPC } from "../../.hutch/devkit/api/shared/rpc.ts"
import { CliQueue, parseCliLaunch } from "../../electrobun/main/cli.ts"
import { queryGpuAdapters } from "../../electrobun/platform/gpu.ts"
import { rpcTimeout } from "../../electrobun/platform/rpc-timeouts.ts"
import { ShutdownCoordinator } from "../../electrobun/platform/shutdown.ts"

{
  describe("ipc-contract-boundary", () => {
    test("IPC проверяет синхронный и асинхронный ответ; секреты не проходят даже при ошибке handler", async () => {
      let value = 42
      rpcRegistry.handle("system:get-total-memory", () => value)
      rpcRegistry.handle("settings:get", async (_context, key) => key)
      const sender = new ViewSession(9876, () => {})
      expect(invokeHandler(sender, { channel: "system:get-total-memory", args: [] })).toBe(42)
      expect(await invokeHandler(sender, { channel: "settings:get", args: ["language"] })).toBe("language")
      expect(() => invokeHandler(sender, { channel: "settings:get", args: [123] })).toThrow("argument type")
      value = NaN
      expect(() => invokeHandler(sender, { channel: "system:get-total-memory", args: [] })).toThrow("RPC number")
      expect(() => validateInvokeResult("db:load-accounts", [{ id: "a", username: "A", isActive: true, type: "microsoft", accessToken: "secret" }])).toThrow("public account DTO")
      sender.destroy()
      expect(() => invokeHandler(sender, { channel: "system:get-total-memory", args: [] })).toThrow("Invalid RPC")
    })

    test("RPC блокирует циклы и нечисловые значения, но допускает общие ссылки и undefined", () => {
      const cycle: { self?: object } = {}
      cycle.self = cycle
      expect(() => validateRpcValue(cycle)).toThrow("Cyclic")
      expect(() => validateRpcValue({ callback() {} })).toThrow("Unsupported")
      const shared = { name: "shared" }
      expect(() => validateRpcValue({ a: shared, b: shared, optional: undefined })).not.toThrow()
    })

    test("компилятор отвергает неверные args/return, не ослабляя существующие strict checks", async () => {
      await fs.mkdir(path.resolve(".tmp"), { recursive: true })
      const directory = await fs.mkdtemp(path.resolve(".tmp/ipc-types-"))
      try {
        const fixture = path.join(directory, "fixture.ts"), config = path.join(directory, "tsconfig.json")
        await fs.writeFile(config, JSON.stringify({ extends: "../../tsconfig.node.json", include: ["./fixture.ts"] }))
        const prefix = 'import { rpcRegistry } from "../../electrobun/platform/ipc"\n'
        const compile = () => Bun.spawnSync([process.execPath, "--bun", "run", "tsc", "--noEmit", "-p", config], { stdout: "pipe", stderr: "pipe" })
        await fs.writeFile(fixture, prefix + 'rpcRegistry.handle("system:get-total-memory", () => 42)\nrpcRegistry.handle("settings:get", async (_event, key) => key)\n')
        const valid = compile()
        expect(valid.exitCode, valid.stdout.toString() + valid.stderr.toString()).toBe(0)
        await fs.writeFile(fixture, prefix + 'rpcRegistry.handle("system:get-total-memory", () => "not a number")\nrpcRegistry.handle("settings:get", (_event, key: number) => "wrong input")\n')
        const invalid = compile()
        expect(invalid.exitCode).not.toBe(0)
        expect(invalid.stdout.toString()).toContain("fixture.ts(2,")
        expect(invalid.stdout.toString()).toContain("fixture.ts(3,")
      } finally { await fs.rm(directory, { recursive: true, force: true }) }
    }, 30000)
  })
}

{
  const test = nodeTest
  describe("remediation", () => {
    test("CLI: очередь до готовности, фокус окна и подтверждение после выполнения", () => {
      const queue = new CliQueue()
      const results = []
      queue.enqueue("Первая сборка", error => results.push(error ?? "first"))
      queue.enqueue("Вторая сборка", error => results.push(error ?? "second"))
      queue.enqueue(null, error => results.push(error ?? "focus"))
      let focused = 0
      queue.attach(() => focused++, () => {})
      assert.ok(focused > 0)
      const first = queue.peek()
      assert.deepEqual(results, ["focus"])
      assert.equal(queue.claim(first.id, 1).build, "Первая сборка")
      assert.equal(queue.claim(first.id, 1), null)
      assert.equal(queue.peek(), null)
      queue.finish(first.id, 2)
      assert.deepEqual(results, ["focus"])
      queue.finish(first.id, 1)
      const second = queue.peek()
      assert.equal(queue.claim(second.id, 1).build, "Вторая сборка")
      queue.finish(second.id, 1, "Build not found")
      assert.deepEqual(results, ["focus", "first", "Build not found"])
    })

    test("CLI: закрытие окна и приложения даёт явный отказ, отмена удаляет только свой запрос", () => {
      const queue = new CliQueue()
      const results = []
      queue.enqueue("active", error => results.push(error))
      const cancel = queue.enqueue("cancelled", error => results.push(error))
      queue.enqueue("queued", error => results.push(error))
      queue.claim(queue.peek().id, 1)
      cancel()
      queue.detach(1)
      queue.close("Primary launcher is closing.")
      assert.deepEqual(results, ["The launcher window closed during command execution.", "Primary launcher is closing."])
      assert.throws(() => parseCliLaunch(["--launch"]), /Usage/)
      assert.throws(() => parseCliLaunch(["--launch", " "]), /Usage/)
      assert.equal(parseCliLaunch(["--launch", "Тест с пробелами"]), "Тест с пробелами")
      assert.equal(parseCliLaunch([]), null)
    })

    test("RPC: потерянный ответ истекает, поздний и повторный ответы не трогают соседний запрос", async () => {
      let receive
      const sent = []
      const rpc = createRPC({
        maxRequestTime: 1000,
        transport: { send: packet => { sent.push(packet) }, registerHandler: handler => { receive = handler } },
      })
      const lost = rpc.request.invoke({}, { maxRequestTime: 15 })
      const other = rpc.request.invoke({}, { maxRequestTime: 1000 })
      await assert.rejects(lost, /RPC request timed out/)
      const reply = (index, payload) => receive({ type: "response", id: sent[index].id, success: true, payload })
      reply(0, "late")
      reply(0, "duplicate")
      reply(1, "correct")
      reply(1, "duplicate")
      assert.equal(await other, "correct")
      assert.ok(rpcTimeout("settings:get") < rpcTimeout("storage:scan"))
      assert.ok(rpcTimeout("storage:scan") < rpcTimeout("build:import-modrinth"))
    })

    test("GPU: один и несколько адаптеров, PCI ID и отсутствие выдуманного статуса", async () => {
      const pci = { Name: "Test adapter", PNPDeviceID: "PCI\\VEN_10DE&DEV_1ABC" }
      assert.deepEqual(await queryGpuAdapters("win32", async () => JSON.stringify(pci)),
        [{ name: "Test adapter", vendorId: 0x10DE, deviceId: 0x1ABC }])
      assert.deepEqual(await queryGpuAdapters("win32", async () => JSON.stringify([pci, { Name: "Virtual adapter" }])),
        [{ name: "Test adapter", vendorId: 0x10DE, deviceId: 0x1ABC }, { name: "Virtual adapter" }])
    })

    test("GPU: пустой ответ, отказ и неподдерживаемая система дают null", async () => {
      assert.equal(await queryGpuAdapters("win32", async () => "[]"), null)
      assert.equal(await queryGpuAdapters("win32", async () => { throw new Error("CIM unavailable") }), null)
      let called = false
      assert.equal(await queryGpuAdapters("linux", async () => { called = true; return "[]" }), null)
      assert.equal(called, false)
    })
  })
}

{
  describe("cli-shutdown", () => {
    test("shutdown закрывает CLI listener, незавершённые сокеты и собственный token file", () => {
      const code = `
    import assert from "node:assert/strict"
    import fs from "node:fs/promises"
    import path from "node:path"
    import { tmpdir } from "node:os"
    import { createConnection } from "node:net"
    import { once } from "node:events"
    import { startCliListener, launcherCliEndpoint } from "./electrobun/main/cli.ts"
    import { launcherShutdown } from "./electrobun/platform/shutdown.ts"
    const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-cli-shutdown-"))
    const profile = path.join(root, "profile")
    const server = await startCliListener(profile)
    const endpoint = launcherCliEndpoint(profile)
    const socket = createConnection(endpoint.pipe)
    socket.on("error", () => {})
    try {
      await once(socket, "connect")
      const closed = once(socket, "close")
      const outcome = await launcherShutdown.run()
      await closed
      assert.equal(outcome.status, "completed")
      assert.deepEqual(outcome.failed, [])
      assert.equal(server.listening, false)
      await assert.rejects(fs.access(endpoint.tokenPath), { code: "ENOENT" })
    } finally { socket.destroy(); server.close(); await fs.rm(root, { recursive: true, force: true }) }
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    }, 10000)
  })
}

{
  describe("discord-shutdown", () => {
    test("shutdown закрывает ещё подключающийся Discord client; reopen восстанавливает интеграцию", () => {
      const code = `
    import { mock } from "bun:test"
    import assert from "node:assert/strict"
    import { EventEmitter } from "node:events"
    const app = new EventEmitter(), clients = []
    const ready = Promise.withResolvers()
    class Client extends EventEmitter {
      closed = false
      constructor() { super(); clients.push(this) }
      async login() { await ready.promise; this.emit("ready") }
      async destroy() { this.closed = true; ready.resolve() }
      async setActivity() {}
    }
    mock.module("discord-rpc", () => ({ Client }))
    mock.module("./electrobun/platform/desktop.ts", () => ({ app }))
    mock.module("./electrobun/main/i18n.ts", () => ({ getMainTranslator: async () => key => key }))
    const rpc = await import("./electrobun/main/discord-rpc.ts")
    const connecting = rpc.initDiscordRpc()
    for (let index = 0; index < 20 && !clients.length; index++) await new Promise(setImmediate)
    assert.equal(clients.length, 1)
    await rpc.shutdownDiscordRpc()
    await connecting
    assert.equal(clients[0].closed, true)
    app.emit("reopen")
    for (let index = 0; index < 20 && clients.length < 2; index++) await new Promise(setImmediate)
    assert.equal(clients.length, 2)
    assert.equal(clients[1].closed, false)
    await rpc.shutdownDiscordRpc()
    assert.equal(clients[1].closed, true)
    process.exit(0)
  `
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
    })
  })
}

{
  describe("shutdown-lifecycle", () => {
    test("подготовка SDK update не выходит сама; отказ позволяет повторный cleanup", async () => {
      const calls: string[] = []
      const shutdown = new ShutdownCoordinator()
      shutdown.register("cleanup", reason => { calls.push(reason) })
      shutdown.onExit(() => { calls.push("exit") })
      await shutdown.prepare("update")
      expect(calls).toEqual(["update"])
      shutdown.resetAfterCancelledUpdate()
      await shutdown.run("quit")
      expect(calls).toEqual(["update", "quit", "exit"])
    })

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
      shutdown.register("later", () => { calls.push("too late") }, { priority: -1 })
      shutdown.onExit(() => { calls.push("exit") })
      const result = await shutdown.run()
      expect(result.status).toBe("deadline")
      expect(result.timedOut).toEqual(["stuck"])
      expect(result.skipped).toEqual(["later"])
      expect(calls).toEqual(["db", "exit"])
    })

    test("отмена регистрации и поздняя регистрация не запускают лишние cleanup", async () => {
      const calls: string[] = [], logs: string[] = []
      const shutdown = new ShutdownCoordinator({ log: message => { logs.push(message) } })
      expect(() => shutdown.register("", () => {})).toThrow("needs a name")
      const remove = shutdown.register("removed", () => { calls.push("removed") })
      remove()
      const done = shutdown.run()
      shutdown.register("late", () => { calls.push("late") })()
      remove()
      await done
      expect(shutdown.started).toBe(true)
      expect(shutdown.finished).toBe(true)
      expect(calls).toEqual([])
      expect(logs.some(message => message.includes("after shutdown started"))).toBe(true)
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
  })
}
