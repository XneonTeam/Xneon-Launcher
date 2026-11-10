import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModrinthSource, ShareSystem } from '../lib/index.js'
import { hash, metadata, MemoryFiles } from './helpers.mjs'

test('Modrinth: batch lookup, exact identity, positive/negative cache and forced refresh', async () => {
  let calls = 0
  const hashes = Array.from({ length: 165 }, (_, index) => ({ sha512: index.toString(16).padStart(128, '0') }))
  const source = new ModrinthSource(async (url, init) => {
    calls++
    assert.equal(url, 'https://api.modrinth.com/v2/version_files')
    assert.equal(init.method, 'POST')
    const body = JSON.parse(init.body)
    assert.equal(body.algorithm, 'sha512')
    assert.ok(body.hashes.length <= 80)
    return Response.json(Object.fromEntries(body.hashes.slice(1).map(sha512 => [sha512, {
      id: 'v', project_id: 'p', dependencies: [], files: [{ size: 5, url: 'https://cdn.modrinth.com/a.jar', hashes: { sha512 } }],
    }])))
  })
  const first = await source.identifyMany(hashes)
  assert.equal(calls, 3)
  assert.equal(first.filter(Boolean).length, 162)
  assert.equal(first[1].sha512, hashes[1].sha512)
  assert.deepEqual(await source.identifyMany(hashes), first)
  assert.equal(calls, 3)
  await source.identifyMany(hashes, true)
  assert.equal(calls, 6)
})

test('Modrinth: failed lookup is retried; incorrect file hash never identifies content', async () => {
  let calls = 0
  const source = new ModrinthSource(async () => {
    if (++calls === 1) return new Response('', { status: 503 })
    return Response.json({ a: { id: 'v', project_id: 'p', dependencies: [], files: [{ hashes: { sha512: 'other' } }] } })
  })
  await assert.rejects(source.identifyMany([{ sha512: 'a' }]), { code: 'SOURCE_UNAVAILABLE' })
  assert.deepEqual(await source.identifyMany([{ sha512: 'a' }]), [null])
  assert.equal(calls, 2)
})

test('scanner: bounded hashing, one batch, no per-file lookup and unchanged content cache', async () => {
  const files = new MemoryFiles(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`mods/${i}.jar`, 'known'])))
  let active = 0, peak = 0, batches = 0, singles = 0
  const original = files.hash.bind(files)
  files.hash = async path => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 1))
    try { return await original(path) } finally { active-- }
  }
  const source = {
    id: 'catalog', identify: async () => { singles++; throw Error('Unexpected per-file request') },
    identifyMany: async hashes => { batches++; return hashes.map(h => ({ size: 5, sha512: h.sha512, source: { provider: 'catalog', projectId: 'p', versionId: 'v', fileId: 'f' } })) },
  }
  const s = new ShareSystem({ files, hash, sources: [source], remote: {}, now: () => '' })
  const first = await s.scan(metadata)
  assert.equal(first.manifest.entries.length, 12)
  assert.ok(peak > 1 && peak <= 4)
  assert.equal(files.hashes, 12)
  await s.scan(metadata)
  assert.equal(files.hashes, 12)
  await s.scan(metadata, { force: true })
  assert.equal(files.hashes, 24)
  assert.equal(batches, 3)
  assert.equal(singles, 0)
  files.data.set('mods/0.jar', new TextEncoder().encode('newer'))
  const changed = await s.scan(metadata)
  assert.equal(files.hashes, 25)
  assert.notEqual(changed.manifest.entries[0].sha256, first.manifest.entries[0].sha256)
})

test('публикация использует проверку каталога из сканирования и замечает изменение после него', async () => {
  const files = new MemoryFiles({ 'mods/a.jar': 'known' })
  const known = await files.hash('mods/a.jar')
  const reference = { provider: 'catalog', projectId: 'p', versionId: 'v', fileId: 'f' }
  let resolutions = 0
  const source = { id: 'catalog', identify: async () => ({ size: 5, sha512: known.sha512, source: reference }), resolve: async () => { resolutions++; return { size: 5, sha512: known.sha512, source: reference } } }
  const remote = { create: async () => 'repo', mutate: async () => ({}) }
  const events = []
  const system = new ShareSystem({ files, hash, sources: [source], remote, now: () => '', progress: event => events.push(event) })
  const scan = await system.scan(metadata)
  const count = files.hashes
  events.length = 0
  await system.publish(scan.manifest, 'alice')
  assert.equal(resolutions, 0)
  assert.equal(files.hashes, count)
  assert.equal(events.some(event => event.stage === 'verify'), false)
  files.data.set('mods/a.jar', new TextEncoder().encode('other'))
  await assert.rejects(system.publish(scan.manifest, 'alice'), { code: 'INTEGRITY' })
  assert.equal(resolutions, 1)
})
