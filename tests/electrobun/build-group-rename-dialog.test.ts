import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { IconPencil, IconX } from "@tabler/icons-react"
import { transformSync } from "esbuild"
import { ModalTitleIcon } from "../../components/ui/modal-title-icon"
import { reactNodes } from "../helpers/react-module.mjs"

function dialogFixture() {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/instance-list.tsx", import.meta.url), "utf8")
  const marker = "{renameGroupFor && ("
  const start = source.indexOf(marker) + marker.length
  const end = source.indexOf("\n      )}", start)
  expect(start).toBeGreaterThan(marker.length)
  expect(end).toBeGreaterThan(start)
  const module = { exports: {} as React.ReactElement }
  let saved = 0
  const closed: unknown[] = []
  const code = transformSync(`module.exports = (${source.slice(start, end)});`, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  vm.runInNewContext(code, {
    module, require: createRequire(import.meta.url),
    ModalLayer: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
    ModalCloseButton: () => null,
    ModalTitleIcon, IconPencil, LauncherCancelIcon: IconX,
    renameGroupDraft: "123", setRenameGroupDraft() {},
    setRenameGroupFor: (value: unknown) => closed.push(value),
    handleRenameGroup: () => { saved++ },
    t: (key: string) => key === "instanceList.renameGroup" ? "Переименовать группу" : key,
  })
  return { tree: module.exports, closed, get saved() { return saved } }
}

test("окно переименования группы показывает карандаш в стандартной иконке заголовка", () => {
  const fixture = dialogFixture()
  const html = renderToStaticMarkup(fixture.tree)
  expect(html).toContain("Переименовать группу")
  expect(html).toContain("tabler-icon-pencil")
  expect(html).toContain("bg-primary/20")
})

test("иконка заголовка не меняет переименование по Enter и закрытие по Escape", () => {
  const fixture = dialogFixture()
  const input = reactNodes(fixture.tree).find((node: any) => node.type === "input")
  input.props.onKeyDown({ key: "Enter" })
  expect(fixture.saved).toBe(1)
  input.props.onKeyDown({ key: "Escape" })
  expect(fixture.closed).toEqual([null])
})

test("заголовок с иконкой и крестик находятся в одной верхней строке без пустого отступа", () => {
  const fixture = dialogFixture()
  const nodes = reactNodes(fixture.tree)
  const title = nodes.find((node: any) => node.props["data-ui"] === "instance-instance-list-p-7")
  const close = nodes.find((node: any) => typeof node.type === "function" && typeof node.props.onClick === "function")
  const header = nodes.find((node: any) => Array.isArray(node.props.children) && node.props.children.includes(title) && node.props.children.includes(close))
  expect(header).toBeDefined()
  expect(header.props.className).toContain("flex items-center")
  expect(close.props.className ?? "").not.toContain("absolute")
  const panel = nodes.find((node: any) => node.props["data-ui"] === "instance-instance-list-div-41")
  expect(panel.props.className).not.toContain("pt-14")
  close.props.onClick()
  expect(fixture.closed).toEqual([null])
})
