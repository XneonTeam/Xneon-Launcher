import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { transformSync } from 'esbuild'

function fixture(callback = () => {}, options = {}) {
  let worker
  class FakeWorker extends EventEmitter {
    constructor() { super(); worker = this }
    terminate() { this.terminated = true; return Promise.resolve(1) }
  }
  const module = { exports: {} }
  const source = fs.readFileSync(new URL('../../electrobun/main/builds/scan-worker-client.ts', import.meta.url), 'utf8')
  const dependencies = {
    '../../platform/resources': { bundledWorker: () => 'scan-worker.js' },
    'worker_threads': { Worker: FakeWorker }, 'node:worker_threads': { Worker: FakeWorker },
  }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, setTimeout, clearTimeout, AbortController, console,
    require: name => { assert.ok(dependencies[name], name); return dependencies[name] },
  })
  const task = module.exports.runJarScanWorker([{ filePath: 'one.jar', size: 1, mtime: 1 }], callback, options)
  return { task, worker }
}
const success = { filePath: 'one.jar', size: 1, mtime: 1, inspection: { sha1: 'a'.repeat(40), metadata: {} } }

test('Scan: error + done(0) не является успехом', async () => {
  const f = fixture()
  f.worker.emit('message', { type: 'error', filePath: 'one.jar', message: 'Unreadable' })
  f.worker.emit('message', { type: 'done', inspected: 0 })
  const result = await f.task
  assert.equal(result.ok, false)
  assert.equal(result.state, 'failed')
  assert.equal(result.processedPaths.length, 0)
  assert.equal(f.worker.terminated, true)
})
test('Scan: callback exception остаётся ошибкой файла и требует fallback', async () => {
  const f = fixture(() => { throw new Error('Consumer failed') })
  f.worker.emit('message', { type: 'chunk', results: [success] })
  f.worker.emit('message', { type: 'done', inspected: 1 })
  const result = await f.task
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Consumer failed/)
})
test('Scan: дубли не применяются, неверный inspected не даёт success', async () => {
  let count = 0
  const f = fixture(() => count++)
  f.worker.emit('message', { type: 'chunk', results: [success, success] })
  f.worker.emit('message', { type: 'done', inspected: 2 })
  assert.equal((await f.task).ok, false)
  assert.equal(count, 1)
})
test('Scan: timeout ждёт terminate и игнорирует поздний chunk', async () => {
  let count = 0
  const f = fixture(() => count++, { timeoutMs: 10 })
  const result = await f.task
  f.worker.emit('message', { type: 'chunk', results: [success] })
  assert.equal(count, 0)
  assert.equal(result.ok, false)
  assert.equal(f.worker.terminated, true)
  assert.equal(f.worker.listenerCount('message'), 0)
})
test('Scan: AbortSignal отменяет реальную задачу, а не только UI', async () => {
  const controller = new AbortController()
  const f = fixture(() => {}, { signal: controller.signal })
  controller.abort()
  assert.equal((await f.task).state, 'cancelled')
  assert.equal(f.worker.terminated, true)
})
test('Scan: malformed chunk и чужие пути не вызывают uncaught exception', async () => {
  for (const message of [{ type: 'chunk', results: null }, { type: 'chunk', results: [{ ...success, filePath: 'other.jar' }] }]) {
    const f = fixture()
    assert.doesNotThrow(() => f.worker.emit('message', message))
    assert.equal((await f.task).ok, false)
  }
})
