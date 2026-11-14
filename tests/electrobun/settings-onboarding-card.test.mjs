import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import { renderToStaticMarkup } from "react-dom/server"
import { IconRotate } from "@tabler/icons-react"

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL("../../components/launcher/settings/settings-language-about.tsx", import.meta.url), "utf8")
const strings = JSON.parse(fs.readFileSync(new URL("../../src/i18n/locales/ru/translation.json", import.meta.url), "utf8"))

function fixture() {
  const section = source.match(/<section data-component="settings-onboarding-reset"[\s\S]*?<\/section>/)?.[0]
  assert.ok(section, "Блок сброса должен содержать иконки и кнопку")
  const code = transformSync(`module.exports = (${section})`, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  const module = { exports: {} }
  const events = []
  vm.runInNewContext(code, { module, require, IconRotate, Event,
    t: key => strings[key], window: { dispatchEvent: event => events.push(event.type) },
  })
  return { tree: module.exports, html: renderToStaticMarkup(module.exports), events }
}

test("Настройки: без лишнего заголовка «Первоначальная настройка», иконки сброса сохранены", () => {
  const { html } = fixture()
  assert.ok(!html.includes("tabler-icon-adjustments"))
  assert.equal((html.match(/tabler-icon-rotate /g) ?? []).length, 2)
  assert.ok(!html.includes(strings["settings.about.onboarding.title"]))
  assert.ok(html.includes(strings["settings.about.onboarding.reset"]))
  assert.ok(html.includes(strings["settings.about.onboarding.description"]))
  assert.match(html, /<button[^>]*class="[^"]*bg-primary[^\"]*text-primary-foreground/)
})

test("Настройки: восстановление оформления не меняет событие сброса", () => {
  const { tree, events } = fixture()
  function find(node) {
    if (!node || typeof node !== "object") return null
    if (Array.isArray(node)) return node.map(find).find(Boolean)
    return node.type === "button" ? node : find(node.props?.children)
  }
  const button = find(tree)
  assert.ok(button)
  button.props.onClick()
  assert.deepEqual(events, ["launcher:onboarding-reset"])
})
