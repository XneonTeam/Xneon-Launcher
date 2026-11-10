import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { stripTypeScriptTypes } from "./transpile.mjs"

const source = await fs.readFile(new URL('../../electrobun/main/mc-server-handlers.ts', import.meta.url), 'utf8')
const begin = source.indexOf('  async function startMcServer(')
const end = source.indexOf('  registerMcServerHandler("mc-server:stop"', begin)
assert.ok(begin >= 0 && end > begin)
const code = stripTypeScriptTypes(source.slice(begin, end))

function setup(prepareJava, prepareJar = async () => 'server.jar') {
  const events = [], progress = new Map(), token = { cancelled: false }
  let installs = 0, starts = 0
  const row = { id: 'server', gameVersion: '26.3', javaPath: 'auto' }
  const context = {
    dbHelpers: { getMcServer: async () => row, getSetting: async () => undefined, updateMcServer: async () => {} },
    getServerDir: () => '/server', withServerFileLock: async (_id, work) => work(),
    path: { join: (...parts) => parts.join('/') }, loadServerProperties: () => ({}),
    mirroredFieldsFromProperties: () => ({}), rowToInfo: value => value,
    installProgress: progress, sendToRenderer: (...args) => events.push(args),
    ensureServerJava: (...args) => prepareJava(token, ...args),
    ensureServerJar: async (...args) => { installs++; return prepareJar(token, ...args) },
    serverManager: { start: () => { starts++ }, appendConsoleLine() {}, clearInstallLogs() {} },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  return { run: () => context.startMcServer('server', token), events, progress, counts: () => ({ installs, starts }) }
}

test('отмена подготовки Java не начинает установку ядра и не возвращает прогресс', async () => {
  const fixture = setup(async (token, _version, report) => {
    token.cancelled = true
    report(50, 25)
    return { path: 'java' }
  })
  await fixture.run()
  assert.deepEqual(fixture.counts(), { installs: 0, starts: 0 })
  assert.equal(fixture.progress.size, 0)
  assert.equal(fixture.events.filter(([channel]) => channel === 'mc-server:download-progress').length, 1)
  assert.equal(fixture.events.at(-1)[1].state.status, 'stopped')
})

test('ошибка Java снимает сохранённый прогресс и отправляет ошибку', async () => {
  const fixture = setup(async () => { throw new Error('runtime unavailable') })
  await assert.rejects(fixture.run(), /runtime unavailable/)
  assert.equal(fixture.progress.size, 0)
  assert.equal(fixture.events.at(-1)[1].progress.phase, 'error')
  assert.deepEqual(fixture.counts(), { installs: 0, starts: 0 })
})

test('отмена во время установки ядра не запускает сервер и не возвращает прогресс', async () => {
  const fixture = setup(async () => ({ path: 'java' }), async (token, ...args) => {
    token.cancelled = true
    args[5]({ phase: 'downloading', percent: 70 })
    throw new Error('installation interrupted')
  })
  await fixture.run()
  assert.deepEqual(fixture.counts(), { installs: 1, starts: 0 })
  assert.equal(fixture.progress.size, 0)
  assert.equal(fixture.events.at(-1)[1].state.status, 'stopped')
})
