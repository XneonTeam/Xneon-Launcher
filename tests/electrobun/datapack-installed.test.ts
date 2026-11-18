import { expect, test } from "bun:test"
import { findInstalledDatapack } from "../../lib/datapack-installed"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import { renderToStaticMarkup } from "react-dom/server"

const pack = { name: "tectonic-v2.zip", displayName: "Tectonic", author: "Apollo", projectId: "mrProject", path: "World/datapacks/tectonic-v2.zip", sizeBytes: 100, lastModified: 1 }
const project = { id: "cfProject", name: "Tectonic", slug: "tectonic", source: "curseforge" as const, modId: 123, author: "Apollo" }

test("датапак распознаётся по projectId и при поиске на другой площадке по точному имени", () => {
  expect(findInstalledDatapack([pack], project)).toBe(pack)
  expect(findInstalledDatapack([pack], { ...project, source: "modrinth", projectId: "mrProject", name: "Renamed" })).toBe(pack)
})

test("похожие названия, разные авторы, конфликт ID и битые пакеты не считаются установленными", () => {
  expect(findInstalledDatapack([pack], { ...project, name: "Tectonic Extra", slug: "tectonic-extra" })).toBeUndefined()
  expect(findInstalledDatapack([pack], { ...project, author: "Other" })).toBeUndefined()
  expect(findInstalledDatapack([pack], { ...project, source: "modrinth", projectId: "different" })).toBeUndefined()
  expect(findInstalledDatapack([{ ...pack, parseError: "invalid" }], project)).toBeUndefined()
})

test("удаление и смена мира убирают отметку; локальный пакет распознаётся по имени файла", () => {
  expect(findInstalledDatapack([], project)).toBeUndefined()
  expect(findInstalledDatapack([{ ...pack, displayName: undefined, projectId: undefined }], { ...project, primaryFileName: "tectonic-v2.zip" })).toBeDefined()
})

test("кнопка каталога показывает Установлен и блокирует повторную установку", () => {
  const source = fs.readFileSync(new URL("../../components/launcher/instance/instance-worlds-tab.tsx", import.meta.url), "utf8")
  const start = source.indexOf('<button data-ui="instance-instance-worlds-tab-button-27"')
  const end = source.indexOf("</button>", start) + "</button>".length
  const code = transformSync(`(${source.slice(start, end)})`, { loader: "tsx", format: "cjs", jsx: "automatic" }).code
  for (const installed of [true, false]) {
    const icon = () => null
    const element = vm.runInNewContext(code, { require: createRequire(import.meta.url), installed, installing: null, mod: project,
      cn: (...args: string[]) => args.join(" "), t: (key: string) => key, IconCheck: icon, IconLoader2: icon, IconDownload: icon, handleInstallDatapackRemote() {},
    })
    expect(element.props.disabled).toBe(installed)
    expect(renderToStaticMarkup(element)).toContain(installed ? "addon.installed" : "worlds.ui.install")
  }
})
