import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"

const require = createRequire(import.meta.url)
const original = fs.readFileSync(new URL("../../components/launcher/skins-page.tsx", import.meta.url), "utf8")

function render(accounts, tab) {
  // Проверяем оба состояния переключателя с настоящим React, без подмены hooks.
  const source = original.replace('useState<SkinsTab>("favorites")', `useState<SkinsTab>("${tab}")`)
  const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  const module = { exports: {} }
  const mounted = []
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === "@/src/AccountsContext") return { useAccounts: () => ({ accounts }) }
    if (name === "react-i18next") return { useTranslation: () => ({ t: key => key }) }
    if (name === "./content-motion") return { CONTENT_ENTER_DELAYED: "" }
    if (name === "./skins") return {
      FavoritesTab: () => { mounted.push("favorites"); return React.createElement("div", { "data-test": "favorites" }) },
      EmptySkinsState: () => React.createElement("div", { "data-test": "unavailable" }),
    }
    if (name === "./laby") return { LabyLibraryTab: () => { mounted.push("library"); return React.createElement("div", { "data-test": "library" }) } }
    return require(name)
  } })
  return { html: renderToStaticMarkup(React.createElement(module.exports.SkinsPage)), mounted }
}

for (const tab of ["favorites", "library"]) {
  for (const types of [[], ["offline"], ["elyby"], ["offline", "elyby"]]) {
    test(`Скины: ${tab} недоступна без подходящего аккаунта (${types.join(",") || "пусто"})`, () => {
      const f = render(types.map(type => ({ type })), tab)
      assert.ok(f.html.includes('data-test="unavailable"'))
      assert.deepEqual(f.mounted, [], "Закрытая вкладка не должна монтироваться и запускать загрузку каталога")
    })
  }
  for (const type of ["microsoft", "xnskins", "authlib-injector"]) {
    test(`Скины: ${tab} доступна с ${type}, даже если активен Ely.by`, () => {
      const f = render([{ type: "elyby", isActive: true }, { type, isActive: false }], tab)
      assert.ok(!f.html.includes('data-test="unavailable"'))
      assert.deepEqual(f.mounted, [tab])
    })
  }
}
