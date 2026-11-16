import test from 'node:test'
import assert from 'node:assert/strict'
import { ShareRequestQueue, readLimitedBody } from '../worker/request-queue.mjs'

test('медленное тело не блокирует метаданные; одновременно готовится только одно тело', async () => {
  const queue = new ShareRequestQueue()
  const gate = Promise.withResolvers(), started = Promise.withResolvers()
  const calls = []
  const slow = queue.dispatch({ body: true }, async () => { calls.push('reading'); started.resolve(); await gate.promise; return 'upload' }, value => calls.push(value))
  await started.promise
  const next = queue.dispatch({ body: true }, async () => { calls.push('reading-next'); return 'next' }, value => calls.push(value))
  await queue.dispatch({ body: null }, async () => 'metadata', value => calls.push(value))
  assert.deepEqual(calls, ['reading', 'metadata'])
  gate.resolve()
  await Promise.all([slow, next])
  assert.deepEqual(calls, ['reading', 'metadata', 'upload', 'reading-next', 'next'])
})

test('ошибка тела освобождает очередь; ограничение размера отменяет поток', async () => {
  const queue = new ShareRequestQueue()
  let cancelled = false
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)) }, cancel() { cancelled = true } })
  await assert.rejects(queue.dispatch({ body }, request => readLimitedBody(request, 8), () => assert.fail()), { code: 'SIZE' })
  assert.equal(cancelled, true)
  assert.equal(await queue.dispatch({ body: true }, async () => 'ok', value => value), 'ok')
})

test('отмена прерывает ожидающее чтение тела', async () => {
  const controller = new AbortController()
  const request = { body: new ReadableStream(), signal: controller.signal }
  const reading = readLimitedBody(request, 16)
  controller.abort(new Error('cancelled'))
  await assert.rejects(reading, /cancelled/)
})
