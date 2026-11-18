import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"

function renderer() {
  const module = { exports: {} as any }
  let emit: (event: { channel: string; payload: unknown }) => void = () => {}
  vm.runInNewContext(transformSync(readFileSync(new URL("../../electrobun/platform/renderer.ts", import.meta.url), "utf8"),
    { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, window: {},
    require(name: string) {
      if (name === "electrobun/view") return { Electroview: { defineRPC(config: any) {
        emit = config.handlers.messages.launcherEvent
        return {}
      } } }
      if (name === "./rpc-timeouts") return { rpcTimeout: () => 30_000 }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  return { rpc: module.exports.desktopRpc, emit: (payload: unknown) => emit({ channel: "settings:updated", payload }) }
}

test("IPC renderer: 30 mount/cleanup циклов не накапливают подписчиков", () => {
  const { rpc, emit } = renderer()
  let calls = 0
  for (let cycle = 1; cycle <= 30; cycle++) {
    const unsubscribe = rpc.subscribe("settings:updated", () => { calls++ })
    emit({ key: "theme", value: "default" })
    expect(calls).toBe(cycle)
    unsubscribe()
    unsubscribe()
    emit({ key: "theme", value: "default" })
    expect(calls).toBe(cycle)
  }
})

test("IPC renderer: cleanup одного владельца не снимает другого", () => {
  const { rpc, emit } = renderer()
  let a = 0, b = 0
  const offA = rpc.subscribe("settings:updated", () => { a++ })
  const offB = rpc.subscribe("settings:updated", () => { b++ })
  offA(); emit(null)
  expect(a).toBe(0)
  expect(b).toBe(1)
  offB(); emit(null)
  expect(b).toBe(1)
})
