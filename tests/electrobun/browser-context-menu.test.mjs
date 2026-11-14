import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"

const source = fs.readFileSync(new URL("../../src/main.tsx", import.meta.url), "utf8")

function setup() {
  const statement = source.match(/window\.addEventListener\(['"]contextmenu['"],[^\n]+\)/)?.[0]
  assert.ok(statement, "Стандартное меню браузера должно отключаться при старте renderer")
  const target = new EventTarget()
  const options = []
  vm.runInNewContext(statement, { window: {
    addEventListener(type, listener, config) { options.push(config); target.addEventListener(type, listener, config) },
  } })
  return { target, options }
}

test("ПКМ: штатное меню WebView2 блокируется и на пустом месте", () => {
  const { target, options } = setup()
  const event = new Event("contextmenu", { cancelable: true })
  assert.equal(target.dispatchEvent(event), false)
  assert.equal(event.defaultPrevented, true)
  assert.equal(options[0].capture, true)
})

test("ПКМ: события доходят до собственных меню приложения", () => {
  const { target } = setup()
  let customOpened = false
  target.addEventListener("contextmenu", () => { customOpened = true })
  const event = new Event("contextmenu", { cancelable: true })
  let stopped = false
  event.stopPropagation = event.stopImmediatePropagation = () => { stopped = true }
  target.dispatchEvent(event)
  assert.equal(customOpened, true)
  assert.equal(stopped, false)
})

test("ПКМ: обработчик установлен ещё до монтирования React и загрузки разделов", () => {
  setup()
  assert.ok(source.indexOf("'contextmenu'") < source.indexOf("ReactDOM.createRoot"))
})
