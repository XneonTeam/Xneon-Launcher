import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import { transformSync } from "esbuild"

const source = fs.readFileSync(new URL("../../electrobun/platform/desktop.ts", import.meta.url), "utf8")
const code = transformSync(source.slice(source.indexOf("export class DesktopWindow"), source.indexOf("export const viewSession")), { loader: "ts", format: "cjs" }).code

function fixture(platform, options) {
  const calls = []
  let frame
  let renderer
  class NativeWindow extends EventEmitter {
    ptr = 1
    webview = { id: 1, on() {} }
    constructor(options) {
      super()
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
    build: { isPackaged: false }, appUserModelId: undefined,
    enableWindowsWindowTransitions() {},
    setWindowsWindowIcons: () => () => {},
    setWindowsWindowClientWidth: (_handle, width) => { frame.width = width + 16; calls.push("client-size") },
  })
  new module.exports.DesktopWindow({ width: 1280, height: 800, launcher: true, ...options })
  return { frame, clientWidth: frame.width - 16, calls, renderer }
}

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
