import { describe, test, expect } from "bun:test"
import fs from "node:fs"
import vm from "node:vm"
import { build } from "esbuild"
import { preloadedPage } from "../../components/launcher/preloaded-page"
import { loadReactModule } from "../helpers/react-module.mjs"

const read = (file: string) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")

describe("Фоновое воспроизведение", () => {
  function fixture(hidden = false, enabled = true) {
    const document = Object.assign(new EventTarget(), { hidden })
    let value: boolean
    let cleanup: (() => void) | undefined
    let polls = 0
    let timers = 0
    const module = loadReactModule(new URL("../../components/launcher/settings/theme-runtime.tsx", import.meta.url), {
      react: {
        useState(initial: boolean) { value = initial; return [value, (next: boolean) => { value = next }] },
        useEffect(effect: () => (() => void) | undefined) { cleanup = effect() },
      },
      "@/lib/launcher-assets": {},
      "./theme-model": {},
    }, { document, window: {
      electrobunAPI: { isMinecraftRunning: async () => { polls++; return true } },
      setInterval() { timers++; return 1 }, clearInterval() {},
    } })
    module.useMediaPaused(enabled)
    return { document, paused: () => value, polls: () => polls, timers: () => timers, dispose: () => cleanup?.() }
  }

  test("Видимый фон не останавливается из-за работающей игры и не опрашивает JVM", async () => {
    const f = fixture()
    await Promise.resolve()
    expect(f.paused()).toBe(false)
    expect(f.polls()).toBe(0)
    expect(f.timers()).toBe(0)
    f.dispose()
  })

  test("Скрытие экономит ресурсы, возврат немедленно возобновляет воспроизведение", async () => {
    const f = fixture(true)
    await Promise.resolve()
    expect(f.paused()).toBe(true)
    f.document.hidden = false
    f.document.dispatchEvent(new Event("visibilitychange"))
    expect(f.paused()).toBe(false)
    f.dispose()
    f.document.hidden = true
    f.document.dispatchEvent(new Event("visibilitychange"))
    expect(f.paused()).toBe(false)
  })

  test("Статичные обои не создают опросов и подписок", () => {
    const f = fixture(false, false)
    f.document.hidden = true
    f.document.dispatchEvent(new Event("visibilitychange"))
    expect(f.paused()).toBe(false)
    expect(f.polls()).toBe(0)
    expect(f.timers()).toBe(0)
    f.dispose()
  })
})

describe("Мгновенное открытие сервера", () => {
  test("Готовность списка гарантирует готовность карточки без повторного Suspense", async () => {
    const imported: string[] = []
    const result = await build({
      entryPoints: ["components/launcher/page-loaders.ts"], bundle: true, write: false, platform: "node", format: "cjs",
      plugins: [{ name: "page-fixtures", setup(builder) {
        builder.onResolve({ filter: /^\.\// }, args => args.importer.endsWith("page-loaders.ts")
          ? { path: args.path, namespace: "fixture" } : undefined)
        builder.onResolve({ filter: /^@\/lib\/page-loader$/ }, () => ({ path: new URL("../../lib/page-loader.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") }))
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: `globalThis.imported.push(${JSON.stringify(args.path)}); export const ServersPage = () => null; export const ServerDetailPage = () => null;`, loader: "js" }))
      } }],
    })
    const module = { exports: {} as any }
    vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, imported, window: {} })
    const { pageLoaders, serverDetailLoader, preloadPage } = module.exports
    expect(serverDetailLoader.peek()).toBeUndefined()
    await preloadPage("servers")
    expect(pageLoaders.servers.peek()).toBeDefined()
    expect(serverDetailLoader.peek()).toBeDefined()
    const Page = preloadedPage(serverDetailLoader)
    const server = { id: "fixture" }
    const element = Page({ server, onBack() {} })
    expect(element.type).toBe(serverDetailLoader.peek().default)
    expect(element.props.server).toBe(server)
    await preloadPage("servers")
    expect(imported.sort()).toEqual(["./server-detail-page", "./servers-page"])
  })

  test("Карточка сервера использует подготовленный модуль, а не холодный lazy", () => {
    expect(read("components/launcher/launcher.tsx")).toMatch(/ServerDetailPage = preloadedPage\(serverDetailLoader\)/)
    const loaders = read("components/launcher/page-loaders.ts")
    expect(loaders).toMatch(/export const serverDetailLoader = createPageLoader/)
    expect(loaders).toMatch(/servers: createPageLoader\([\s\S]*?Promise\.all\([\s\S]*?serverDetailLoader\(\)/)
  })
})

describe("Удалённая проверка версии загрузчика", () => {
  test("Обычное сканирование контента больше не собирает требования для удалённого отчёта", () => {
    expect(read("electrobun/main/builds/content-resolver.ts")).not.toMatch(/loaderRequirements|rememberLoaderRequirements/)
  })
  for (const file of [
    "components/launcher/instance/instance-content-tab.tsx", "electrobun/main/mods.ts", "electrobun/preload.ts",
    "packages/xnlc-types/src/ipc-contracts.ts", "packages/xnlc-types/src/index.ts", "src/electrobun.d.ts",
    "packages/xnlc-agent/src/tools.ts", "packages/xnlc-agent/src/prompt-text.ts", "packages/xnlc-agent/src/launcher-ipc-catalog.ts",
  ]) test(`Проверка недоступна: ${file}`, () => {
    expect(read(file)).not.toMatch(/checkBuildLoaderRequirements|mods:check-loader-requirements|BuildLoaderRequirement|check_loader_requirements|loaderVersionMismatch/)
  })
  test("Нет отдельного сканера и предупреждений в переводах", () => {
    expect(fs.existsSync(new URL("../../electrobun/main/mods-loader-requirements.ts", import.meta.url))).toBe(false)
    for (const lang of ["ru", "en", "de", "es", "pl", "uk"]) {
      expect(read(`src/i18n/locales/${lang}/translation.json`)).not.toMatch(/builds\.loaderVersion(Mismatch|Required|More)|agent\.tools\.check_loader_requirements/)
    }
  })
})
