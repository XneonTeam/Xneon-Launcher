import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"

function fixture() {
  const module = { exports: {} as any }
  const listeners = new Map<string, Function>()
  let changes: Function = () => {}
  const links: any[] = []
  const document = { querySelectorAll: () => links, addEventListener: (type: string, fn: Function) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) }
  const window = { document, location: { href: "views://launcher/index.html" }, open() {} }
  vm.runInNewContext(transformSync(fs.readFileSync(new URL("../../lib/external-links.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, URL, console,
    MutationObserver: class { constructor(fn: Function) { changes = fn } observe() {} disconnect() {} },
  })
  function anchor(href: string, news = false) {
    const attributes = new Map<string, string>([["href", href]])
    const node = {
      nodeType: 1,
      matches: (selector: string) => selector === "a[href]" && attributes.has("href"),
      closest: (selector: string) => selector.includes("news-card") ? news ? node : null : node,
      querySelectorAll: () => [], getAttribute: (name: string) => attributes.get(name) ?? null,
      hasAttribute: (name: string) => attributes.has(name), setAttribute: (name: string, value: string) => attributes.set(name, value), removeAttribute: (name: string) => attributes.delete(name),
      click() { listeners.get("click")!({ target: node, preventDefault() {}, stopImmediatePropagation() {} }) },
    }
    links.push(node)
    return node
  }
  const opened: string[] = []
  const install = () => module.exports.installExternalLinks(window, async (url: string) => { opened.push(url) })
  return { anchor, install, opened, listeners, mutate: (records: any[]) => changes(records) }
}

test("внешняя ссылка не показывает браузерный URL, но остаётся доступной с мыши и Enter", () => {
  const app = fixture()
  const link = app.anchor("https://github.com/MAINER4IK")
  app.install()
  expect(link.getAttribute("href")).toBeNull()
  expect(link.getAttribute("role")).toBe("link")
  expect(link.getAttribute("tabindex")).toBe("0")
  link.click()
  app.listeners.get("keydown")!({ target: link, key: "Enter", preventDefault() {} })
  expect(app.opened).toEqual(["https://github.com/MAINER4IK", "https://github.com/MAINER4IK"])
})

test("новостные и внутренние ссылки сохраняют настоящий href", () => {
  const app = fixture()
  const news = app.anchor("https://www.minecraft.net/article/test", true)
  const internal = app.anchor("#section")
  app.install()
  expect(news.getAttribute("href")).toBe("https://www.minecraft.net/article/test")
  expect(internal.getAttribute("href")).toBe("#section")
})

test("новые ссылки и изменённый React href обрабатываются без сканирования всего документа", () => {
  const app = fixture()
  app.install()
  const link = app.anchor("https://example.org/one")
  app.mutate([{ type: "childList", addedNodes: [link] }])
  expect(link.getAttribute("href")).toBeNull()
  link.setAttribute("href", "https://example.org/two")
  app.mutate([{ type: "attributes", target: link }])
  link.click()
  expect(app.opened).toEqual(["https://example.org/two"])
})

test("cleanup возвращает href и исходную семантику ссылки", () => {
  const app = fixture()
  const link = app.anchor("https://example.org/")
  const stop = app.install()
  stop()
  expect(link.getAttribute("href")).toBe("https://example.org/")
  expect(link.getAttribute("role")).toBeNull()
  expect(link.getAttribute("tabindex")).toBeNull()
})
