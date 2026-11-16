// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import nodeTest, { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { transformSync } from "esbuild"
import { createInstance } from "i18next"
import { loadReactModule, reactNodes } from "../helpers/react-module.mjs"
import { createRequire } from "node:module"

{
  async function notificationFixture(language = 'ru') {
    const module = { exports: {} }
    const source = fs.readFileSync(new URL('../../src/share-notifications.ts', import.meta.url), 'utf8')
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports })
    const i18n = createInstance()
    const resources = Object.fromEntries([...new Set([language, 'en', 'ru'])].map(locale => [locale, {
      translation: JSON.parse(fs.readFileSync(new URL(`../../src/i18n/locales/${locale}/translation.json`, import.meta.url), 'utf8')),
    }]))
    await i18n.init({ lng: language, fallbackLng: ['en', 'ru'], resources, interpolation: { escapeValue: false } })
    return { i18n, make: event => module.exports.createShareNotification({ requestId: 'one', buildName: 'My pack', done: 0, total: 1, bytes: 0, ...event }, i18n.t.bind(i18n)) }
  }

  function handlers(executeShare, busy = false) {
    const source = fs.readFileSync(new URL('../../electrobun/main/share/index.ts', import.meta.url), 'utf8')
    const registered = new Map(), events = []
    const module = { exports: {} }
    const dependencies = {
      '../../platform/desktop': { rpcRegistry: { handle: (name, handler) => registered.set(name, handler) } },
      './service': { executeShare },
      '../../db': { dbHelpers: { findBuildById: async id => ({ id, name: id === 'installed' ? 'Installed (2)' : 'My pack' }) } },
      '../builds/helpers': { getBuildIntentPath: name => '/intents/' + name },
      '../builds/modpack-install': { isModpackInstalling: () => busy },
    }
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
      module, exports: module.exports, AbortController,
      require: name => { assert.ok(dependencies[name], name); return dependencies[name] },
    })
    module.exports.registerShareHandlers()
    const event = { sender: { id: 1, isDestroyed: () => false, send: ({ payload }) => events.push(payload) } }
    return { events, run: input => registered.get('share:execute')(event, input), cancel: id => registered.get('share:cancel-install')(event, id) }
  }
  describe("share-notifications", () => {
    test('Share: изменение сборки во время импорта не доходит до файлового сервиса', async () => {
      const f = handlers(async () => assert.fail('Импорт владеет файлами'), true)
      assert.equal((await f.run({ action: 'apply', buildId: 'pack', requestId: 'busy' })).success, false)
      assert.equal((await f.run({ action: 'installInvite', name: 'Pack', previewId: 'preview', requestId: 'busy-install' })).success, false)
    })

    test('Share: уведомление сообщает действие и имя сборки на всех этапах', async () => {
      const f = handlers(async (_input, progress) => { progress({ stage: 'upload', done: 1, total: 2, bytes: 10 }); return {} })
      assert.equal((await f.run({ action: 'publish', buildId: 'pack', requestId: 'one' })).success, true)
      assert.deepEqual(f.events.map(event => event.stage), ['start', 'upload', 'done'])
      for (const event of f.events) {
        assert.equal(event.action, 'publish')
        assert.equal(event.buildName, 'My pack')
        assert.equal(event.buildId, 'pack')
        assert.equal(event.requestId, 'one')
      }
    })

    test('Share: установка сообщает выбранное, затем фактическое имя без потери buildId', async () => {
      const f = handlers(async () => ({ buildId: 'installed' }))
      await f.run({ action: 'installInvite', name: 'Installed', previewId: 'preview', requestId: 'two' })
      assert.equal(f.events[0].buildName, 'Installed')
      assert.equal(f.events.at(-1).buildName, 'Installed (2)')
      assert.equal(f.events.at(-1).buildId, 'installed')
    })

    test('Share: ошибка передаёт безопасный код причины, а не токены и сырой ответ сервера', async () => {
      const f = handlers(async () => { throw Object.assign(new Error('Secret server response'), { code: 'PREVIEW' }) })
      const result = await f.run({ action: 'apply', buildId: 'pack', requestId: 'three' })
      assert.equal(result.success, false)
      assert.equal(f.events.at(-1).stage, 'error')
      assert.equal(f.events.at(-1).errorCode, 'PREVIEW')
      assert.equal(JSON.stringify(f.events).includes('Secret server response'), false)
    })

    test('Share: отмена закрывает прогресс отдельным терминальным событием', async () => {
      let started, release
      const ready = new Promise(resolve => { started = resolve })
      const pending = new Promise(resolve => { release = resolve })
      const f = handlers(async (_input, _progress, signal) => { started(); await pending; signal.throwIfAborted(); return {} })
      const task = f.run({ action: 'publish', buildId: 'pack', requestId: 'four' })
      await ready
      assert.equal(f.cancel('four'), true)
      release()
      assert.equal((await task).error.code, 'CANCELLED')
      assert.equal(f.events.at(-1).stage, 'cancelled')
      assert.equal(f.events.some(event => event.stage === 'error' || event.stage === 'done'), false)
    })

    test('Share: чтение статуса не создаёт уведомления об успешной операции', async () => {
      const f = handlers(async () => ({}))
      await f.run({ action: 'status', buildId: 'pack', requestId: 'status' })
      assert.equal(f.events.length, 0)
    })

    test('Share: для каждого действия есть отдельный понятный результат на всех языках', async () => {
      for (const language of ['ru', 'en', 'de', 'es', 'pl', 'uk']) {
        const { make } = await notificationFixture(language)
        const titles = new Set()
        for (const action of ['publish', 'push', 'apply', 'restoreApply', 'installInvite']) {
          const result = make({ action, stage: 'done' })
          assert.equal(result.kind, 'success')
          assert.equal(result.source, 'share')
          assert.equal(result.itemName, 'My pack')
          assert.equal(result.busy, false)
          assert.equal(result.progress, null)
          assert.doesNotMatch(result.title + result.message, /share\.|Операция Share|Share operation/)
          titles.add(result.title)
        }
        assert.equal(titles.size, 5, language)
      }
    })

    test('Share: прогресс округлён, ограничен и не притворяется процентом без общего размера', async () => {
      const { make } = await notificationFixture()
      assert.equal(make({ action: 'publish', stage: 'upload', done: 1, total: 3 }).progress, 33)
      assert.equal(make({ action: 'apply', stage: 'download', done: 4, total: 3 }).progress, 100)
      assert.equal(make({ action: 'apply', stage: 'download', done: -1, total: 3 }).progress, 0)
      for (const stage of ['start', 'index', 'unknown']) {
        const result = make({ action: 'apply', stage })
        assert.equal(result.busy, true)
        assert.equal(result.progress, null)
        assert.doesNotMatch(result.message, /share\./)
      }
      assert.equal(make({ action: 'apply', stage: 'download', total: 0 }).progress, null)
    })

    test('Share: причина ошибки переведена, неизвестный код заменён понятным текстом', async () => {
      const { make, i18n } = await notificationFixture()
      const failed = make({ action: 'publish', stage: 'error', errorCode: 'PREVIEW' })
      assert.equal(failed.kind, 'error')
      assert.equal(failed.message, i18n.t('share.errors.PREVIEW'))
      assert.match(failed.title, /опубликовать/)
      const unknown = make({ action: 'apply', stage: 'error', errorCode: 'PRIVATE_SERVER_ERROR' })
      assert.doesNotMatch(unknown.message, /share\.|PRIVATE_SERVER_ERROR/)
    })

    test('Share: отмена не выглядит ошибкой, а фоновые чтения не засоряют панель', async () => {
      const { make } = await notificationFixture()
      const cancelled = make({ action: 'publish', stage: 'cancelled' })
      assert.equal(cancelled.kind, 'info')
      assert.equal(cancelled.busy, false)
      assert.equal(cancelled.progress, null)
      assert.match(cancelled.message, /отмен/i)
      assert.equal(make({ action: 'scan', stage: 'scan' }), null)
      assert.equal(make({ action: 'status', stage: 'done' }), null)
      assert.equal(make({ stage: 'done' }), null)
      assert.equal(make({ action: 'publish', stage: 'done', requestId: undefined }), null)
    })

    test('Share: прогресс и завершение обновляют одну запись, подписка снимается', async () => {
      const { make } = await notificationFixture()
      const source = fs.readFileSync(new URL('../../src/ActivityCenterContext.tsx', import.meta.url), 'utf8')
      const statement = source.match(/useEffect\(\(\) => window\.electrobunAPI\?\.onShareProgress\([\s\S]*?\]\)/)?.[0]
      assert.ok(statement)
      let listener, cleanup, unsubscribed = false
      const items = new Map()
      vm.runInNewContext(transformSync(statement, { loader: 'tsx' }).code, {
        useEffect: setup => { cleanup = setup() },
        window: { electrobunAPI: { onShareProgress: callback => { listener = callback; return () => { unsubscribed = true } } } },
        createShareNotification: event => make(event), i18n: { t() {} },
        upsertLiveNotification: (key, item) => items.set(key, item),
        removeLiveNotification: key => items.delete(key),
        pushNotification: () => assert.fail('Завершение не должно создавать вторую запись'),
      })
      listener({ action: 'publish', requestId: 'one', stage: 'upload', done: 1, total: 2 })
      listener({ action: 'publish', requestId: 'one', stage: 'done' })
      assert.equal(items.size, 1)
      assert.equal(items.get('share:one').kind, 'success')
      listener({ action: 'apply', requestId: 'two', stage: 'cancelled' })
      assert.equal(items.size, 2)
      assert.equal(items.get('share:two').kind, 'info')
      cleanup()
      assert.equal(unsubscribed, true)
    })
  })
}

{
  const test = nodeTest
  const { SharePublishTabs } = loadReactModule(new URL('../../components/launcher/instance/shared/share-publish-tabs.tsx', import.meta.url), {
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
  })
  describe("share-publish-tabs", () => {
    for (const shared of [false, true]) test(`переключение вкладок публикации вызывает onChange и обновляет aria-pressed (shared=${shared})`, () => {
      let value = 'changes'
      const props = () => ({ value, shared, onChange: next => { value = next }, changeCount: 2, fileCount: 3 })
      let buttons = reactNodes(SharePublishTabs(props())).filter(node => node.type === 'button')
      assert.equal(buttons.length, 2)
      assert.deepEqual(buttons.map(node => node.props['aria-pressed']), [true, false])
      assert.equal(buttons[1].props.type, 'button')
      buttons[1].props.onClick()
      assert.equal(value, 'files')
      buttons = reactNodes(SharePublishTabs(props())).filter(node => node.type === 'button')
      assert.deepEqual(buttons.map(node => node.props['aria-pressed']), [false, true])
      buttons[0].props.onClick()
      assert.equal(value, 'changes')
    })
  })
}

{
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
  describe("server-export-dialog", () => {
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
  })
}

{
  const require = createRequire(import.meta.url)
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
  describe("export-categories-dialog", () => {
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
  })
}
