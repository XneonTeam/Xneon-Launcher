import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createShareServer } from '../server.mjs'
import { ShareApiClient, ShareSystem } from '../../../packages/xnlc-share/lib/index.js'
import { MemoryFiles, metadata, hash } from '../../../packages/xnlc-share/tests/helpers.mjs'

test('изменение ветки не переписывает историю, ACL и ссылки; push пишет только новый commit', async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'xnlc-share-incremental-'))
  const service = await createShareServer({ directory, bootstrap: [{ user: 'alice', token: 'a'.repeat(43) }] })
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const api = new ShareApiClient('http://127.0.0.1:' + service.server.address().port, async () => 'a'.repeat(43), fetch)
  const files = new MemoryFiles({ 'config/test.json': '{"value":1}' })
  const system = new ShareSystem({ files, remote: api, sources: [], hash, now: () => new Date().toISOString() })
  const initial = await system.publish((await system.scan(metadata)).manifest, 'alice')
  const id = initial.repository.id
  service.db.exec('CREATE TABLE writes (name TEXT, operation TEXT)')
  for (const table of ['commits', 'manifest_entries', 'object_references', 'repository_members']) for (const operation of ['INSERT', 'DELETE']) {
    service.db.exec(`CREATE TRIGGER watch_${table}_${operation} AFTER ${operation} ON ${table} BEGIN INSERT INTO writes VALUES ('${table}','${operation}'); END`)
  }
  const references = service.db.prepare('SELECT * FROM object_references ORDER BY owner_id').all()
  await system.command(id, { action: 'protect', name: 'main', protected: false })
  assert.deepEqual(service.db.prepare('SELECT * FROM writes').all(), [])
  assert.deepEqual(service.db.prepare('SELECT * FROM object_references ORDER BY owner_id').all(), references)
  files.data.set('config/test.json', new TextEncoder().encode('{"value":2}'))
  await system.push(id, 'main', initial.commit.id, (await system.scan(metadata)).manifest, 'alice', 'Changed')
  assert.equal(service.db.prepare("SELECT count(*) AS n FROM writes WHERE name='commits' AND operation='INSERT'").get().n, 1)
  assert.equal(service.db.prepare("SELECT count(*) AS n FROM writes WHERE operation='DELETE'").get().n, 0)
  const restored = await api.get(id)
  assert.equal(Object.keys(restored.commits).length, 2)
  assert.equal(restored.members.alice, 'owner')
  assert.ok(restored.commits[initial.commit.id])
  await service.gc()
  assert.ok(await api.download(id, initial.commit.snapshot.manifest.entries[0].sha256))
})
