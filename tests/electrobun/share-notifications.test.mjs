import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { createInstance } from 'i18next'

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

function handlers(executeShare) {
  const source = fs.readFileSync(new URL('../../electrobun/main/share/index.ts', import.meta.url), 'utf8')
  const registered = new Map(), events = []
  const module = { exports: {} }
  const dependencies = {
    '../../platform/desktop': { rpcRegistry: { handle: (name, handler) => registered.set(name, handler) } },
    './service': { executeShare },
    '../../db': { dbHelpers: { findBuildById: async id => ({ id, name: id === 'installed' ? 'Installed (2)' : 'My pack' }) } },
  }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, AbortController,
    require: name => { assert.ok(dependencies[name], name); return dependencies[name] },
  })
  module.exports.registerShareHandlers()
  const event = { sender: { id: 1, isDestroyed: () => false, send: ({ payload }) => events.push(payload) } }
  return { events, run: input => registered.get('share:execute')(event, input), cancel: id => registered.get('share:cancel-install')(event, id) }
}

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
