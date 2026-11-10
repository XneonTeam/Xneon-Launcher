import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import http from 'node:http'
import { createRequire } from 'node:module'
import downloads from '../../dist-electrobun-tests/main/content-downloads.js'

const require = createRequire(new URL('../../dist-electrobun-tests/main/builds/helpers.js', import.meta.url))
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-cancel-content-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const module = { exports: {} }
  const mocks = {
    '../../db': { dbHelpers: {} }, '../paths': { getLauncherDataRoot: () => root },
    '../shared-game-cache': {}, '../jar-cache': { getCachedJarPath: async () => null },
    '@xnlc/core/retry': { fetchWithRetry: fetch }, '../errors': {},
  }
  const code = await fs.readFile(new URL('../../dist-electrobun-tests/main/builds/helpers.js', import.meta.url), 'utf8')
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), console, setTimeout, Buffer, process })
  let started, disconnected
  const receiving = new Promise(resolve => { started = resolve })
  const closed = new Promise(resolve => { disconnected = resolve })
  const server = http.createServer((request, response) => {
    if (request.url === '/ok') { response.end('complete mod'); return }
    response.writeHead(200, { 'content-length': 1024 * 1024 })
    const timer = setInterval(() => { response.write(Buffer.alloc(1024)); started() }, 10)
    response.on('close', () => { clearInterval(timer); disconnected() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { api: module.exports, receiving, closed, url: `http://127.0.0.1:${server.address().port}` }
}

for (const [kind, folder, name] of [['mod', 'mods', 'test.jar'], ['resourcepack', 'resourcepacks', 'test.zip'], ['shader', 'shaderpacks', 'test.zip']]) {
  test(`отмена ${kind}: соединение закрывается, файл не устанавливается, повтор работает`, { timeout: 5000 }, async t => {
    const { api, receiving, closed, url } = await fixture(t)
    let id
    const task = downloads.runContentDownload(1, (signal, requestId) => {
      id = requestId
      return api.saveRemoteContentToIntent('test', kind, url + '/slow', name, signal, requestId)
    })
    const rejected = assert.rejects(task, /CONTENT_DOWNLOAD_CANCELLED/)
    await receiving
    assert.equal(downloads.cancelContentDownload(2, id), false)
    assert.equal(downloads.cancelContentDownload(1, id), true)
    await rejected
    await closed
    assert.equal(downloads.cancelContentDownload(1, id), false)
    const intent = await api.ensureBuildIntentDir('test')
    await assert.rejects(fs.stat(path.join(intent, folder, name)), { code: 'ENOENT' })
    const file = await downloads.runContentDownload(1, (signal, requestId) => api.saveRemoteContentToIntent('test', kind, url + '/ok', name, signal, requestId))
    assert.equal(await fs.readFile(file, 'utf8'), 'complete mod')
  })
}

test('отмена обновления сохраняет уже установленный мод и не останавливает другую загрузку', { timeout: 5000 }, async t => {
  const { api, receiving, url } = await fixture(t)
  const intent = await api.ensureBuildIntentDir('test')
  const directory = path.join(intent, 'mods')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'test.jar'), 'installed version')
  let id
  const task = downloads.runContentDownload(7, (signal, requestId) => { id = requestId; return api.saveRemoteContentToIntent('test', 'mod', url + '/slow', 'test.jar', signal, requestId) })
  const rejected = assert.rejects(task, /CONTENT_DOWNLOAD_CANCELLED/)
  await receiving
  const parallel = downloads.runContentDownload(7, (signal, requestId) => api.saveRemoteContentToIntent('test', 'mod', url + '/ok', 'other.jar', signal, requestId))
  downloads.cancelContentDownload(7, id)
  await rejected
  assert.equal(await fs.readFile(path.join(directory, 'test.jar'), 'utf8'), 'installed version')
  assert.equal(await fs.readFile(await parallel, 'utf8'), 'complete mod')
})
