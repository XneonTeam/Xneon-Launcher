import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { transformSync } from "esbuild"
import { scopedContentUpdates } from "../../lib/content-update-state"

const latest = { id: "new", name: "2", fileName: "file.zip", files: [{ filename: "file.zip", url: "url", size: 1 }] }
const mod = { itemId: "mod", contentType: "mods", source: "modrinth", name: "OnlyMod", currentVersion: "1", latestVersion: latest }
const pack = { ...mod, itemId: "pack", name: "OnlyPack", contentType: "resourcepacks" }
const cached = { buildId: "build", channel: "release", checkedAt: 1, updates: [mod, pack] }

function harness(api: Record<string, Function> = {}) {
  const states: any[] = [], refs: any[] = [], effects: Function[] = [], installs: any[] = []
  let stateIndex = 0, refIndex = 0
  const source = fs.readFileSync(new URL("../../components/launcher/instance/instance-updates-dialog.tsx", import.meta.url), "utf8")
    .replace(/^import .*\r?\n/gm, "").replace("export const InstanceUpdatesDialog", "const InstanceUpdatesDialog")
  const icon = () => null
  const scope: Record<string, any> = {
    React, scopedContentUpdates, memo: (fn: Function) => fn,
    useState: (initial: any) => {
      const index = stateIndex++
      if (!(index in states)) states[index] = index === 1 ? cached : typeof initial === "function" ? initial() : initial
      return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value }]
    },
    useRef: (initial: any) => refs[refIndex] ?? (refs[refIndex++] = { current: initial }),
    useMemo: (fn: Function) => fn(), useCallback: (fn: Function) => fn, useEffect: (fn: Function) => effects.push(fn),
    useTranslation: () => ({ t: (key: string, vars?: object) => `${key}${vars ? JSON.stringify(vars) : ""}` }),
    cn: (...values: any[]) => values.filter(Boolean).join(" "),
    ModalLayer: ({ children }: any) => React.createElement("div", null, children),
    ReactMarkdown: icon, remarkGfm: icon, rehypeRaw: icon, rehypeSanitize: icon, ChangelogContent: icon, PlatformBadge: icon,
    window: { dispatchEvent: () => {}, electrobunAPI: { dismissContentUpdate: async () => {}, ...api } },
    CustomEvent: class { constructor(public type: string) {} },
  }
  for (const name of ["IconRefresh", "IconDownload", "IconX", "IconCheck", "IconChevronDown", "IconChevronRight", "IconPuzzle", "IconPhoto", "IconSparkles", "IconAlertCircle", "IconLoader2"]) scope[name] = icon
  vm.runInNewContext(transformSync(`${source}\nglobalThis.renderDialog = InstanceUpdatesDialog`, { loader: "tsx" }).code, scope)
  const tree = scope.renderDialog({
    activeBuild: { id: "build", name: "Build", mods: [], resourcepacks: [{ id: "pack", icon_url: "https://example.org/pack.png" }], shaders: [] },
    contentType: "resourcepacks", open: true, onOpenChange: () => {},
    updateItemVersion: async (...args: any[]) => { installs.push(args); return true },
  })
  function button(id: string): any {
    let found: any
    function walk(node: any) {
      if (!React.isValidElement(node)) return
      const props = node.props as any
      if (props["data-ui"] === id) found = node
      React.Children.forEach(props.children, walk)
    }
    walk(tree)
    return found
  }
  return { states, refs, effects, installs, tree, button }
}

test("ресурспаки: реальные строки, счётчик, иконка и обновить все ограничены вкладкой", async () => {
  const result = harness()
  const html = renderToStaticMarkup(result.tree)
  expect(html).toContain("OnlyPack")
  expect(html).not.toContain("OnlyMod")
  expect(html).toContain("https://example.org/pack.png")
  expect(html).toContain("updates.total{&quot;count&quot;:1}")
  result.button("instance-instance-updates-dialog-button-6").props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(result.installs.map(args => args[1])).toEqual(["resourcepacks"])
  expect(result.states[1].updates.map((item: any) => item.itemId)).toEqual(["mod"])
})

test("старый ответ проверки не возвращает установленное обновление после dismiss", async () => {
  const check = Promise.withResolvers<any>()
  const result = harness({ getContentUpdatesCache: async () => ({ build: cached }), checkBuildContentUpdates: () => check.promise })
  result.effects[1]()
  await new Promise(resolve => setTimeout(resolve, 0))
  result.button("instance-instance-updates-dialog-button-5").props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  check.resolve(cached)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(result.states[1].updates.map((item: any) => item.itemId)).toEqual(["mod"])
})
