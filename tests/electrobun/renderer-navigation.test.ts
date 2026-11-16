// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { browserLink, installExternalLinks } from "../../lib/external-links.ts"
import { transformSync } from "esbuild"
import { createRequire } from "node:module"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createInstance } from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { EmptySkinsState } from "../../components/launcher/skins/empty-skins-state.tsx"

{
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
  describe("browser-context-menu", () => {
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
  })
}

{
  describe("external-browser-links", () => {
    test('Ссылки: web/mailto уходят в браузер, views/якоря/опасные схемы — нет',()=>{
     const base='views://launcher/index.html'
     for(const url of ['https://discord.gg/test','http://example.org','mailto:support@xneon.org'])assert.ok(browserLink(url,base))
     for(const url of ['#anchor','./assets/icon.svg','views://launcher/index.html','javascript:alert(1)','file:///C:/file'])assert.equal(browserLink(url,base),null)
    })
    test('Ссылки: обычный, target=_blank и средний клик отменяют WebView-навигацию',()=>{
     const document=new EventTarget(),urls=[],native=[]
     const target={document,location:{href:'views://launcher/index.html'},open:(...args)=>native.push(args)}
     const stop=installExternalLinks(target,async url=>{urls.push(url)})
     for(const type of ['click','auxclick']){
      const event=new Event(type,{cancelable:true});Object.defineProperties(event,{button:{value:type==='auxclick'?1:0},target:{value:{closest:()=>({getAttribute:()=> 'https://discord.gg/test'})}}})
      assert.equal(document.dispatchEvent(event),false)
     }
     assert.equal(target.open('https://example.org'),null)
     assert.deepEqual(urls,['https://discord.gg/test','https://discord.gg/test','https://example.org/'])
     stop();target.open('internal');assert.equal(native.length,1)
    })
    test('Ссылки: обработанные приложением клики не открываются повторно',()=>{
     const document=new EventTarget(),urls=[]
     const stop=installExternalLinks({document,location:{href:'views://launcher/index.html'},open(){}},async url=>urls.push(url))
     const event=new Event('click',{cancelable:true});event.preventDefault();document.dispatchEvent(event)
     assert.equal(urls.length,0);stop()
    })
  })
}

{
  const require = createRequire(import.meta.url)

  const source = fs.readFileSync(new URL("../../components/launcher/news-reader-modal.tsx", import.meta.url), "utf8")
  describe("news-reader-webview", () => {
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
  })
}

{
  const require = createRequire(import.meta.url)
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")

  function avatarFixture() {
    const calls = []
    const module = { exports: {} }
    const base = "http://127.0.0.1:12345/secret/"
    const source = read("components/ui/cached-avatar.tsx") + "\nexport { loadImage };"
    const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
    vm.runInNewContext(code, {
      module, exports: module.exports, Blob, Buffer, URL, Date,
      localStorage: { getItem: () => null, setItem() {} },
      FileReader: class {
        readAsDataURL() { this.result = "data:image/png;base64,fixture"; this.onload() }
      },
      require(name) {
        if (name === "@/lib/launcher-assets") return { launcherAssetUrl: url => url.replace(/^(avatar|xnl-theme):\/\//, base + "$1/") }
        return require(name)
      },
      fetch: async url => { calls.push(url); return new Response(new Uint8Array([1, 2, 3])) },
    })
    return { load: module.exports.loadImage, calls, base }
  }
  describe("renderer-console", () => {
    test("Аватары: fetch получает локальный HTTP URL вместо avatar://", async () => {
      const f = avatarFixture()
      const original = "avatar://head/MAINER4IK?type=elyby&uuid=test&v=123"
      await f.load(original)
      await f.load(original)
      assert.deepEqual(f.calls, [f.base + "avatar/head/MAINER4IK?type=elyby&uuid=test&v=123"])
    })

    test("Аватары: обычный HTTPS URL не меняется", async () => {
      const f = avatarFixture()
      await f.load("https://textures.example/avatar.png")
      assert.deepEqual(f.calls, ["https://textures.example/avatar.png"])
    })

    test("Пустые скины: остаётся футболка без отдельного значка предупреждения", async () => {
      const i18n = createInstance()
      await i18n.use(initReactI18next).init({ lng: "ru", resources: { ru: { translation: { "skins.noAccounts": "Нет активного аккаунта" } } } })
      const html = renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(EmptySkinsState)))
      assert.ok(html.includes("Нет активного аккаунта"))
      assert.ok(html.includes("tabler-icon-shirt"))
      assert.ok(!html.includes("tabler-icon-alert-circle"))
    })

    for (const file of ["components/launcher/source-mark.tsx", "components/launcher/instance/instance-header.tsx", "components/launcher/instance/instance-list.tsx"]) {
      test(`FTB: после дуги начинается отдельная кривая: ${file}`, () => {
        const source = read(file)
        assert.ok(source.includes("40.621c-82.81"))
        assert.ok(!source.includes("40.621-82.81"))
      })
    }

    test("Переводы: инициализация входит в стартовый барьер до первого React-рендера", () => {
      const source = read("src/main.tsx")
      const barrier = source.slice(source.indexOf("Promise.all(["), source.indexOf("rootEl.render"))
      assert.match(barrier, /initI18n/)
    })

    function backgroundFixture(api) {
      const source = read("components/launcher/theme-background-layer.tsx")
      const start = source.indexOf("async function resolveSource(")
      const end = source.indexOf("\nexport function ThemeBackgroundLayer", start)
      assert.ok(start >= 0 && end > start)
      const code = transformSync(source.slice(start, end), { loader: "ts" }).code
      return vm.runInNewContext(`(${code.trim()})`, { window: { electrobunAPI: api } })
    }

    test("Фон: сторонняя картинка читается через main без обращения WebView2 к трекеру", async () => {
      const calls = []
      const resolve = backgroundFixture({ readThemeMedia: async source => { calls.push(source); return "data:image/png;base64,fixture" } })
      const url = "https://i.pinimg.com/1200x/fixture.jpg"
      assert.equal(await resolve(url, "image"), "data:image/png;base64,fixture")
      assert.deepEqual(calls, [url])
    })

    test("Фон: data URL и управляемые ресурсы не скачиваются повторно", async () => {
      const resolve = backgroundFixture({ readThemeMedia: () => { throw new Error("Unexpected IPC") } })
      assert.equal(await resolve("data:image/png;base64,fixture", "image"), "data:image/png;base64,fixture")
      assert.equal(await resolve("xnl-theme://asset/fixture.png", "image"), "xnl-theme://asset/fixture.png")
    })

    test("Фон: видео сохраняет потоковую загрузку, веб-превью работает без main", async () => {
      const resolve = backgroundFixture({ readThemeMedia: () => { throw new Error("Unexpected buffering") } })
      assert.equal(await resolve("https://cdn.example/background.webm", "video"), "https://cdn.example/background.webm")
      assert.equal(await backgroundFixture(undefined)("https://cdn.example/background.jpg", "image"), "https://cdn.example/background.jpg")
    })
  })
}
