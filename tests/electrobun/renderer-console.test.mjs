import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createInstance } from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { EmptySkinsState } from "../../components/launcher/skins/empty-skins-state.tsx"

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
