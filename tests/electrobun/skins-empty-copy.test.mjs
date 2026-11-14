import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

for (const locale of ["ru", "en", "uk", "de", "es", "pl"]) {
  test(`Скины: ограничения аккаунтов объяснены в ${locale}`, () => {
    const strings = JSON.parse(fs.readFileSync(new URL(`../../src/i18n/locales/${locale}/translation.json`, import.meta.url), "utf8"))
    assert.ok(strings["skins.noAccountsDesc"].includes("Ely.by"))
    assert.match(strings["skins.noAccountsHint"] ?? "", /Microsoft/)
    assert.match(strings["skins.noAccountsHint"] ?? "", /XN Skins/)
    assert.match(strings["skins.noAccountsHint"] ?? "", /authlib-injector/)
  })
}

test("Скины: подсказка выбора поддерживаемого аккаунта показана в пустом состоянии", () => {
  const source = fs.readFileSync(new URL("../../components/launcher/skins/empty-skins-state.tsx", import.meta.url), "utf8")
  assert.ok(source.includes('t("skins.noAccountsHint")'))
  assert.ok(!source.includes("Нет активного аккаунта"))
})

test("Ely.by: подсказка объясняет выбор в библиотеке, загрузку своего скина и применение", () => {
  const strings = JSON.parse(fs.readFileSync(new URL("../../src/i18n/locales/ru/translation.json", import.meta.url), "utf8"))
  const description = strings["skins.noAccountsDesc"]
  assert.match(description, /библиотеку скинов/)
  assert.match(description, /найдите готовый скин или загрузите свой/)
  assert.match(description, /примените его к аккаунту/)
  assert.ok(!description.includes("личном кабинете"))
})
