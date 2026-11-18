import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL("../../components/launcher/instance/index.tsx", import.meta.url), "utf8")
const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code

function pageFixture(view = "my", hasActiveBuild = false) {
  const build = { id: "build", name: "Build", icon: "https://cdn.example/icon.png", mods: [], resourcepacks: [], shaders: [] }
  const module = { exports: {} as { InstancePage: (props: { active: boolean }) => any } }
  const components = new Map<string, Function>()
  let stateIndex = 0
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return require(name)
      if (name === "react") return {
        useState: (initial: unknown) => [stateIndex++ === 0 ? view : typeof initial === "function" ? initial() : initial, () => {}],
        useRef: (current: unknown) => ({ current }),
        useCallback: (callback: Function) => callback,
        useEffect: () => {},
      }
      if (name === "../content-motion") return { useContentEnter: () => "settings-content-enter" }
      if (name === "@/lib/utils") return { cn: (...values: string[]) => values.join(" ") }
      if (name === "./use-builds") return { useBuilds: () => ({ builds: [build], buildsHydrated: true, activeBuild: hasActiveBuild ? build : null }) }
      if (name === "./use-mod-search") return { useModSearch: () => ({}) }
      if (name === "./use-import") return { useImport: () => ({}) }
      if (name === "@/src/hooks/use-minecraft-version-options") return { useMinecraftVersionOptions: () => ({ visibleVersions: [], versionsLoaded: true }) }
      if (name === "@/src/AccountsContext") return { useAccounts: () => ({ activeAccount: null, accountsHydrated: true }) }
      if (name === "@/src/hooks/use-build-launch") return { useBuildLaunch: () => ({}) }
      if (name === "@/lib/swr") return {}
      if (name === "./sort-options") return { SORT_OPTIONS_BY_SOURCE: {} }
      return new Proxy({}, {
        get(_target, key: string) {
          if (!components.has(key)) components.set(key, () => null)
          return components.get(key)
        },
      })
    },
  })
  return {
    build,
    components,
    render(active: boolean) { stateIndex = 0; return module.exports.InstancePage({ active }) },
  }
}

function findComponent(element: any, type: Function): any {
  if (!element || typeof element !== "object") return undefined
  if (element.type === type) return element
  const children = element.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findComponent(child, type)
    if (found) return found
  }
}

test("уход из раздела сохраняет список карточек и источник иконки внутри Activity", () => {
  const fixture = pageFixture()
  const visible = fixture.render(true)
  const hidden = fixture.render(false)
  expect(hidden).not.toBeNull()
  expect(hidden.type).toBe(visible.type)
  const type = fixture.components.get("InstanceList")!
  const list = findComponent(hidden, type)
  expect(list).toBeDefined()
  expect(list.props.builds[0]).toBe(fixture.build)
  expect(list.props.builds[0].icon).toBe("https://cdn.example/icon.png")
  expect(findComponent(fixture.render(true), type).type).toBe(list.type)
})

test("скрытая тяжёлая страница сборки и каталоги по-прежнему выгружаются", () => {
  for (const view of ["detail", "modrinth", "curseforge", "ftb", "trash"]) {
    const fixture = pageFixture(view, view === "detail")
    expect(fixture.render(true)).not.toBeNull()
    expect(fixture.render(false)).toBeNull()
  }
})

test("невалидный detail сохраняет фактически показанный список сборок", () => {
  const fixture = pageFixture("detail")
  expect(findComponent(fixture.render(true), fixture.components.get("InstanceList")!)).toBeDefined()
  expect(findComponent(fixture.render(false), fixture.components.get("InstanceList")!)).toBeDefined()
})
