import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const source = fs.readFileSync(new URL("../../components/launcher/news-reader-modal.tsx", import.meta.url), "utf8")

test("Читалка: размеры гостя перекрывают стандартные 800×300 SDK независимо от CSS layers", () => {
  const tag = source.match(/<electrobun-webview\s+data-ui=[\s\S]*?\/>/)?.[0]
  assert.ok(tag)
  const code = transformSync(`module.exports = (${tag});`, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  const module = { exports: {} }
  vm.runInNewContext(code, { module, require, url: "https://example.org/article", reloadKey: 0, attachWebview() {} })
  assert.equal(module.exports.props.style?.width, "100%")
  assert.equal(module.exports.props.style?.height, "100%")
})

test("Читалка: React не получает readonly sandbox и начальные флаги гостя как props", () => {
  const tag = source.match(/<electrobun-webview\s+data-ui=[\s\S]*?\/>/)?.[0]
  assert.ok(tag)
  for (const attribute of ["sandbox", "transparent", "passthrough"]) {
    assert.doesNotMatch(tag, new RegExp(`\\b${attribute}(?:\\s|=|$)`))
  }
})

function prepare() {
  const helper = source.match(/export function prepareNewsReaderWebview\([\s\S]*?\n\}/)?.[0]
  assert.ok(helper, "Начальные атрибуты должны устанавливаться до native-инициализации")
  const code = transformSync(helper.replace("export ", ""), { loader: "ts" }).code
  return vm.runInNewContext(`(${code})`)
}

test("Читалка: sandbox устанавливается атрибутом даже при getter-only свойстве", () => {
  const attrs = new Map()
  const element = {
    get sandbox() { return attrs.has("sandbox") },
    setAttribute: (name, value) => attrs.set(name, value),
  }
  assert.throws(() => { element.sandbox = true }, TypeError)
  prepare()(element)
  assert.equal(element.sandbox, true)
  assert.equal(attrs.get("sandbox"), "")
})

test("Читалка: transparent и passthrough доступны initWebview через hasAttribute", () => {
  const attrs = new Map()
  const element = { transparent: false, passthroughEnabled: false, setAttribute: (name, value) => attrs.set(name, value) }
  prepare()(element)
  prepare()(element)
  assert.deepEqual([...attrs], [["renderer", "native"], ["sandbox", ""], ["transparent", ""], ["passthrough", ""]])
  assert.equal(element.transparent, false)
  assert.equal(element.passthroughEnabled, false)
})

test("Читалка: атрибуты настраиваются callback-ref до подписок и ожидания гостя", () => {
  const callback = source.slice(source.indexOf("const attachWebview"), source.indexOf("}, [])", source.indexOf("const attachWebview")))
  const prepared = callback.indexOf("prepareNewsReaderWebview(el)")
  assert.ok(prepared >= 0)
  assert.ok(prepared < callback.indexOf('el.on("dom-ready"'))
})

test("Читалка выбирает CEF на Linux до native-инициализации гостя", () => {
  const helper = source.match(/export function prepareNewsReaderWebview\([\s\S]*?\n\}/)?.[0]
  const code = transformSync(helper.replace("export ", ""), { loader: "ts" }).code
  for (const platform of ["linux", "darwin", "win32"]) {
    const attrs = new Map()
    const fn = vm.runInNewContext(`(${code})`, { window: { __electrobunPlatform: platform } })
    fn({ setAttribute: (name, value) => attrs.set(name, value) })
    assert.equal(attrs.get("renderer"), platform === "linux" ? "cef" : "native")
    assert.equal(attrs.get("sandbox"), "")
  }
})
