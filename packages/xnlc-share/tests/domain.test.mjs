import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest, manifestHash, normalizePath, validateExternal, merge, diff, createCommit, emptyRepository, mutateRepository, ShareSystem, ModrinthSource, CurseForgeSource } from '../lib/index.js'
import { hash, metadata, MemoryFiles, external, manifest, text } from './helpers.mjs'

test('конфиги JSON5 и JEXL разрешены как текст; бинарное содержимое и исполняемые файлы отклоняются', async () => {
  for (const file of ['config/PaginatedAdvancements.json5', 'config/crash_assistant/scripts/log_analysis/blame-mods.jexl', 'config/modpack_defaults/config/crash_assistant/scripts/log_analysis/blame-mods.jexl']) {
    validateExternal(file, text('// комментарий\n{ enabled: true, }'))
    assert.throws(() => validateExternal(file, Uint8Array.of(0xff, 0xfe)), /UTF-8/)
    assert.throws(() => validateExternal(file, Uint8Array.of(0x4d, 0x5a, 0, 0)), /Executable/)
    assert.throws(() => validateExternal(file, text('value\0data')), /Binary/)
  }
  assert.throws(() => validateExternal('config/script.js', text('doSomething()')), /excluded/)
  const files = new MemoryFiles({ 'config/PaginatedAdvancements.json5': '{ enabled: true, }', 'config/crash_assistant/scripts/log_analysis/blame-mods.jexl': 'true' })
  const scan = await new ShareSystem({ files, sources: [], remote: {}, hash, now: () => '' }).scan(metadata)
  assert.equal(scan.manifest.entries.length, 2)
  assert.deepEqual(scan.blocked, [])
})

test('иконка сборки сохраняется в манифесте и переносится из старой публикации через merge', async () => {
  const old = manifest()
  const originalHash = await manifestHash(old, hash)
  for (const icon of ['data:image/png;base64,iVBORw0KGgo=', 'https://cdn.modrinth.com/data/test/icon.png', './launcher-icons/xneon_logo_01.svg']) {
    const incoming = validateManifest(JSON.parse(JSON.stringify(manifest([], { ...metadata, icon }))))
    assert.equal(incoming.instance.icon, icon)
    assert.notEqual(await manifestHash(incoming, hash), originalHash)
    assert.equal(diff(old, incoming).find(entry => entry.path === '@instance/icon')?.type, 'modified')
    const merged = merge(old, old, incoming)
    assert.equal(merged.manifest.instance.icon, icon)
    assert.equal(merged.conflicts.length, 0)
    const cleared = manifest([], { ...metadata, icon: '' })
    assert.equal(merge(incoming, incoming, cleared).manifest.instance.icon, '')
  }
  assert.equal(await manifestHash(validateManifest(old), hash), originalHash)
  assert.equal(Object.hasOwn(validateManifest(old).instance, 'icon'), false)
  for (const icon of ['file:///C:/private.png', 'javascript:alert(1)', '../private.png']) {
    assert.throws(() => validateManifest(manifest([], { ...metadata, icon })), /icon/)
  }
})

test('обложка и описание применяются при обновлении, конфликт обложки требует выбора', () => {
  const base = manifest()
  const incoming = manifest([], { ...metadata, description: 'Новое описание', coverImage: 'https://cdn.modrinth.com/new.png' })
  const preview = merge(base, base, incoming)
  assert.equal(preview.manifest.instance.description, incoming.instance.description)
  assert.equal(preview.manifest.instance.coverImage, incoming.instance.coverImage)
  const current = manifest([], { ...metadata, coverImage: 'https://cdn.modrinth.com/local.png' })
  assert.equal(merge(base, current, incoming).conflicts[0].path, '@instance/coverImage')
  assert.equal(merge(base, current, incoming, { '@instance/coverImage': 'incoming' }).manifest.instance.coverImage, incoming.instance.coverImage)
})

test('manifest: deterministic serialization and schema rejection', async () => {
  const a = await external('config/a.json', '{}'), b = await external('config/b.toml', 'ok=true')
  assert.equal(await manifestHash(manifest([a, b]), hash), await manifestHash(manifest([b, a]), hash))
  assert.throws(() => validateManifest({ ...manifest(), schemaVersion: 99 }), /schema version/)
  assert.throws(() => validateManifest(manifest([a, { ...a, path: 'CONFIG/A.JSON' }])) , /duplicate/)
  assert.throws(() => validateManifest(manifest([{ ...a, sha256: 'x' }])), /metadata/)
})
test('paths: traversal, Windows devices, alternate data streams and collisions', async () => {
  for (const p of ['../a', '/a', 'C:\\x', 'config/../../x', 'config/a:exe', 'NUL.json', 'config/a.', 'config//a', 'config/a?b']) assert.throws(() => normalizePath(p))
  assert.equal(normalizePath('config\\test.json'), 'config/test.json')
  const a = await external('config/a.json', '{}')
  assert.throws(() => validateManifest(manifest([a, { ...a, path: 'config/a.json/b.json' }])) , /collision/)
})
test('external policy inspects bytes and excludes credentials', () => {
  assert.throws(() => validateExternal('config/harmless.txt', Uint8Array.of(0x4d, 0x5a, 0, 0)), /Executable/)
  assert.throws(() => validateExternal('config/token.json', text('{}')), /excluded/)
  assert.throws(() => validateExternal('config/file.txt', Uint8Array.of(0xff, 0xfe)), /UTF-8/)
  validateExternal('config/test.json', text('{}'))
})
test('diff: rename, source/version, enabled and metadata changes', async () => {
  const entry = await external('config/old.json', '{}')
  assert.equal(diff(manifest([entry]), manifest([{ ...entry, path: 'config/new.json' }]))[0].type, 'renamed')
  const d = diff(manifest([entry]), manifest([{ ...entry, enabled: false }], { ...metadata, gameVersion: '1.22' }))
  assert.deepEqual(d[0].changes, ['enabled']); assert.equal(d[1].path, '@instance/gameVersion')
})
test('diff: a new filename for the same catalog project is one update', async () => {
  const { object, ...oldFile } = await external('mods/fabric-api-0.164.jar', 'old')
  const { object: nextObject, ...newFile } = await external('mods/fabric-api-0.165.jar', 'new')
  const before = { ...oldFile, kind: 'mod', source: { provider: 'modrinth', projectId: 'fabric-api', versionId: 'old', fileId: 'old' } }
  const after = { ...newFile, kind: 'mod', source: { ...before.source, versionId: 'new', fileId: 'new' } }
  const changes = diff(manifest([before]), manifest([after]))
  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'modified')
  assert.equal(changes[0].before.path, before.path)
  assert.equal(changes[0].after.path, after.path)
  assert.ok(changes[0].changes.includes('source'))
  assert.ok(changes[0].changes.includes('path'))
  for (const kind of ['resourcepack', 'shader']) {
    assert.equal(diff(manifest([{ ...before, kind }]), manifest([{ ...after, kind }]))[0].type, 'modified')
  }
  assert.deepEqual(diff(manifest([before]), manifest([{ ...after, source: { ...after.source, projectId: 'another-project' } }])).map(change => change.type), ['removed', 'added'])
  assert.equal(diff(manifest([before]), manifest([after, { ...after, path: 'mods/another-version.jar' }])).length, 3)
  assert.equal(diff(manifest([before]), manifest([before, after]))[0].type, 'added')
})

test('merge: local overlay, delete/modify conflicts, metadata and explicit resolution', async () => {
  const a = await external('config/a.json', '1'), local = await external('config/local.json', '2'), incoming = await external('config/a.json', '3')
  const base = manifest([a]), current = manifest([local]), remote = manifest([incoming])
  const result = merge(base, current, remote)
  assert.equal(result.conflicts.length, 1); assert.equal(result.conflicts[0].path, a.path)
  const resolved = merge(base, current, remote, { [a.path]: 'incoming' })
  assert.equal(resolved.conflicts.length, 0); assert.equal(resolved.manifest.entries.length, 2)
  assert.equal(merge(base, { ...base, instance: { ...metadata, loader: 'forge' } }, { ...base, instance: { ...metadata, loader: 'neoforge' } }).conflicts[0].path, '@instance/loader')
})
test('initial commit, immutable history, branch concurrency and permissions', async () => {
  const c = await createCommit({ repositoryId: 'r', author: 'a', message: 'Initial commit', manifest: manifest(), parents: [], now: '2026-01-01T00:00:00Z' }, hash)
  const r = mutateRepository(emptyRepository('r', 'a'), 'a', { action: 'push', branch: 'main', expected: null, commit: c }, c.createdAt)
  assert.equal(c.type, 'INITIAL'); assert.deepEqual(c.parents, []); assert.equal(r.branches.main.head, c.id)
  assert.equal(Object.keys(emptyRepository('r', 'a').commits).length, 0)
  assert.throws(() => mutateRepository(r, 'b', { action: 'branch', name: 'x', from: c.id }, c.createdAt), /membership/)
  assert.throws(() => mutateRepository(r, 'a', { action: 'push', branch: 'main', expected: null, commit: c }, c.createdAt), /HEAD/)
  const branch = mutateRepository(r, 'a', { action: 'branch', name: 'feature', from: c.id }, c.createdAt)
  assert.equal(branch.branches.feature.head, c.id)
  assert.throws(() => mutateRepository(branch, 'a', { action: 'deleteBranch', name: 'main' }, c.createdAt), /default/)
})
test('scanner: hash cache, Local-Only, exact managed identity; unavailable source is not republished', async () => {
  const files = new MemoryFiles({ 'mods/a.jar': 'known', 'config/test.json': '{}', 'logs/log.txt': 'private' })
  const known = await files.hash('mods/a.jar')
  const source = { id: 'catalog', identify: async h => h.sha512 === known.sha512 ? { size: 5, sha512: known.sha512, source: { provider: 'catalog', projectId: 'p', versionId: 'v', fileId: 'f' } } : null }
  const s = new ShareSystem({ files, hash, sources: [source], remote: {}, now: () => '' })
  const scan = await s.scan(metadata); assert.ok(scan.manifest.entries[1].source); assert.equal(scan.localOnly.length, 1)
  const count = files.hashes; await s.scan(metadata); assert.equal(files.hashes, count)
  files.data.set('config/test.json', text('{"new":true}')); await s.scan(metadata); assert.equal(files.hashes, count + 1)
  source.identify = async () => { throw new Error('SOURCE_UNAVAILABLE') }
  await assert.rejects(s.scan(metadata), /SOURCE_UNAVAILABLE/)
})
test('source adapters: exact hashes, forbidden URL, unavailable version and CurseForge restrictions', async () => {
  const h = 'a'.repeat(128), reference = { provider: 'modrinth', projectId: 'p', versionId: 'v', fileId: h }
  const data = { id: 'v', project_id: 'p', files: [{ filename: 'a.jar', size: 10, url: 'https://cdn.modrinth.com/a.jar', hashes: { sha512: h } }], dependencies: [] }
  const mr = new ModrinthSource(async () => Response.json(data))
  assert.equal((await mr.resolve(reference)).sha512, h)
  await assert.rejects(mr.resolve({ ...reference, fileId: 'b'.repeat(128) }), /unavailable/)
  data.files[0].url = 'http://127.0.0.1/secret'; await assert.rejects(mr.resolve(reference), /Untrusted/)
  await assert.rejects(new ModrinthSource(async () => new Response('', { status: 503 })).identify({ sha512: h }), /503/)
  const cf = new CurseForgeSource(async () => Response.json({ data: { id: 2, modId: 1, downloadUrl: null } }), 'key', hash)
  await assert.rejects(cf.resolve({ provider: 'curseforge', projectId: '1', versionId: '2', fileId: '2' }), /restricted/)
})

test('scanner: повторно использует проверку неизменённых файлов и заново проверяет изменения', async () => {
  const files = new MemoryFiles({ 'config/a.json': '{}', 'config/b.txt': 'safe' })
  const system = new ShareSystem({ files, hash, sources: [], remote: {}, now: () => '' })
  await system.scan(metadata)
  assert.equal(files.reads, 2)
  await system.scan(metadata)
  assert.equal(files.reads, 2)
  files.data.set('config/a.json', text('new value'))
  await system.scan(metadata)
  assert.equal(files.reads, 3)
  await system.scan(metadata, { force: true })
  assert.equal(files.reads, 5)
  files.data.set('config/b.txt', Uint8Array.of(0x4d, 0x5a, 0, 0))
  const scan = await system.scan(metadata)
  assert.deepEqual(scan.blocked, ['config/b.txt'])
  assert.equal(files.reads, 6)
})
