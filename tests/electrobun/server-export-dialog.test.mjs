import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"

const source = fs.readFileSync(new URL("../../components/launcher/server/server-context-menu.tsx", import.meta.url), "utf8")
const require = createRequire(import.meta.url)

function renderMenu(exportDialogFor, exporting = false) {
  const opening = source.indexOf("<FloatingContextMenu")
  const closing = source.indexOf("</FloatingContextMenu>", opening) + "</FloatingContextMenu>".length
  assert.ok(opening >= 0)
  // Выполняем настоящий JSX-guard компонента с лёгким содержимым вместо пунктов.
  const prefix = source.slice(source.lastIndexOf("\n", opening) + 1, opening).trim()
  const suffix = source.slice(closing, source.indexOf("\n", closing)).trim()
  const expression = `${prefix}<FloatingContextMenu position={position} onClose={onClose} />${suffix}`
  const code = transformSync(`module.exports = <>${expression}</>`, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  const module = { exports: {} }
  vm.runInNewContext(code, { module, require, exportDialogFor, exporting, position: { x: 0, y: 0 }, onClose() {}, FloatingContextMenu() {} })
  return module.exports.props.children
}

test("Экспорт сервера: контекстное меню с outside-mousedown не смонтировано под модалом", () => {
  assert.equal(renderMenu(true), false)
})

test("Экспорт сервера: обычное меню остаётся доступно до открытия модала", () => {
  assert.ok(renderMenu(false)?.props.onClose)
})

test("Экспорт сервера: контекстное меню не возвращается под прогрессом экспорта", () => {
  assert.equal(renderMenu(false, true), false)
})

test("Экспорт сервера: выбор закрывается до IPC, прогресс завершается вместе с операцией", async () => {
  const handler = source.match(/const handleExportZip = async \(\) => \{[\s\S]*?\n  \}/)?.[0]
  assert.ok(handler)
  const state = []
  let resolveExport
  const ipc = new Promise(resolve => { resolveExport = resolve })
  const run = vm.runInNewContext(`(${handler.replace("const handleExportZip = ", "")})`, {
    exporting: false,
    setExportDialogFor: value => state.push(["dialog", value]),
    setExporting: value => state.push(["progress", value]),
    server: { id: "server-test", name: "Test" },
    exportCategories: new Set(["world", "mods"]),
    window: { electrobunAPI: { mcServerExportZip: (id, name, categories) => {
      state.push(["ipc", id, name, [...categories]])
      return ipc
    } } },
    onClose: () => state.push(["close"]),
  })
  const completion = run()
  assert.deepEqual(state, [["dialog", false], ["progress", true], ["ipc", "server-test", "Test", ["world", "mods"]]])
  resolveExport({ success: true })
  await completion
  assert.deepEqual(state.slice(-2), [["progress", false], ["close"]])
})
