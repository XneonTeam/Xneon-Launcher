import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createInstance } from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { SkinCard } from "../../components/launcher/skins/skin-card.tsx"

const read = file => fs.readFileSync(new URL(`../../components/launcher/${file}`, import.meta.url), "utf8")
for (const file of [
  "instance/instance-list.tsx", "servers-page.tsx", "category-assign-modal.tsx",
  "server/files-tab.tsx", "server/players-tab.tsx", "instance/instance-servers-tab.tsx",
  "cloud/cloud-file-browser.tsx", "skins/skin-card.tsx", "laby/catalog-card.tsx", "agent/agent-page.tsx",
]) {
  test(`Действия видимы без наведения: ${file}`, () => {
    assert.doesNotMatch(read(file), /\bopacity-0\b|text-muted-foreground\/0\b/)
  })
}

test("Скин: изменение и удаление — видимые нативные кнопки с доступными названиями", async () => {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({ lng: "ru", resources: { ru: { translation: { "skins.edit": "Изменить", "common.delete": "Удалить" } } } })
  const html = renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(SkinCard, {
    skin: { id: "fixture", name: "Test", blobUrl: "", variant: "classic", capeId: null },
    capes: [], isSelected: false, isEquipped: false, onSelect() {}, onEdit() {}, onDelete() {},
  })))
  assert.match(html, /<button[^>]+aria-label="Удалить"/)
  assert.match(html, /<button[^>]+aria-label="Изменить"/)
  assert.ok(!html.includes("opacity-0"))
})

for (const file of ["skins/skin-card.tsx", "laby/catalog-card.tsx"]) {
  test(`Клавиатура: Enter на дочерней кнопке не выбирает карточку: ${file}`, () => {
    const handler = read(file).match(/onKeyDown=\{\(event\) => \{([\s\S]*?)\n      \}\}/)?.[1]
    assert.ok(handler)
    let selected = 0
    const run = vm.runInNewContext(`(event => {${handler}})`, { onSelect: () => selected++ })
    const card = {}
    run({ target: {}, currentTarget: card, key: "Enter", preventDefault() { throw new Error("Child event was intercepted") } })
    assert.equal(selected, 0)
    run({ target: card, currentTarget: card, key: "Enter", preventDefault() {} })
    assert.equal(selected, 1)
  })
}
