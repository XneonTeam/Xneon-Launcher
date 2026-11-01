import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { ShareSystem, emptyRepository, mutateRepository, validateExternal, diff } from '../lib/index.js'
import { MemoryFiles, metadata, hash, text } from './helpers.mjs'
const launchSettings = { javaOverride: false, java: null, memoryMin: '', memoryMax: '', javaArgs: '', windowOverride: false, windowWidth: null, windowHeight: null, account: null }

test('публикация и обновление переносят название, описание, серверы, миры и игровые настройки', async () => {
  let repo = emptyRepository('repo', 'owner')
  const objects = new Map()
  const remote = {
    create: async () => repo.id, get: async () => repo,
    hasObject: async (_id, sha) => objects.has(sha),
    upload: async (_id, sha, bytes) => { objects.set(sha, bytes) },
    download: async (_id, sha) => objects.get(sha),
    mutate: async (_id, command) => { repo = mutateRepository(repo, 'owner', command, '2026-11-01T00:00:00Z'); return repo },
  }
  const files = new MemoryFiles({ 'options.txt': 'renderDistance:12', 'servers.dat': Uint8Array.of(10, 0, 0, 0), 'saves/World/level.dat': gzipSync(Uint8Array.of(10, 0, 0, 0)), 'saves/World/region/r.0.0.mca': new Uint8Array(8192), 'saves/World/session.lock': 'lock' })
  const settings = { ...launchSettings, serverOverride: true, server: 'play.example.org', serverPort: '25565', group: 'Friends', preLaunchCommand: 'echo before', postLaunchCommand: 'echo after', wrapperCommand: '', customEnv: 'PACK_MODE=fast' }
  const system = new ShareSystem({ files, sources: [], remote, hash, now: () => '2026-11-01T00:00:00Z' })
  const initial = await system.scan({ ...metadata, launchSettings: settings })
  assert.deepEqual(initial.blocked, [])
  assert.equal(initial.manifest.entries.length, 4)
  const first = await system.publish(initial.manifest, 'owner')
  const receiver = new MemoryFiles()
  const client = new ShareSystem({ files: receiver, sources: [], remote, hash, now: () => '' })
  const installed = await client.preview(repo.id, 'main', null, await client.observe(metadata))
  await client.apply(repo.id, installed)
  for (const entry of initial.manifest.entries) assert.deepEqual(receiver.data.get(entry.path), files.data.get(entry.path))
  files.data.set('servers.dat', Uint8Array.of(10, 0, 0, 1))
  files.data.set('saves/World/level.dat', gzipSync(Uint8Array.of(10, 0, 0, 1)))
  files.data.set('options.txt', text('renderDistance:20'))
  const next = await system.scan({ ...metadata, name: 'New name', description: 'New description', launchSettings: { ...settings, server: 'new.example.org' } })
  const published = await system.push(repo.id, 'main', first.commit.id, next.manifest, 'owner', 'Update instance')
  assert.ok(diff(initial.manifest, published.commit.snapshot.manifest).some(change => change.path === '@instance/name'))
  const update = await client.preview(repo.id, 'main', first.commit.id, await client.observe(installed.manifest.instance, installed.manifest))
  assert.equal(update.conflicts.length, 0)
  assert.equal(update.manifest.instance.name, 'New name')
  assert.equal(update.manifest.instance.description, 'New description')
  assert.equal(update.manifest.instance.launchSettings.server, 'new.example.org')
  await client.apply(repo.id, update)
  for (const entry of next.manifest.entries) assert.deepEqual(receiver.data.get(entry.path), files.data.get(entry.path))
  assert.throws(() => validateExternal('saves/World/payload.dat', Uint8Array.of(0x4d, 0x5a, 0, 0)), { code: 'FILE_POLICY' })
  assert.throws(() => validateExternal('saves/World/payload.exe', text('binary')), { code: 'FILE_POLICY' })
})
