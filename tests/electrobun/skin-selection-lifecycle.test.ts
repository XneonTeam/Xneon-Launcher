import { expect, test } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { equippedSkinId, initialSkinSelection } from "../../lib/skin-selection"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** Исполняем настоящие хуки FavoritesTab, не подменяя состояние снимками исходника. */
function renderer() {
  const hooks: any[] = []
  const accounts = [{ id: "a", type: "microsoft" }, { id: "b", type: "microsoft" }]
  let activeAccount = accounts[0]
  let index = 0
  let dirty = true
  let tree: any
  const effects: (() => void)[] = []
  const library = [{ id: "saved", accountId: "a", name: "Saved", filePath: "saved.png", variant: "classic", capeId: null }]
  const profile = deferred<any>()
  const applied = deferred<boolean>()
  const notifications: any[] = []
  const notify = (n: any) => notifications.push(n)
  const t = (key: string) => key
  const react = {
    useState(initial: any) {
      const i = index++
      hooks[i] ??= { value: typeof initial === "function" ? initial() : initial }
      return [hooks[i].value, (value: any) => {
        const next = typeof value === "function" ? value(hooks[i].value) : value
        if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true }
      }]
    },
    useRef(initial: any) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i] },
    useMemo(fn: any) { return fn() },
    useCallback(fn: any) { return fn },
    useEffect(fn: any, deps: any[]) {
      const i = index++
      const previous = hooks[i]
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
        hooks[i] = { deps, cleanup: previous?.cleanup }
        effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn() })
      }
    },
    lazy: () => "EditSkinModal", Suspense: "Suspense",
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
  }
  const module = { exports: {} as any }
  vm.runInNewContext(transformSync(fs.readFileSync("components/launcher/skins/favorites-tab.tsx", "utf8"), {
    loader: "tsx", format: "cjs", jsx: "automatic",
  }).code, {
    module, exports: module.exports, Map, Set, console, File,
    window: { electrobunAPI: {
      skinsGetProfile: async (id: string) => id === "a" ? profile.promise : null,
      skinsListLibrary: async (id: string) => id === "a" ? library : [],
      skinsApplyLibrarySkin: () => applied.promise,
      avatarInvalidateCache: async () => {},
    } },
    require(name: string) {
      if (name === "react") return react
      if (name === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
      if (name === "react-i18next") return { useTranslation: () => ({ t }) }
      if (name === "@/src/AccountsContext") return { useAccounts: () => ({ accounts, activeAccount, bumpAvatarVersion() {}, reloadAccounts: async () => {} }) }
      if (name === "@/src/ActivityCenterContext") return { useActivityCenter: () => ({ pushNotification: notify }) }
      if (name === "@/lib/skin-selection") return { equippedSkinId, initialSkinSelection }
      if (name === "@/lib/local-file-url") return { localFileToBlobUrl: async () => "blob:saved", releaseLocalFileUrl() {} }
      if (name === "./cape-url") return { findActiveCape: () => null, resolveSkinCapeUrl: () => undefined }
      if (name === "../content-motion") return { useContentEnter: () => "", CONTENT_ENTER_DELAYED: "" }
      return new Proxy({}, { get: (_target, key) => String(key) })
    },
  })
  function flush() {
    for (let limit = 0; dirty && limit < 30; limit++) {
      dirty = false; index = 0
      tree = module.exports.FavoritesTab()
      for (const effect of effects.splice(0)) effect()
    }
    if (dirty) throw new Error("Render loop")
  }
  async function settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); flush() } }
  function find(type: string, node: any): any {
    if (!node || typeof node !== "object") return null
    if (node.type === type) return node.props
    const children = node.props?.children
    for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
      const result = find(type, child)
      if (result) return result
    }
    return null
  }
  flush()
  return { profile, applied, library, notifications, settle, grid: () => find("SkinGrid", tree), panel: () => find("SkinPreviewPanel", tree),
    switchAccount() { activeAccount = accounts[1]; dirty = true; flush() } }
}

const current = (equippedLibrarySkinId: string | null) => ({ id: "uuid", name: "Player", capes: [], equippedLibrarySkinId,
  skins: [{ id: "skin", state: "ACTIVE", url: "data:image/png;base64,test", variant: "CLASSIC" }] })

test("холодный вход ждёт профиль и выбирает настоящий надетый скин", async () => {
  const r = renderer()
  await r.settle()
  expect(r.grid().selectedId).toBeNull()
  r.profile.resolve(current("saved"))
  await r.settle()
  expect(r.grid().selectedId).toBe("saved")
  expect(r.grid().equippedId).toBe("saved")
})

test("внешний надетый скин остаётся карточкой при непустом избранном; выбор отдельный", async () => {
  const r = renderer()
  r.profile.resolve(current(null))
  await r.settle()
  expect(r.grid().skins.map((skin: any) => skin.id)).toEqual(["saved", "__api__"])
  expect(r.grid().selectedId).toBe("__api__")
  r.grid().onSelect("saved")
  await r.settle()
  expect(r.grid().equippedId).toBe("__api__")
  expect(r.panel().hasPendingChange).toBe(true)
})

test("поздний профиль прошлого аккаунта не меняет новый аккаунт", async () => {
  const r = renderer()
  r.switchAccount()
  r.profile.resolve(current("saved"))
  await r.settle()
  expect(r.grid().skins).toEqual([])
  expect(r.grid().equippedId).toBeNull()
})

test("применение, завершившееся после смены аккаунта, не переносит выделение", async () => {
  const r = renderer()
  r.profile.resolve(current(null))
  await r.settle()
  r.grid().onSelect("saved")
  await r.settle()
  const applying = r.panel().onApply()
  r.switchAccount()
  r.applied.resolve(true)
  await applying
  await r.settle()
  expect(r.grid().selectedId).toBeNull()
  expect(r.grid().equippedId).toBeNull()
})
