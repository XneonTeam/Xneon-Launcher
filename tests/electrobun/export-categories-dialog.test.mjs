import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"

const require = createRequire(import.meta.url)
const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")

test("Серверы и инстансы используют один диалог выбора категорий вместо копий разметки", () => {
  for (const file of ["components/launcher/server/server-context-menu.tsx", "components/launcher/instance/instance-list.tsx"]) {
    const source = read(file)
    assert.ok(source.includes("<ExportCategoriesDialog"), file)
    assert.ok(!source.includes("<Checkbox"), file)
  }
})

function fixture(selected = ["world", "mods"]) {
  const source = read("components/launcher/export-categories-dialog.tsx")
  const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  const module = { exports: {} }
  const ModalLayer = () => null
  const Checkbox = () => null
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === "@/components/ui/modal-layer") return { ModalLayer }
    if (name === "@/components/ui/checkbox") return { Checkbox }
    return require(name)
  } })
  const changes = []
  let exported = 0
  let closed = 0
  const props = { windowId: "export-test", title: "Export", description: "Choose categories", categories: [
    { id: "world", label: "World", description: "world" },
    { id: "mods", label: "Mods", description: "mods" },
    { id: "logs", label: "Logs", description: "logs" },
  ], selected: new Set(selected), onSelectedChange: value => changes.push([...value]), onClose: () => closed++,
    onExport: () => exported++, selectAllLabel: "All", cancelLabel: "Cancel", exportLabel: "Export" }
  const tree = module.exports.ExportCategoriesDialog(props)
  const elements = []
  function walk(node) {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.props) { elements.push(node); walk(node.props.children) }
  }
  walk(tree)
  return { tree, elements, ModalLayer, Checkbox, props, changes, exported: () => exported, closed: () => closed }
}

test("Общий экспорт: единый ModalLayer, ширина и фон как в инстансах, без отдельного blur", () => {
  const f = fixture()
  assert.equal(f.tree.type, f.ModalLayer)
  assert.equal(f.tree.props.className, "p-4")
  assert.equal(f.tree.props.windowId, "export-test")
  assert.ok(f.elements.some(el => el.props.className === "w-full max-w-[420px] rounded-2xl border border-border bg-card p-5 shadow-2xl"))
  assert.ok(!f.elements.some(el => el.props.className?.includes("backdrop-blur")))
  f.tree.props.onClose()
  assert.equal(f.closed(), 1)
})

test("Общий экспорт: переключение категорий не мутирует исходный выбор и не закрывает окно", () => {
  const f = fixture()
  const boxes = f.elements.filter(el => el.type === f.Checkbox)
  assert.equal(boxes.length, 3)
  assert.equal(boxes[0].props.checked, true)
  boxes[0].props.onCheckedChange(false)
  boxes[2].props.onCheckedChange(true)
  assert.deepEqual(f.changes, [["mods"], ["world", "mods", "logs"]])
  assert.deepEqual([...f.props.selected], ["world", "mods"])
  assert.equal(f.closed(), 0)
})

test("Общий экспорт: выбрать всё, отмена и запрет пустого экспорта", () => {
  const f = fixture([])
  const buttons = f.elements.filter(el => el.type === "button")
  buttons.find(el => el.props["data-action"] === "select-all").props.onClick()
  assert.deepEqual(f.changes, [["world", "mods", "logs"]])
  assert.equal(buttons.find(el => el.props["data-action"] === "export").props.disabled, true)
  buttons.find(el => el.props["data-action"] === "cancel").props.onClick()
  assert.equal(f.closed(), 1)
  const filled = fixture()
  const exportButton = filled.elements.find(el => el.props["data-action"] === "export")
  assert.equal(exportButton.props.disabled, false)
  exportButton.props.onClick()
  assert.equal(filled.exported(), 1)
})
