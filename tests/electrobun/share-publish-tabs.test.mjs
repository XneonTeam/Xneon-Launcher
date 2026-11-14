import { test } from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createInstance } from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { SharePublishTabs } from "../../components/launcher/instance/shared/share-publish-tabs.tsx"

for (const value of ["changes", "files"]) {
  test(`Публикация: активная вкладка ${value} выделена как переключатели настроек`, async () => {
    const i18n = createInstance()
    await i18n.use(initReactI18next).init({ lng: "ru", resources: {} })
    const html = renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(SharePublishTabs, {
      value, onChange() {}, shared: false, changeCount: 2, fileCount: 3,
    })))
    const active = html.match(/<button[^>]*aria-pressed="true"[\s\S]*?<\/button>/)?.[0]
    const inactive = html.match(/<button[^>]*aria-pressed="false"[\s\S]*?<\/button>/)?.[0]
    assert.ok(active)
    assert.match(active, /bg-primary text-primary-foreground shadow-sm/)
    assert.ok(!active.includes("shrink-0 text-primary\""))
    assert.match(active, /text-primary-foreground/)
    assert.ok(inactive)
    assert.match(inactive, /text-muted-foreground/)
    assert.ok(!inactive.includes("bg-primary text-primary-foreground shadow-sm"))
  })
}
