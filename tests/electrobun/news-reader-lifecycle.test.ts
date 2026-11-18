import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import { reactNodes } from "../helpers/react-module.mjs"

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL("../../components/launcher/news-reader-modal.tsx", import.meta.url), "utf8")
const articleUrl = "https://www.minecraft.net/article/test"

function readerFixture(entryPatch: { readMoreLink?: string; newsType?: string[] } = {}) {
  const timers = new Map<number, Function>()
  const listeners = new Map<string, Function>()
  const attributes = new Map<string, string>()
  const states: any[] = []
  let hook = 0, timerId = 0, removed = 0, shown = 0
  const navigations: string[] = []
  const scripts: string[] = []
  const init = Promise.withResolvers<void>()
  const el = {
    webviewId: null as number | null, isConnected: true,
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    getAttribute: (key: string) => attributes.get(key) ?? null,
    on: (event: string, fn: Function) => listeners.set(event, fn),
    off: (event: string) => listeners.delete(event),
    executeJavascript: (script: string) => scripts.push(script),
    toggleTransparent(value: boolean) { if (!value) shown++ },
    togglePassthrough() {},
    loadURL: (url: string) => navigations.push(url),
    async initWebview() { await init.promise; el.webviewId = 42 },
    disconnectedCallback() { if (el.webviewId !== null) removed++ },
  }
  const slot = (initial: any) => {
    const index = hook++
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
    return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value }]
  }
  const module = { exports: {} as { NewsReaderModal: (props: any) => any } }
  const timer = (fn: Function) => { timers.set(++timerId, fn); return timerId }
  const window = { setTimeout: timer, setInterval: timer, clearTimeout: (id: number) => timers.delete(id), clearInterval: (id: number) => timers.delete(id), addEventListener() {}, removeEventListener() {} }
  vm.runInNewContext(transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code, {
    module, exports: module.exports, window, console,
    document: { documentElement: { classList: { contains: () => true } } },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: timer, cancelAnimationFrame: (id: number) => timers.delete(id),
    require(name: string) {
      if (name === "react") return { useState: slot, useRef: (current: unknown) => slot(() => ({ current }))[0], useCallback: (fn: Function) => fn }
      if (name === "react-i18next") return { useTranslation: () => ({ t: (key: string) => key }) }
      if (name === "@/components/ui/dialog") return Object.fromEntries(["Dialog", "DialogClose", "DialogContent", "DialogDescription", "DialogTitle"].map(name => [name, name]))
      if (name === "@/lib/home-page-shared") return { formatDate: () => "2026-11-18" }
      if (name === "./settings/theme-model") return { getAppliedReaderCss: () => "", splitThemeCssPrelude: () => ({ prelude: "", body: "" }) }
      if (name.startsWith("@/lib/")) return require("../../" + name.slice(2))
      return require(name)
    },
  })
  const render = () => { hook = 0; return module.exports.NewsReaderModal({ entry: { title: "Test", date: "2026-11-18", readMoreLink: articleUrl, ...entryPatch }, onClose() {} }) }
  const webview = () => reactNodes(render()).find((node: any) => node.type === "electrobun-webview")
  return { el, init, timers, listeners, attributes, navigations, scripts, webview, render, get removed() { return removed }, get shown() { return shown } }
}

test("читалка показывает DOM статьи до окончания загрузки всех медиа", () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  const ready = fixture.listeners.get("host-message")
  expect(ready).toBeDefined()
  ready!({ detail: JSON.stringify({ type: "xneon-news-reader-ready", url: articleUrl }) })
  expect(fixture.shown).toBe(1)
  expect(fixture.timers.size).toBe(0)
})

test("пустой стартовый документ не выдаётся за готовую статью", () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  fixture.listeners.get("dom-ready")!({ detail: "about:blank" })
  expect(fixture.shown).toBe(0)
})

test("закрытие во время native init освобождает поздно созданный WebView", async () => {
  const fixture = readerFixture()
  const ref = fixture.webview().props.ref
  ref(fixture.el)
  const pending = fixture.el.initWebview()
  ref(null)
  fixture.el.isConnected = false
  fixture.el.disconnectedCallback()
  fixture.init.resolve()
  await pending
  expect(fixture.removed).toBe(1)
  expect(fixture.navigations).toEqual([])
  expect(fixture.listeners.size).toBe(0)
  expect(fixture.timers.size).toBe(0)
})

test("20 быстрых открытий/закрытий не оставляют поздних гостей и обработчиков", async () => {
  let created = 0, removed = 0
  for (let cycle = 0; cycle < 20; cycle++) {
    const fixture = readerFixture()
    const ref = fixture.webview().props.ref
    ref(fixture.el)
    const pending = fixture.el.initWebview()
    ref(null)
    fixture.el.isConnected = false
    fixture.el.disconnectedCallback()
    fixture.init.resolve()
    await pending
    if (fixture.el.webviewId !== null) created++
    removed += fixture.removed
    expect(fixture.listeners.size).toBe(0)
    expect(fixture.timers.size).toBe(0)
  }
  expect(created).toBe(20)
  expect(removed).toBe(created)
})

test("статья навигируется один раз после native init, а не через initial src и очередь SDK", async () => {
  const fixture = readerFixture()
  const tag = fixture.webview()
  expect(tag.props.src).toBe("about:blank")
  tag.props.ref(fixture.el)
  const pending = fixture.el.initWebview()
  fixture.init.resolve()
  await pending
  expect(fixture.navigations).toEqual([articleUrl])
})

test("таймаут удаляет WebView, а не оставляет сайт работать под ошибкой", () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  const callbacks = [...fixture.timers.values()]
  callbacks[callbacks.length - 1]()
  expect(fixture.webview()).toBeUndefined()
})

test("скрипт гостя не размножает наблюдателей при повторной установке", () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  const script = fixture.attributes.get("preload") ?? source.match(/const INLINE_LINKS_JS = `([\s\S]*?)`/)![1]
  let observers = 0, fullScans = 0, onMutation: Function = () => {}
  const document = {
    readyState: "complete", documentElement: { appendChild() {} },
    getElementById: () => null, createElement: () => ({}),
    querySelectorAll() { fullScans++; return [] },
    addEventListener() {},
  }
  const window: any = { addEventListener() {}, __electrobunSendToHost() {} }
  window.top = window
  const context = vm.createContext({ window, document, location: { href: articleUrl },
    MutationObserver: class { constructor(callback: Function) { observers++; onMutation = callback } observe() {} disconnect() {} },
  })
  vm.runInContext(script, context)
  vm.runInContext(script, context)
  expect(observers).toBe(1)
  const scansBeforeMutation = fullScans
  onMutation([{ type: "childList", addedNodes: [] }])
  expect(fullScans).toBe(scansBeforeMutation)
})

test("повторный init одного элемента не создаёт второго гостя и второй navigation", async () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  const first = fixture.el.initWebview()
  const second = fixture.el.initWebview()
  fixture.init.resolve()
  await Promise.all([first, second])
  expect(fixture.navigations).toEqual([articleUrl])
})

test("закрытый до стартового RAF элемент не начинает native init", async () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  fixture.el.isConnected = false
  fixture.init.resolve()
  await fixture.el.initWebview()
  expect(fixture.el.webviewId).toBeNull()
  expect(fixture.navigations).toEqual([])
})

test("повторить после таймаута возвращает новый WebView и состояние загрузки", () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  const callbacks = [...fixture.timers.values()]
  callbacks[callbacks.length - 1]()
  const retry = reactNodes(fixture.render()).find((node: any) => node.props["data-ui"] === "news-reader-modal-button-3")
  retry.props.onClick()
  const tag = fixture.webview()
  expect(tag).toBeDefined()
  expect(tag.key).toBe(`${articleUrl}:1`)
})

test("preload откладывает медиа, сохраняет ссылки внутри читалки и не запускается в iframe", () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  const script = fixture.attributes.get("preload")!
  const attributes = new Map<string, string>([["target", "_blank"], ["autoplay", ""]])
  let paused = 0, ready = 0, disconnected = 0
  const link = { matches: (selector: string) => selector === "a[target]", removeAttribute: (key: string) => attributes.delete(key) }
  const image = { matches: (selector: string) => ["img", "img, iframe"].includes(selector), hasAttribute: (key: string) => attributes.has(key), setAttribute: (key: string, value: string) => attributes.set(key, value) }
  const video = { matches: (selector: string) => selector === "video, audio", removeAttribute: (key: string) => attributes.delete(key), pause: () => { paused++ }, autoplay: true, preload: "auto", controls: false }
  const documentEvents = new Map<string, Function>(), windowEvents = new Map<string, Function>()
  const document = {
    readyState: "loading", documentElement: { appendChild() {} }, getElementById: () => null, createElement: () => ({}),
    querySelectorAll: () => [link, image, video], addEventListener: (event: string, fn: Function) => documentEvents.set(event, fn),
  }
  const window: any = { addEventListener: (event: string, fn: Function) => windowEvents.set(event, fn), __electrobunSendToHost: () => { ready++ } }
  window.top = window
  const context = vm.createContext({ window, document, location: { href: articleUrl }, MutationObserver: class { observe() {} disconnect() { disconnected++ } } })
  vm.runInContext(script, context)
  expect(attributes.has("target")).toBe(false)
  expect(attributes.get("loading")).toBe("lazy")
  expect(attributes.get("decoding")).toBe("async")
  expect(video.autoplay).toBe(false)
  expect(video.preload).toBe("none")
  expect(video.controls).toBe(true)
  expect(paused).toBe(1)
  expect(ready).toBe(0)
  documentEvents.get("DOMContentLoaded")!()
  expect(ready).toBe(1)
  windowEvents.get("pagehide")!()
  expect(disconnected).toBe(1)
  window.top = {}
  vm.runInContext(script, context)
  expect(ready).toBe(1)
})

test("новости лаунчера сохраняют собственные цвета и оформление сайта", () => {
  for (const entry of [
    { readMoreLink: "https://launcher.xneon.org/news/test" },
    { readMoreLink: "https://custom-news.example/post", newsType: ["Launcher"] },
    { readMoreLink: "http://localhost:3000/news/test" },
  ]) {
    const fixture = readerFixture(entry)
    fixture.webview().props.ref(fixture.el)
    expect(fixture.attributes.get("preload")).not.toContain("background-color:")
    expect(fixture.attributes.get("preload")).not.toContain("xneon-news-reader-style")
    fixture.listeners.get("dom-ready")!({ detail: entry.readMoreLink })
    expect(fixture.shown).toBe(1)
    expect(fixture.scripts).toEqual([])
  }
})

test("статьи Minecraft по-прежнему получают тему читалки", () => {
  const fixture = readerFixture()
  fixture.webview().props.ref(fixture.el)
  expect(fixture.attributes.get("preload")).toContain("background-color:")
  fixture.listeners.get("dom-ready")!({ detail: articleUrl })
  expect(fixture.scripts[0]).toContain("xneon-news-reader-style")
})
