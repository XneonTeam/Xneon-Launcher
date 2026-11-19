import assert from "node:assert/strict"
import { test } from "bun:test"
import { resumeDeferredUpdate } from "../../electrobun/main/update-startup"

function fixture(pending, fail = false) {
  const order = []
  return { order, options: {
    local: { channel: "stable", version: "1.0.8", hash: "old123" }, sdkRoot: "fixture-sdk",
    store: { peek: async () => { order.push("verify"); return pending }, clearPending: async () => { order.push("clear") } },
    launchInstaller: async file => { order.push(file); if (fail) throw new Error("spawn failed") },
    applySdk: async () => { order.push("sdk"); if (fail) throw new Error("apply failed") },
    quit: async () => { order.push("quit") }, onError: () => { order.push("error") },
  } }
}

test("следующий запуск не применяет скачанное обновление без явного выбора Позже", async () => {
  const app = fixture({ kind: "installer", path: "signed-installer.exe", deferred: false })
  assert.equal(await resumeDeferredUpdate(app.options), false)
  assert.deepEqual(app.order, ["verify"])
})

test("следующий запуск применяет отложенное обновление до UI и без повторного скачивания", async () => {
  for (const kind of ["installer", "sdk"]) {
    const app = fixture({ kind, path: "signed-installer.exe", deferred: true })
    assert.equal(await resumeDeferredUpdate(app.options), true)
    assert.deepEqual(app.order, ["verify", "clear", kind === "installer" ? "signed-installer.exe" : "sdk", "quit"])
  }
})

test("ошибка применения не создаёт цикл перезапусков и позволяет открыть лаунчер", async () => {
  const app = fixture({ kind: "installer", path: "signed-installer.exe", deferred: true }, true)
  assert.equal(await resumeDeferredUpdate(app.options), false)
  assert.deepEqual(app.order, ["verify", "clear", "signed-installer.exe", "error"])
})
