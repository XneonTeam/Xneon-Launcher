import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { inspectExternalObject, ShareError, MAX_FILE_BYTES } from '../../../packages/xnlc-share/lib/index.js'
import { createShareServer } from '../server.mjs'
import { ShareApiClient, ShareSystem, createCommit, merge, diff } from '../../../packages/xnlc-share/lib/index.js'
import { hash, text, metadata, MemoryFiles, external, manifest } from '../../../packages/xnlc-share/tests/helpers.mjs'

const tokens = { alice: 'a'.repeat(43), bob: 'b'.repeat(43), mallory: 'm'.repeat(43) }
async function environment(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-share-'))
  const service = await createShareServer({ directory, bootstrap: Object.entries(tokens).map(([user, token]) => ({ user, token })) })
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + service.server.address().port
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const request = (user, route, body, method = body === undefined ? 'GET' : 'POST') => fetch(base + '/v1' + route, { method, headers: { Authorization: 'Bearer ' + tokens[user], 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { ...service, directory, base, request, client: user => new ShareApiClient(base, async () => tokens[user], fetch) }
}
const system = (files, remote, sources = []) => new ShareSystem({ files, remote, hash, sources, now: () => new Date().toISOString() })

test('прогресс публикации обновляется внутри файла, учитывает дубликаты и неизменённые файлы', async t => {
  const env = await environment(t), remote = env.client('alice'), events = []
  const contents = 'x'.repeat(256 * 1024)
  const files = new MemoryFiles({ 'config/a.txt': contents, 'config/copy.txt': contents, 'config/b.json': '{}' })
  const s = new ShareSystem({ files, remote, hash, sources: [], now: () => new Date().toISOString(), progress: event => events.push(event) })
  const first = await s.publish((await s.scan(metadata)).manifest, 'alice')
  const uploads = events.filter(event => event.stage === 'upload')
  assert.ok(uploads.length >= 5)
  assert.ok(uploads.some(event => event.done > 0 && event.done < 1))
  assert.equal(events.filter(event => event.stage === 'verify').at(-1).done, 3)
  assert.equal(events.filter(event => event.stage === 'verify').at(-1).total, 3)
  assert.equal(uploads.at(-1).bytes, Buffer.byteLength(contents) + 2)
  assert.equal(events.at(-1).stage, 'commit')
  assert.deepEqual(await remote.download(first.repository.id, await hash.digest(text(contents))), text(contents))
  files.data.set('config/b.json', text('{"v":2}'))
  events.length = 0
  await s.push(first.repository.id, 'main', first.commit.id, (await s.scan(metadata)).manifest, 'alice', 'One changed file')
  const last = events.filter(event => event.stage === 'verify').at(-1)
  assert.equal(last.done, last.total)
  assert.equal(last.bytes, 7)
  assert.equal(events.at(-1).stage, 'commit')
})

test('конфиги со скриншота: JSON5 и оба JEXL публикуются, скачиваются и устанавливаются без изменения байтов', async t => {
  const env = await environment(t), remote = env.client('alice')
  const contents = {
    'config/crash_assistant/scripts/log_analysis/blame-mods.jexl': '// expression\ntrue',
    'config/modpack_defaults/config/crash_assistant/scripts/log_analysis/blame-mods.jexl': '// expression\ntrue',
    'config/modpack_defaults/config/PaginatedAdvancements.json5': '// configuration\n{ enabled: true, }',
  }
  const source = new MemoryFiles(contents), publisher = system(source, remote)
  const scanned = await publisher.scan(metadata)
  assert.deepEqual(scanned.blocked, [])
  const published = await publisher.publish(scanned.manifest, 'alice')
  const destination = new MemoryFiles(), installer = system(destination, remote)
  const preview = await installer.preview(published.repository.id, 'main', null, manifest())
  await installer.apply(published.repository.id, preview)
  for (const [file, value] of Object.entries(contents)) assert.deepEqual(await destination.read(file), text(value))
})

test('сервер выдаёт разрешение на файл до 32 МиБ и отклоняет превышение до отправки содержимого', async t => {
  const env = await environment(t), id = await env.client('alice').create()
  const route = `/repositories/${id}/objects/${'a'.repeat(64)}/ticket`
  assert.equal((await env.request('alice', route, { size: MAX_FILE_BYTES })).status, 200)
  const rejected = await env.request('alice', route, { size: MAX_FILE_BYTES + 1 })
  assert.equal(rejected.status, 413)
  assert.equal((await rejected.json()).error.code, 'SIZE')
  assert.equal(env.db.prepare('SELECT COUNT(*) AS count FROM uploads WHERE repository_id=?').get(id).count, 1)
})

test('приглашения генерируются как уникальные коды, код открывает состав и выдаёт выбранную роль', async t => {
  const env = await environment(t), owner = env.client('alice')
  const s = system(new MemoryFiles(), owner)
  const published = await s.publish((await s.scan(metadata)).manifest, 'alice'), id = published.repository.id
  const codes = new Set()
  for (const role of ['viewer', 'editor']) {
    const invitation = await (await env.request('alice', `/repositories/${id}/invites`, { role, maxUses: 1 })).json()
    assert.match(invitation.token, /^XNLC-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/)
    assert.equal(codes.has(invitation.token), false)
    codes.add(invitation.token)
    const preview = await (await env.request('bob', `/invites/${invitation.token}`)).json()
    assert.equal(preview.repositoryId, id)
    assert.equal(preview.manifest.instance.name, metadata.name)
    assert.equal((await env.request('bob', `/invites/${invitation.token}/accept`, {})).status, 200)
    assert.equal((await owner.get(id)).members.bob, role)
    assert.equal((await env.request('bob', `/invites/${invitation.token}/accept`, {})).status, 400)
  }
})

test('метаданные: публикация, приглашение и обновление сохраняют описание и обе картинки', async t => {
  const env = await environment(t), remote = env.client('alice')
  const s = system(new MemoryFiles(), remote)
  const firstMetadata = { ...metadata, description: 'Описание сборки', icon: 'data:image/png;base64,iVBORw0KGgo=', coverImage: 'https://cdn.modrinth.com/cover.png' }
  const first = await s.publish((await s.scan(firstMetadata)).manifest, 'alice')
  const id = first.repository.id
  const invitation = await (await env.request('alice', `/repositories/${id}/invites`, { role: 'viewer', maxUses: 1 })).json()
  const preview = await (await env.request('bob', `/invites/${invitation.token}`)).json()
  assert.deepEqual(preview.manifest.instance, firstMetadata)
  const nextMetadata = { ...firstMetadata, description: 'Обновлённое описание', icon: './launcher-icons/xneon_logo_02.svg', coverImage: '' }
  const next = await s.push(id, 'main', first.commit.id, (await s.scan(nextMetadata)).manifest, 'alice', 'Metadata update')
  const repo = await remote.get(id)
  assert.deepEqual(repo.commits[next.commit.id].snapshot.manifest.instance, nextMetadata)
})

test('история ветки наследует коммиты источника, исключает его будущие изменения и сохраняется после миграции', async t => {
  const env = await environment(t), remote = env.client('alice')
  const files = new MemoryFiles({ 'config/a.json': '{"v":0}' }), s = system(files, remote)
  const root = await s.publish((await s.scan(metadata)).manifest, 'alice'), id = root.repository.id
  files.data.set('config/a.json', text('{"v":1}'))
  const base = await s.push(id, 'main', root.commit.id, (await s.scan(metadata)).manifest, 'alice', 'Branch point')
  await s.command(id, { action: 'branch', name: 'feature', from: base.commit.id })
  files.data.set('config/feature.json', text('{}'))
  const feature = await s.push(id, 'feature', base.commit.id, (await s.scan(metadata)).manifest, 'alice', 'Feature only')
  files.data.delete('config/feature.json'); files.data.set('config/main.json', text('{}'))
  const main = await s.push(id, 'main', base.commit.id, (await s.scan(metadata)).manifest, 'alice', 'Main only')
  const repo = await remote.get(id)
  assert.equal(repo.branches.feature.base, base.commit.id)
  const history = async branch => (await env.request('alice', `/repositories/${id}/commits?branch=${branch}`)).json()
  assert.deepEqual((await history('feature')).map(commit => commit.id), [feature.commit.id, base.commit.id, root.commit.id])
  assert.deepEqual((await history('main')).map(commit => commit.id), [main.commit.id, base.commit.id, root.commit.id])
  assert.equal((await env.request('alice', `/repositories/${id}/commits?branch=missing`)).status, 400)
  await assert.rejects(s.restore(id, 'feature', feature.commit.id, main.commit.id, 'alice', 'Wrong branch'), { code: 'HISTORY' })
  const switchPreview = await s.preview(id, 'feature', main.commit.id, main.commit.snapshot.manifest)
  assert.equal(switchPreview.diff.length, 1)
  assert.equal(switchPreview.diff[0].type, 'renamed')
  assert.equal(switchPreview.diff[0].before.path, 'config/main.json')
  assert.equal(switchPreview.diff[0].after.path, 'config/feature.json')
  await s.apply(id, switchPreview)
  assert.equal(files.data.has('config/main.json'), false)
  assert.equal(files.data.has('config/feature.json'), true)
  const actual = await s.observe(metadata, feature.commit.snapshot.manifest)
  assert.deepEqual(diff(feature.commit.snapshot.manifest, actual), [])
  env.db.exec('ALTER TABLE branches DROP COLUMN base_commit')
  const migrated = await createShareServer({ directory: env.directory })
  try {
    assert.equal((await remote.get(id)).branches.feature.base, base.commit.id)
    assert.equal(env.db.prepare('SELECT base_commit FROM branches WHERE repository_id=? AND name=?').get(id, 'feature').base_commit, base.commit.id)
  } finally { await migrated.close() }
})

test('delete publication: creator only, server data removed, local copies and objects shared with other publications survive', async t => {
  const env = await environment(t), owner = env.client('alice'), participant = env.client('bob')
  const files = new MemoryFiles({ 'config/shared.json': '{"shared":true}', 'config/private.json': '{"private":1}' }), author = system(files, owner)
  const first = await author.publish((await author.scan(metadata)).manifest, 'alice'), id = first.repository.id
  files.data.set('config/private.json', text('{"private":2}'))
  const second = await author.push(id, 'main', first.commit.id, (await author.scan(metadata)).manifest, 'alice', 'Update')
  await owner.mutate(id, { action: 'member', user: 'bob', role: 'editor' })
  await owner.mutate(id, { action: 'member', user: 'mallory', role: 'viewer' })
  await owner.mutate(id, { action: 'branch', name: 'extra', from: second.commit.id })
  env.db.prepare('INSERT INTO tags VALUES (?,?,?)').run(id, 'legacy-tag', second.commit.id)
  const invitation = await (await env.request('alice', `/repositories/${id}/invites`, { role: 'viewer', maxUses: 1 })).json()
  const localCopy = new MemoryFiles(), receiver = system(localCopy, participant)
  await receiver.apply(id, await receiver.preview(id, 'main', null, manifest()))
  const originalData = [...files.data].map(([name, bytes]) => [name, [...bytes]])
  const participantData = [...localCopy.data].map(([name, bytes]) => [name, [...bytes]])
  const unrelated = system(new MemoryFiles({ 'config/shared.json': '{"shared":true}' }), owner)
  const other = await unrelated.publish((await unrelated.scan(metadata)).manifest, 'alice')
  const sharedHash = other.commit.snapshot.manifest.entries[0].sha256
  assert.equal((await env.request('bob', `/repositories/${id}`, undefined, 'DELETE')).status, 403)
  assert.equal((await env.request('mallory', `/repositories/${id}`, undefined, 'DELETE')).status, 403)
  const response = await env.request('alice', `/repositories/${id}`, undefined, 'DELETE')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { deleted: true })
  for (const table of ['commits', 'branches', 'tags', 'repository_members', 'invitations', 'object_references', 'uploads', 'events']) {
    assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE repository_id=?`).get(id).n, 0)
  }
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM repositories WHERE id=?').get(id).n, 0)
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE id=?').get(second.commit.snapshot.id).n, 0)
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM manifests WHERE hash=?').get(second.commit.manifestHash).n, 0)
  await assert.rejects(participant.get(id), { code: 'PUBLICATION_DELETED' })
  await assert.rejects(owner.get(id), { code: 'PUBLICATION_DELETED' })
  assert.equal((await env.request('bob', `/invites/${invitation.token}`)).status, 400)
  assert.deepEqual([...files.data].map(([name, bytes]) => [name, [...bytes]]), originalData)
  assert.deepEqual([...localCopy.data].map(([name, bytes]) => [name, [...bytes]]), participantData)
  assert.equal((await owner.get(other.repository.id)).branches.main.head, other.commit.id)
  assert.deepEqual([...await owner.download(other.repository.id, sharedHash)], [...text('{"shared":true}')])
  const privateHashes = [first, second].map(result => result.commit.snapshot.manifest.entries.find(entry => entry.path === 'config/private.json').sha256)
  for (const privateHash of privateHashes) await assert.rejects(fs.stat(path.join(env.directory, 'objects', privateHash)), { code: 'ENOENT' })
})

test('roles: creator manages members, editor publishes to main, reader only reads, removal revokes access', async t => {
  const env = await environment(t), owner = env.client('alice'), editor = env.client('bob'), reader = env.client('mallory')
  const files = new MemoryFiles({ 'config/a.json': '{}' }), author = system(files, owner)
  const first = await author.publish((await author.scan(metadata)).manifest, 'alice'), id = first.repository.id
  const invite = async (user, role) => {
    const response = await env.request('alice', `/repositories/${id}/invites`, { role, maxUses: 1 })
    assert.equal(response.status, 200)
    const link = await response.json()
    assert.equal((await env.request(user, `/invites/${link.token}/accept`, {})).status, 200)
  }
  await invite('bob', 'editor'); await invite('mallory', 'viewer')
  assert.equal((await reader.get(id)).members.mallory, 'viewer')
  const editorFiles = new MemoryFiles({ 'config/a.json': '{"editor":true}' }), editing = system(editorFiles, editor)
  const changed = await editing.push(id, 'main', first.commit.id, (await editing.scan(metadata)).manifest, 'bob', 'Editor update')
  assert.equal(changed.repository.branches.main.head, changed.commit.id)
  assert.equal((await env.request('bob', `/repositories/${id}/invites`, { role: 'editor', maxUses: 1 })).status, 403)
  await assert.rejects(editor.mutate(id, { action: 'member', user: 'mallory', role: 'editor' }), { code: 'FORBIDDEN' })
  await assert.rejects(editor.mutate(id, { action: 'member', user: 'mallory', role: null }), { code: 'FORBIDDEN' })
  await assert.rejects(reader.mutate(id, { action: 'branch', name: 'forbidden', from: changed.commit.id }), { code: 'FORBIDDEN' })
  await assert.rejects(reader.upload(id, await hash.digest(text('reader')), text('reader')), { code: 'FORBIDDEN' })
  await assert.rejects(owner.mutate(id, { action: 'member', user: 'alice', role: null }), { code: 'FORBIDDEN' })
  await assert.rejects(owner.mutate(id, { action: 'member', user: 'bob', role: 'owner' }), { code: 'FORBIDDEN' })
  await assert.rejects(owner.mutate(id, { action: 'member', user: 'bob', role: 'maintainer' }), { code: 'FORBIDDEN' })
  assert.equal((await env.request('alice', `/repositories/${id}/invites`, { role: 'contributor', maxUses: 1 })).status, 400)
  await owner.mutate(id, { action: 'member', user: 'bob', role: 'viewer' })
  await assert.rejects(editor.mutate(id, { action: 'branch', name: 'after-demotion', from: changed.commit.id }), { code: 'FORBIDDEN' })
  await owner.mutate(id, { action: 'member', user: 'bob', role: null })
  await assert.rejects(editor.get(id), { code: 'FORBIDDEN' })
  assert.deepEqual((await owner.get(id)).members, { alice: 'owner', mallory: 'viewer' })
})

test('existing member: creator can promote and demote directly or by a new invitation; creator role is preserved', async t => {
  const env = await environment(t), owner = env.client('alice'), bob = env.client('bob')
  const s = system(new MemoryFiles({ 'config/a.json': '{}' }), owner)
  const published = await s.publish((await s.scan(metadata)).manifest, 'alice'), id = published.repository.id
  await owner.mutate(id, { action: 'member', user: 'bob', role: 'viewer' })
  await owner.mutate(id, { action: 'member', user: 'bob', role: 'editor' })
  assert.equal((await bob.get(id)).members.bob, 'editor')
  await owner.mutate(id, { action: 'member', user: 'bob', role: 'viewer' })
  assert.equal((await bob.get(id)).members.bob, 'viewer')
  const accept = async (user, role) => {
    const invitation = await (await env.request('alice', `/repositories/${id}/invites`, { role, maxUses: 1 })).json()
    assert.equal((await env.request(user, `/invites/${invitation.token}/accept`, {})).status, 200)
    assert.equal((await env.request(user, `/invites/${invitation.token}/accept`, {})).status, 400)
  }
  await accept('bob', 'editor')
  assert.equal((await bob.get(id)).members.bob, 'editor')
  await accept('bob', 'viewer')
  assert.equal((await bob.get(id)).members.bob, 'viewer')
  await accept('alice', 'viewer')
  assert.equal((await owner.get(id)).members.alice, 'owner')
})

test('roles migration preserves legacy members and invitation links as editor', async t => {
  const env = await environment(t), owner = env.client('alice')
  const s = system(new MemoryFiles({ 'config/a.json': '{}' }), owner)
  const published = await s.publish((await s.scan(metadata)).manifest, 'alice'), id = published.repository.id
  await owner.mutate(id, { action: 'member', user: 'bob', role: 'editor' })
  const invitation = await (await env.request('alice', `/repositories/${id}/invites`, { role: 'editor', maxUses: 1 })).json()
  env.db.prepare("UPDATE repository_members SET role='maintainer' WHERE repository_id=? AND user_id='bob'").run(id)
  env.db.prepare("UPDATE invitations SET role='contributor' WHERE repository_id=?").run(id)
  const migrated = await createShareServer({ directory: env.directory })
  try {
    assert.equal((await owner.get(id)).members.bob, 'editor')
    assert.equal((await env.request('mallory', `/invites/${invitation.token}/accept`, {})).status, 200)
    assert.equal((await owner.get(id)).members.mallory, 'editor')
  } finally { await migrated.close() }
})

test('incremental publication: one changed mod checks only that mod and does not query unchanged objects', async t => {
  const env = await environment(t)
  const requests = []
  const measuredFetch = (url, init) => { requests.push({ url, method: init?.method }); return fetch(url, init) }
  const remote = new ShareApiClient(env.base, async () => tokens.alice, measuredFetch)
  const files = new MemoryFiles(Object.fromEntries(Array.from({ length: 114 }, (_, i) => [`config/${i}.json`, JSON.stringify({ i })])))
  const byHash = new Map(), byId = new Map()
  async function addMod(name, value) {
    const filePath = 'mods/' + name + '.jar'
    files.data.set(filePath, text(value))
    const hashes = await files.hash(filePath)
    const resolved = { size: value.length, sha512: hashes.sha512, source: { provider: 'fixture', projectId: name, versionId: value, fileId: value } }
    byHash.set(hashes.sha512, resolved); byId.set(value, resolved)
  }
  for (let i = 0; i < 46; i++) await addMod('mod-' + i, 'old-' + i)
  const checked = []
  const source = { id: 'fixture', identify: async h => byHash.get(h.sha512) ?? null, resolve: async reference => { checked.push(reference.fileId); return byId.get(reference.fileId) } }
  const s = system(files, remote, [source])
  const first = await s.publish((await s.scan(metadata)).manifest, 'alice')
  await addMod('mod-0', 'updated-0')
  const update = await s.scan(metadata)
  checked.length = 0; requests.length = 0; files.reads = 0; files.hashes = 0
  const start = performance.now()
  const published = await s.push(first.repository.id, 'main', first.commit.id, update.manifest, 'alice', 'Update one mod')
  const elapsed = Math.round(performance.now() - start)
  assert.deepEqual(checked, ['updated-0'])
  assert.equal(files.hashes, 1)
  assert.equal(files.reads, 0)
  assert.equal(requests.filter(request => request.url.includes('/objects/')).length, 0)
  assert.equal(published.uploadedBytes, 0)
  assert.equal(published.commit.snapshot.manifest.entries.length, 160)
  assert.equal(Object.keys(published.repository.commits).length, 2)
  console.log('SHARE_INCREMENTAL_BENCHMARK ' + JSON.stringify({ fixture: true, managedMods: 46, configs: 114, changedMods: 1, catalogChecks: checked.length, fileHashes: files.hashes, fileReads: files.reads, objectRequests: 0, milliseconds: elapsed }))

  files.data.set('config/0.json', text('{"changed":true}'))
  const configUpdate = await s.scan(metadata)
  checked.length = 0; requests.length = 0; files.reads = 0; files.hashes = 0
  const next = await s.push(first.repository.id, 'main', published.commit.id, configUpdate.manifest, 'alice', 'Update one config')
  assert.equal(checked.length, 0)
  assert.equal(files.reads, 1)
  assert.equal(files.hashes, 0)
  assert.equal(requests.filter(request => request.method === 'PUT').length, 1)
  assert.equal(next.uploadedBytes, text('{"changed":true}').length)
})

test('catalog update with renamed JAR: one change, publication removes old entry, install replaces file', async t => {
  const env = await environment(t), remote = env.client('alice')
  const oldPath = 'mods/fabric-api-old.jar', newPath = 'mods/fabric-api-new.jar'
  const files = new MemoryFiles({ [oldPath]: 'old' })
  const oldHashes = await files.hash(oldPath)
  const bytes = new Map([['old', text('old')], ['new', text('new')]])
  const makeFile = async version => ({ source: { provider: 'fixture', projectId: 'fabric-api', versionId: version, fileId: version }, size: 3, sha512: await hash.digest(bytes.get(version), 'SHA-512') })
  const versions = new Map([['old', await makeFile('old')], ['new', await makeFile('new')]])
  const source = { id: 'fixture', identify: async hashes => [...versions.values()].find(version => version.sha512 === hashes.sha512) ?? null, resolve: async reference => versions.get(reference.versionId), download: async file => bytes.get(file.source.versionId) }
  const author = system(files, remote, [source])
  const initial = await author.publish((await author.scan(metadata)).manifest, 'alice')
  files.data.delete(oldPath); files.data.set(newPath, text('new'))
  const scan = await author.scan(metadata)
  const published = await author.push(initial.repository.id, 'main', initial.commit.id, scan.manifest, 'alice', 'Update Fabric API', { selected: [oldPath, newPath] })
  assert.deepEqual(published.commit.snapshot.manifest.entries.map(entry => entry.path), [newPath])
  const installed = new MemoryFiles({ [oldPath]: 'old' }), receiver = system(installed, remote, [source])
  const preview = await receiver.preview(initial.repository.id, 'main', initial.commit.id, initial.commit.snapshot.manifest)
  assert.equal(preview.diff.length, 1)
  assert.equal(preview.diff[0].type, 'modified')
  assert.equal(preview.expected[oldPath], oldHashes.sha256)
  assert.equal(preview.expected[newPath], null)
  await receiver.apply(initial.repository.id, preview)
  assert.equal(installed.data.has(oldPath), false)
  assert.equal(new TextDecoder().decode(installed.data.get(newPath)), 'new')
})

test('rollback: preview changes nothing, confirmation restores local files and branch while preserving history and local additions', async t => {
  const env = await environment(t), remote = env.client('alice')
  const files = new MemoryFiles({ 'config/a.json': '{"v":1}' }), s = system(files, remote)
  const first = await s.publish((await s.scan(metadata)).manifest, 'alice')
  files.data.set('config/a.json', text('{"v":2}')); files.data.set('config/new.json', text('{}'))
  const second = await s.push(first.repository.id, 'main', first.commit.id, (await s.scan(metadata)).manifest, 'alice', 'Second version')
  files.data.set('config/local.json', text('{"local":true}'))
  const observed = await s.observe(metadata, second.commit.snapshot.manifest)
  const preview = await s.preview(first.repository.id, 'main', second.commit.id, observed, {}, first.commit.id)
  assert.equal(preview.conflicts.length, 0)
  assert.equal((await remote.get(first.repository.id)).branches.main.head, second.commit.id)
  assert.equal(new TextDecoder().decode(files.data.get('config/a.json')), '{"v":2}')
  const restored = await s.restore(first.repository.id, 'main', second.commit.id, first.commit.id, 'alice', 'Return to first version')
  const head = restored.branches.main.head
  await s.apply(first.repository.id, { ...preview, head })
  assert.equal(new TextDecoder().decode(files.data.get('config/a.json')), '{"v":1}')
  assert.equal(files.data.has('config/new.json'), false)
  assert.equal(new TextDecoder().decode(files.data.get('config/local.json')), '{"local":true}')
  assert.equal(restored.commits[head].type, 'REVERT')
  assert.deepEqual(restored.commits[head].snapshot.manifest.entries.map(entry => entry.path), ['config/a.json'])
  assert.ok(restored.commits[first.commit.id]); assert.ok(restored.commits[second.commit.id])
  await assert.rejects(s.restore(first.repository.id, 'main', second.commit.id, first.commit.id, 'alice', 'Stale rollback'), { code: 'NON_FAST_FORWARD' })
})

test('publication: preview blocks nested native archives and excludes runtime artifacts', async t => {
  const env = await environment(t), remote = env.client('alice')
  const inner = new AdmZip()
  inner.addFile('gpu-detect-jni.dll', Buffer.from([0x4d, 0x5a, 0, 0]))
  const outer = new AdmZip()
  outer.addFile('META-INF/jarjar/app.jar', inner.toBuffer())
  const safe = new AdmZip()
  safe.addFile('pack.mcmeta', Buffer.from('{"pack":{"pack_format":15}}'))
  const files = new MemoryFiles({
    'local/crash_assistant/app.jar': outer.toBuffer(),
    'natives/generated.json': '{}',
    'config/tool.jar': outer.toBuffer(),
    'config/options.json': '{}',
    'resourcepacks/test.zip': safe.toBuffer(),
  })
  const inspectExternal = bytes => inspectExternalObject(bytes, data => new AdmZip(Buffer.from(data)).getEntries().map(entry => ({ name: entry.entryName, size: entry.header.size, directory: entry.isDirectory, read: () => entry.getData() })))
  const s = new ShareSystem({ files, remote, hash, sources: [], inspectExternal, now: () => new Date().toISOString() })
  const scan = await s.scan(metadata)
  assert.deepEqual(scan.blocked, ['config/tool.jar'])
  assert.deepEqual(scan.manifest.entries.map(entry => entry.path), ['config/options.json', 'resourcepacks/test.zip'])
  assert.ok(scan.localOnly.includes('local/crash_assistant/app.jar'))
  const published = await s.publish(scan.manifest, 'alice')
  assert.equal(published.repository.branches.main.head, published.commit.id)
  const id = await remote.create()
  await assert.rejects(remote.upload(id, await hash.digest(outer.toBuffer()), outer.toBuffer()), { code: 'FILE_POLICY' })
})

test('publication errors identify the external file rejected by the server', async () => {
  const files = new MemoryFiles({ 'config/test.json': '{}' })
  const remote = { create: async () => 'r', hasObject: async () => false, upload: async () => { throw new ShareError('FILE_POLICY', 'Rejected') } }
  const s = system(files, remote)
  await assert.rejects(s.publish((await s.scan(metadata)).manifest, 'alice'), { code: 'FILE_POLICY', filePath: 'config/test.json' })
})

test('API: auth, transactional initial publication, deduplication, IDOR and concurrent push', async t => {
  const env = await environment(t), client = env.client('alice')
  assert.equal((await fetch(env.base + '/v1/auth/me')).status, 401)
  const files = new MemoryFiles({ 'config/test.json': '{"a":1}' }), s = system(files, client)
  const scan = await s.scan(metadata), initial = await s.publish(scan.manifest, 'alice')
  const id = initial.repository.id
  assert.equal(initial.uploadedBytes, 7); assert.equal(initial.commit.type, 'INITIAL')
  assert.equal(env.db.prepare('SELECT state FROM repositories WHERE id=?').get(id).state, 'published')
  assert.equal((await env.request('bob', '/repositories/' + id)).status, 403)
  assert.equal((await env.request('mallory', `/repositories/${id}/objects/${scan.manifest.entries[0].sha256}`)).status, 403)
  const second = await s.push(id, 'main', initial.commit.id, scan.manifest, 'alice', 'No object changes')
  assert.equal(second.uploadedBytes, 0); assert.equal(second.reusedBytes, 7)
  const commits = await Promise.all(['one','two'].map(message => createCommit({ repositoryId: id, author: 'alice', manifest: scan.manifest, parents: [second.commit], message, now: new Date().toISOString() }, hash)))
  const pushes = await Promise.allSettled(commits.map(commit => client.mutate(id, { action: 'push', branch: 'main', expected: second.commit.id, commit })))
  assert.equal(pushes.filter(p => p.status === 'fulfilled').length, 1)
  assert.equal(pushes.filter(p => p.status === 'rejected')[0].reason.code, 'NON_FAST_FORWARD')
  const replay = pushes.findIndex(p => p.status === 'fulfilled')
  await client.mutate(id, { action: 'push', branch: 'main', expected: second.commit.id, commit: commits[replay] })
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM objects').get().n, 1)
})

test('two users: invitation, install, update conflict, local overlay and stale preview protection', async t => {
  const env = await environment(t), alice = env.client('alice'), bob = env.client('bob')
  const aFiles = new MemoryFiles({ 'config/test.json': '{"v":1}' }), a = system(aFiles, alice)
  const first = await a.publish((await a.scan(metadata)).manifest, 'alice'), id = first.repository.id
  const invitation = await (await env.request('alice', `/repositories/${id}/invites`, { role: 'viewer', maxUses: 1 })).json()
  assert.equal((await env.request('mallory', `/repositories/${id}`)).status, 403)
  assert.equal((await env.request('bob', `/invites/${invitation.token}/accept`, {})).status, 200)
  assert.equal((await env.request('bob', `/invites/${invitation.token}/accept`, {})).status, 400)
  const bFiles = new MemoryFiles(), b = system(bFiles, bob)
  const install = await b.preview(id, 'main', null, manifest())
  assert.equal(install.downloads.objects, 7); await b.apply(id, install)
  assert.equal(new TextDecoder().decode(bFiles.data.get('config/test.json')), '{"v":1}')
  bFiles.data.set('config/local.json', text('{"local":true}'))
  bFiles.data.set('config/test.json', text('{"v":2}'))
  aFiles.data.set('config/test.json', text('{"v":3}'))
  const update = await a.push(id, 'main', first.commit.id, (await a.scan(metadata)).manifest, 'alice', 'Update config')
  const local = (await b.scan(metadata)).manifest
  const conflict = await b.preview(id, 'main', first.commit.id, local)
  assert.equal(conflict.conflicts.length, 1); await assert.rejects(b.apply(id, conflict), /Resolve/)
  const resolved = await b.preview(id, 'main', first.commit.id, local, { 'config/test.json': 'incoming' })
  bFiles.data.set('config/test.json', text('{"late":true}'))
  await assert.rejects(b.apply(id, resolved), /after preview/)
  bFiles.data.set('config/test.json', text('{"v":2}'))
  await b.apply(id, resolved)
  assert.equal(new TextDecoder().decode(bFiles.data.get('config/test.json')), '{"v":3}')
  assert.ok(bFiles.data.has('config/local.json'))
  await assert.rejects(bob.mutate(id, { action: 'branch', name: 'feature', from: update.commit.id }), { code: 'FORBIDDEN' })
})

test('uploads: checksum, executable content, replay and staged visibility', async t => {
  const env = await environment(t), client = env.client('alice'), id = await client.create()
  assert.equal((await env.request('bob', '/repositories/' + id)).status, 403)
  const bytes = text('{}'), h = await hash.digest(bytes)
  await assert.rejects(client.upload(id, h, text('broken')), /checksum/)
  const exe = Uint8Array.of(0x4d, 0x5a, 0, 0)
  await assert.rejects(client.upload(id, await hash.digest(exe), exe), /Executable/)
  await client.upload(id, h, bytes)
  const c = await createCommit({ repositoryId: id, author: 'alice', message: 'Initial commit', manifest: manifest([await external('config/a.json', '{}')]), parents: [], now: new Date().toISOString() }, hash)
  c.id = '0'.repeat(64)
  await assert.rejects(client.mutate(id, { action: 'push', branch: 'main', expected: null, commit: c }), /invalid/)
  assert.equal(env.db.prepare('SELECT state FROM repositories WHERE id=?').get(id).state, 'staging')
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM commits').get().n, 0)
})

test('download integrity: corrupt object does not modify worktree', async t => {
  const env = await environment(t), remote = env.client('alice')
  const a = system(new MemoryFiles({ 'config/a.json': '{}' }), remote)
  const first = await a.publish((await a.scan(metadata)).manifest, 'alice')
  const e = first.commit.snapshot.manifest.entries[0]
  await fs.writeFile(path.join(env.directory, 'objects', e.sha256), 'corrupt')
  const files = new MemoryFiles(), b = system(files, remote)
  const preview = await b.preview(first.repository.id, 'main', null, manifest())
  await assert.rejects(b.apply(first.repository.id, preview), /corrupt/)
  assert.equal(files.data.size, 0)
})

test('metadata-first benchmark: 300 managed files, actual HTTP upload byte counts', async t => {
  const env = await environment(t)
  let jsonBytes = 0, objectBytes = 0
  const measuredFetch = async (url, init) => { if (typeof init?.body === 'string') jsonBytes += Buffer.byteLength(init.body); else if (init?.body instanceof Uint8Array) objectBytes += init.body.length; return fetch(url, init) }
  const remote = new ShareApiClient(env.base, async () => tokens.alice, measuredFetch)
  const files = new MemoryFiles({ 'config/pack.json': '{"difficulty":"hard"}' })
  const byHash = new Map(), byId = new Map()
  for (let i = 0; i < 300; i++) {
    const bytes = new Uint8Array(64 * 1024).fill(i % 251); new DataView(bytes.buffer).setUint32(0, i)
    const p = `mods/mod-${i}.jar`; files.data.set(p, bytes)
    const h = await files.hash(p)
    const file = { source: { provider: 'fixture-catalog', projectId: 'p' + i, versionId: 'v' + i, fileId: 'f' + i }, size: bytes.length, sha512: h.sha512 }
    byHash.set(h.sha512, file); byId.set(file.source.fileId, file)
  }
  const source = { id: 'fixture-catalog', identify: async h => byHash.get(h.sha512) ?? null, resolve: async s => byId.get(s.fileId) }
  const s = system(files, remote, [source]), scan = await s.scan(metadata)
  const result = await s.publish(scan.manifest, 'alice')
  assert.equal(result.commit.snapshot.statistics.managed, 300)
  assert.equal(objectBytes, 21); assert.equal(result.uploadedBytes, objectBytes)
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM objects').get().n, 1)
  assert.ok(jsonBytes + objectBytes < scan.statistics.totalBytes / 100)
  const report = { fixture: true, managedFiles: 300, localBytes: scan.statistics.totalBytes, uploadedObjectBytes: objectBytes, uploadedJsonBodyBytes: jsonBytes, totalRequestBodyBytes: objectBytes + jsonBytes, excludesHttpTlsHeaders: true }
  console.log('SHARE_BENCHMARK ' + JSON.stringify(report))
})
