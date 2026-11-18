import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import { IconWorld, IconPlus } from "@tabler/icons-react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

test("пустой список Authlib-серверов не дублирует значок провайдера глобусом", () => {
  const source = fs.readFileSync(new URL("../../components/launcher/accounts/authlib-injector-modal.tsx", import.meta.url), "utf8")
  const start = source.indexOf('<div data-ui="accounts-authlib-injector-modal-div-31"')
  const end = source.indexOf("\n            ) : (", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const module = { exports: {} as React.ReactElement }
  let view = "login"
  vm.runInNewContext(transformSync(`module.exports = (${source.slice(start, end)});`, { loader: "tsx", format: "cjs", jsx: "automatic" }).code, {
    module, require: createRequire(import.meta.url), IconWorld, IconPlus,
    t: (key: string) => key, setView: (value: string) => { view = value },
    setAddStep() {}, setInputUrl() {}, setProbeError() {},
  })
  const html = renderToStaticMarkup(module.exports)
  expect(html).not.toContain("tabler-icon-world")
  expect(html).toContain("accounts.authlibNoServers")
  expect(html).toContain("accounts.authlibAddServer")
  expect(module.exports.props.className).toContain("pt-0")
  const children = React.Children.toArray(module.exports.props.children) as React.ReactElement<any>[]
  children.find(child => child.type === "button")!.props.onClick()
  expect(view).toBe("add-server")
})
