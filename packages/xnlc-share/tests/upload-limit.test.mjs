import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_FILE_BYTES, ShareSystem, validateExternal } from '../lib/index.js'
import { MemoryFiles, metadata, hash } from './helpers.mjs'

test('лимит одного локального файла — 32 МиБ; причина отказа доступна до загрузки', async () => {
  assert.equal(MAX_FILE_BYTES, 32 * 1024 * 1024)
  const atLimit = new Uint8Array(MAX_FILE_BYTES)
  atLimit.set([0x89, 0x50, 0x4e, 0x47])
  assert.doesNotThrow(() => validateExternal('cover.png', atLimit))
  assert.throws(() => validateExternal('cover.png', new Uint8Array(MAX_FILE_BYTES + 1)), { code: 'FILE_POLICY' })
  const files = new MemoryFiles({ 'config/ok.json': '{}', 'config/unknown.dat': 'unsupported' })
  const list = await files.list()
  files.list = async () => [...list, { path: 'config/large.json', size: MAX_FILE_BYTES + 1, fingerprint: 'large' }]
  const scan = await new ShareSystem({ files, sources: [], remote: {}, hash, now: () => '' }).scan(metadata)
  assert.deepEqual(scan.manifest.entries.map(file => file.path), ['config/ok.json'])
  assert.deepEqual(scan.blockedDetails, [
    { path: 'config/unknown.dat', size: 11, reason: 'format' },
    { path: 'config/large.json', size: MAX_FILE_BYTES + 1, reason: 'size' },
  ])
  assert.equal(files.hashes, 2)
})
