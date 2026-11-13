import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import vm from 'node:vm'
import crypto from 'node:crypto'
import * as streams from 'node:stream'
import * as streamPromises from 'node:stream/promises'
import * as nativeFs from 'node:fs'
import * as zlib from 'node:zlib'
import { transformSync } from 'esbuild'
import { createStreamingZip } from '../../electrobun/main/cloud/streaming-zip.ts'

test('ZIP: потоковый архив читается текущим импортом, включая Unicode и метаданные', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-zip-test-'))
  try {
    const source = path.join(dir, 'source'); await fs.writeFile(source, Buffer.alloc(2 * 1024 * 1024, 123))
    const target = path.join(dir, 'result.zip'), events = []
    await createStreamingZip(target, [{ name: 'mods/Тест.jar', filePath: source }, { name: '.xneon-name', data: Buffer.from('Имя') }], { onProgress: event => events.push(event) })
    const zip = new AdmZip(await fs.readFile(target))
    assert.deepEqual(zip.readFile('mods/Тест.jar'), await fs.readFile(source))
    assert.equal(zip.readAsText('.xneon-name'), 'Имя')
    assert.equal(zip.test(), true)
    assert.equal(events.at(-1).stage, 'done')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
test('ZIP: отмена не публикует частичный архив и не трогает чужие файлы', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-zip-test-'))
  try {
    const controller = new AbortController(), source = path.join(dir, 'source'), target = path.join(dir, 'result.zip')
    await fs.writeFile(source, Buffer.alloc(16 * 1024 * 1024, 1))
    await assert.rejects(createStreamingZip(target, [{ name: 'mods/a.jar', filePath: source }], { signal: controller.signal, onProgress: event => { if (event.stage === 'compress') controller.abort() } }))
    await assert.rejects(fs.access(target))
    assert.deepEqual((await fs.readdir(dir)).sort(), ['source'])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
test('ZIP: пустой экспорт, небезопасный путь и ошибка записи не дают success', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-zip-test-'))
  try {
    await assert.rejects(createStreamingZip(path.join(dir, 'empty.zip'), []))
    await assert.rejects(createStreamingZip(path.join(dir, 'bad.zip'), [{ name: '../escape', data: Buffer.from('a') }]))
    await assert.rejects(createStreamingZip(dir, [{ name: 'a', data: Buffer.from('a') }]))
    assert.deepEqual(await fs.readdir(dir), [])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
test('ZIP: ENOSPC/EACCES при write закрывают handle и удаляют только partial', async () => {
  const source = await fs.readFile('electrobun/main/cloud/streaming-zip.ts', 'utf8')
  for (const code of ['ENOSPC', 'EACCES']) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-write-test-')), module = { exports: {} }
    let closed = false
    const dependencies = {
      'node:fs/promises': { ...fs, open: async (...args) => {
        const actual = await fs.open(...args)
        return { write: async () => { throw Object.assign(new Error(code), { code }) }, close: async () => { closed = true; await actual.close() }, sync: () => actual.sync(), stat: () => actual.stat() }
      } },
      'node:fs': nativeFs, 'node:path': path, 'node:crypto': crypto, 'node:stream': streams, 'node:stream/promises': streamPromises, 'node:zlib': zlib,
    }
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports, Buffer, require: name => { assert.ok(dependencies[name], name); return dependencies[name] } })
    try {
      await fs.writeFile(path.join(dir, 'unrelated'), 'keep')
      await assert.rejects(module.exports.createStreamingZip(path.join(dir, 'result.zip'), [{ name: 'payload', data: Buffer.from('test') }]), new RegExp(code))
      assert.equal(closed, true); assert.deepEqual(await fs.readdir(dir), ['unrelated'])
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  }
})
