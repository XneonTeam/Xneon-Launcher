import assert from "node:assert/strict"
import test from "node:test"
import { createRPC } from "../../.hutch/devkit/api/shared/rpc.ts"
import { CliQueue, parseCliLaunch } from "../../electrobun/main/cli.ts"
import { queryGpuAdapters } from "../../electrobun/platform/gpu.ts"
import { rpcTimeout } from "../../electrobun/platform/rpc-timeouts.ts"

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
