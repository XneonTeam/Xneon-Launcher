// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import nodeTest, { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createInstance } from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { SkinCard } from "../../components/launcher/skins/skin-card.tsx"
import { EmptySkinsState } from "../../components/launcher/skins/empty-skins-state.tsx"
import { loadReactModule, reactNodes } from "../helpers/react-module.mjs"
import { describe, expect, test as bunTest } from "bun:test"
import { localizeImportProgress } from "../../lib/import-progress-text.ts"
import { translatorForLocale } from "../../electrobun/main/i18n.ts"
import { discordImageUrl, minecraftPresence, presenceSmallImage } from "../../electrobun/main/discord-presence.ts"
import { clearModrinthEnrichCache, enrichBuildModNames } from "../../lib/modrinth-metadata.ts"

{
  const read = file => fs.readFileSync(new URL(`../../components/launcher/${file}`, import.meta.url), "utf8")
  describe("visible-action-buttons", () => {
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
  })
}

{
  const test = nodeTest
  describe("skins-empty-copy", () => {
    for (const locale of ['ru', 'en', 'uk', 'de', 'es', 'pl']) test(`пустое состояние скинов действительно отображает заголовок и обе подсказки (${locale})`, async () => {
      const strings = JSON.parse(fs.readFileSync(new URL(`../../src/i18n/locales/${locale}/translation.json`, import.meta.url), 'utf8'))
      const i18n = createInstance()
      await i18n.use(initReactI18next).init({ lng: locale, resources: { [locale]: { translation: strings } } })
      const html = renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(EmptySkinsState)))
      for (const key of ['skins.noAccounts', 'skins.noAccountsDesc', 'skins.noAccountsHint']) {
        assert.equal(typeof strings[key], 'string')
        assert.ok(strings[key].trim())
        const escaped = renderToStaticMarkup(React.createElement('span', null, strings[key])).slice(6, -7)
        assert.ok(html.includes(escaped))
        assert.ok(!html.includes(key))
      }
      assert.match(html, /<h3\b/)
      assert.match(html, /aria-hidden="true"/)
    })
  })
}

{
  const test = nodeTest
  describe("settings-onboarding-card", () => {
    test('настоящая карточка сброса посылает одно событие и имеет доступную кнопку', () => {
      const events = []
      const { OnboardingResetCard } = loadReactModule(new URL('../../components/launcher/settings/settings-language-about.tsx', import.meta.url), {
        './settings-update': { SettingsUpdate: () => null }, './settings-switch': { SettingsSwitch: () => null },
      }, { window: { dispatchEvent: event => events.push(event.type) } })
      const tree = OnboardingResetCard({ t: key => key })
      const buttons = reactNodes(tree).filter(node => node.type === 'button')
      assert.equal(buttons.length, 1)
      assert.equal(buttons[0].props.type, 'button')
      assert.ok(buttons[0].props.children.includes('settings.about.onboarding.button'))
      assert.deepEqual(events, [])
      buttons[0].props.onClick()
      assert.deepEqual(events, ['launcher:onboarding-reset'])
    })
  })
}

{
  const test = bunTest
  describe("progress-localization", () => {
    for (const language of ["ru", "en", "uk", "de", "es", "pl"]) test(`этапы импорта переводятся в ${language} без потери числового прогресса`, async () => {
      const dictionary = await Bun.file(`src/i18n/locales/${language}/translation.json`).json()
      const i18n = createInstance()
      await i18n.init({ lng: language, resources: { [language]: { translation: dictionary } } })
      for (const phase of ["preparing", "package", "files", "extracting", "copying", "scanning", "complete", "cancelling"] as const) {
        const messageKey = `import.phase.${phase}`
        const result = localizeImportProgress({ current: 2, total: 5, phase, message: "", messageKey }, (key, params) => String(i18n.t(key, params)))
        expect(result.message).toBe(dictionary[messageKey])
        expect(result.message).not.toBe(messageKey)
        expect([result.current, result.total, result.phase]).toEqual([2, 5, phase])
      }
    })
  })
}

{
  const test = bunTest
  describe("main-localization", () => {
    test("Discord presence не публикует локальные/credential URL и сохраняет loader metadata", () => {
      for (const url of [undefined, "not a url", "file:///private.png", "https://user:password@example.test/icon.png", "http://localhost/icon.png", "http://127.0.0.1/icon.png", "http://[::1]/icon.png", "http://0.0.0.0/icon.png"]) expect(discordImageUrl(url)).toBeUndefined()
      expect(discordImageUrl("https://cdn.example.test/icon.png")).toBe("https://cdn.example.test/icon.png")
      expect(presenceSmallImage({ loader: "fabric" })).toEqual({ key: "fabric_icon", text: "Fabric" })
      expect(presenceSmallImage({})).toEqual({ key: undefined, text: undefined })
      expect(presenceSmallImage({ smallImageKey: "custom", smallImageText: "Custom" })).toEqual({ key: "custom", text: "Custom" })
    })

    for (const locale of ["ru", "en", "uk", "de", "es", "pl"]) test(`native UI и presence используют ${locale} и подставляют параметры`, async () => {
      const t = await translatorForLocale(locale)
      const dictionary = await Bun.file(`src/i18n/locales/${locale}/translation.json`).json()
      const keys = Object.keys(dictionary).filter(key => key.startsWith("runtime."))
      expect(keys.length).toBe(21)
      for (const key of keys) {
        const value = t(key, { required: 21, message: "DETAIL", name: "Pack", version: "1.21", file: "test.jar" })
        expect(value).not.toBe(key)
        expect(value).not.toContain("{{")
      }
      expect(minecraftPresence("1.21", "fabric", { name: "Pack" }, t).state).toContain("Pack")
      expect(minecraftPresence("1.21", "vanilla", undefined, t).state).toContain("1.21")
    })
  })
}

{
  const test = bunTest
  describe("resourcepack-author", () => {
    test("автор установленного ресурспака берётся из команды Modrinth", async () => {
      clearModrinthEnrichCache()
      const previousFetch = globalThis.fetch
      const calls: string[] = []
      globalThis.fetch = (async input => {
        const url = String(input)
        calls.push(url)
        if (url.includes("/projects?")) return Response.json([{ id: "pack-id", title: "Pack", team: "team-id" }])
        if (url.includes("/teams?")) return Response.json([[{ team_id: "team-id", role: "Member", user: { username: "contributor" } }, { team_id: "team-id", role: "Owner", user: { username: "Author" } }]])
        throw new Error(`Unexpected request: ${url}`)
      }) as typeof fetch
      try {
        const items = [{ slug: "pack.zip", name: "Pack", source: "modrinth" as const, projectId: "pack-id" }]
        const initial = await enrichBuildModNames(items)
        expect(initial[0].author).toBeUndefined()
        const enriched = await enrichBuildModNames(items, { includeOwners: true })
        expect(enriched[0].author).toBe("Author")
        expect((await enrichBuildModNames(items))[0].author).toBeUndefined()
        const count = calls.length
        expect((await enrichBuildModNames(items, { includeOwners: true }))[0].author).toBe("Author")
        expect(calls).toHaveLength(count)
      } finally {
        globalThis.fetch = previousFetch
        clearModrinthEnrichCache()
      }
    })
  })
}
