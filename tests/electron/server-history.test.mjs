import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import historyModule from '../../dist-electron/main/remote-servers/history.js'
import { createHash } from 'node:crypto'
import { stable } from '@xnlc/share'
const actor = { id: 'owner', name: 'Owner' }, editor = { id: 'editor', name: 'Editor' }

test('закрытие истории дожидается текущей операции и отклоняет новые команды', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-history-dispose-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'server'), store = path.join(directory, 'history')
  await fs.mkdir(root); await fs.writeFile(path.join(root, 'server.properties'), 'motd=keep')
  let release, started
  const reading = new Promise(resolve => { started = resolve }), resume = new Promise(resolve => { release = resolve })
  const engine = new historyModule.ServerHistory({ root, store, isRunning: () => false, settings: async () => { started(); await resume; return {} }, saveSettings: async () => {} })
  const scan = engine.run({ action: 'scan' }, actor)
  await reading
  const closing = engine.dispose()
  await assert.rejects(engine.run({ action: 'get' }, actor), { code: 'REMOTE_DELETED' })
  release(); await scan; await closing
  await assert.rejects(engine.run({ action: 'commit', message: 'late', fingerprint: 'old' }, actor), { code: 'REMOTE_DELETED' })
  assert.equal(await fs.readFile(path.join(root, 'server.properties'), 'utf8'), 'motd=keep')
})

test('история сервера: реальные файлы, наследование веток, PR, откат и сохранение истории', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-server-history-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'server'), store = path.join(directory, 'history')
  await fs.mkdir(path.join(root, 'config'), { recursive: true })
  const file = path.join(root, 'config', 'test.json')
  await fs.writeFile(file, '{"value":1}')
  let settings = { name: 'Friends', xmx: 1024, relayEnabled: 1 }, running = false, rejectSettings = false
  const ports = { root, store, settings: async () => ({ ...settings }), saveSettings: async value => { if (rejectSettings) { rejectSettings = false; throw new Error('SQLite fixture failure') } settings = { ...value } }, isRunning: () => running }
  let engine = new historyModule.ServerHistory(ports)
  const run = command => engine.run(command, actor)
  const commit = async (message, author = actor) => { const scan = await run({ action: 'scan' }); return engine.run({ action: 'commit', message, fingerprint: scan.fingerprint }, author) }
  const checkout = async branch => { const preview = await run({ action: 'preview', branch }); return run({ action: 'apply', previewId: preview.previewId }) }
  const initial = await commit('Initial server')
  const first = initial.view.head
  await run({ action: 'branch', name: 'feature', source: 'main' })
  assert.deepEqual((await run({ action: 'get', branch: 'feature' })).view.commits.map(commit => commit.id), [first])
  await checkout('feature')
  settings.relayEnabled = 0
  await fs.writeFile(file, '{"value":2}')
  const changed = await commit('Change config', editor)
  const relayChange = (await run({ action: 'details', commit: changed.view.head })).changes.find(change => change.path === '@settings/relayEnabled')
  assert.equal(relayChange.beforeValue, 1)
  assert.equal(relayChange.afterValue, 0)
  assert.equal(changed.view.commits[0].author.name, 'Editor')
  assert.equal((await run({ action: 'get', branch: 'main' })).view.commits.length, 1)
  await checkout('main')
  assert.equal(settings.relayEnabled, 1)
  assert.equal(await fs.readFile(file, 'utf8'), '{"value":1}')
  settings.xmx = 2048
  await fs.writeFile(path.join(root, 'config', 'another.json'), '{}')
  await commit('Change memory and add file')
  const created = await run({ action: 'pullRequest', source: 'feature', target: 'main', title: 'Merge config', description: 'Review server config' })
  const pr = created.view.pullRequests[0]
  assert.equal(pr.description, 'Review server config')
  const commented = await engine.run({ action: 'commentPullRequest', id: pr.id, text: 'Checked config' }, editor)
  assert.equal(commented.view.pullRequests[0].comments[0].author.id, editor.id)
  assert.equal(commented.view.pullRequests[0].comments[0].text, 'Checked config')
  running = true
  const review = await run({ action: 'review', id: pr.id })
  assert.equal(review.incoming, changed.view.head)
  assert.equal(review.changes.find(change => change.path === 'config/test.json').type, 'modified')
  running = false
  await assert.rejects(run({ action: 'preview', pullRequest: pr.id, expected: 'outdated-head', sourceHead: review.incoming }), { code: 'REMOTE_CHANGED' })
  const merging = await run({ action: 'preview', pullRequest: pr.id, expected: review.current, sourceHead: review.incoming })
  assert.deepEqual(merging.conflicts, [])
  const merged = await run({ action: 'apply', previewId: merging.previewId })
  assert.equal(merged.view.pullRequests[0].state, 'merged')
  assert.equal(merged.view.pullRequests[0].comments.length, 1)
  assert.deepEqual((await run({ action: 'review', id: pr.id })).changes, review.changes)
  assert.equal(merged.view.pullRequests[0].merge.targetHead, review.current)
  assert.equal(merged.view.pullRequests[0].merge.commit, merged.view.head)
  assert.equal(merged.view.commits[0].parents.length, 2)
  assert.ok(merged.view.commits.some(commit => commit.id === changed.view.head))
  assert.equal(settings.xmx, 2048)
  assert.equal(settings.relayEnabled, 0)
  assert.equal(await fs.readFile(file, 'utf8'), '{"value":2}')
  const restore = await run({ action: 'preview', commit: first })
  const restored = await run({ action: 'apply', previewId: restore.previewId })
  assert.equal(await fs.readFile(file, 'utf8'), '{"value":1}')
  await assert.rejects(fs.stat(path.join(root, 'config', 'another.json')), { code: 'ENOENT' })
  assert.equal(settings.xmx, 1024)
  assert.equal(settings.relayEnabled, 1)
  assert.deepEqual((await run({ action: 'review', id: pr.id })).changes, review.changes)
  assert.ok(restored.view.commits.some(commit => commit.id === merged.view.head))
  const contents = await run({ action: 'file', commit: changed.view.head, path: 'config/test.json' })
  assert.equal(contents.beforeText, '{"value":1}'); assert.equal(contents.afterText, '{"value":2}')
  const stale = await run({ action: 'preview', branch: 'feature' })
  await fs.writeFile(file, '{"value":3}')
  await assert.rejects(run({ action: 'apply', previewId: stale.previewId }), { code: 'LOCAL_CHANGED' })
  assert.equal(await fs.readFile(file, 'utf8'), '{"value":3}')
  await assert.rejects(run({ action: 'preview', branch: 'feature' }), { code: 'DIRTY' })
  await fs.writeFile(file, '{"value":1}')
  const rollback = await run({ action: 'preview', branch: 'feature' })
  rejectSettings = true
  await assert.rejects(run({ action: 'apply', previewId: rollback.previewId }), /SQLite fixture failure/)
  assert.equal(await fs.readFile(file, 'utf8'), '{"value":1}')
  assert.equal((await run({ action: 'get' })).view.currentBranch, 'main')
  running = true
  await assert.rejects(run({ action: 'scan' }), { code: 'RUNNING' })
  assert.equal((await run({ action: 'get' })).view.head, restored.view.head)
  running = false
  engine = new historyModule.ServerHistory(ports)
  assert.equal((await run({ action: 'get' })).view.head, restored.view.head)
  assert.deepEqual((await run({ action: 'review', id: pr.id })).changes, review.changes)
  const savedRepository = JSON.parse(await fs.readFile(path.join(store, 'repository.json'), 'utf8'))
  delete savedRepository.pullRequests[0].merge
  await fs.writeFile(path.join(store, 'repository.json'), JSON.stringify(savedRepository))
  engine = new historyModule.ServerHistory(ports)
  assert.deepEqual((await run({ action: 'review', id: pr.id })).changes, review.changes)
})

test('конфликты слияния требуют выбора; независимая ветка сохраняет состав, чужой preview не применяется', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-history-conflict-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'server'), store = path.join(directory, 'history')
  await fs.mkdir(root); await fs.writeFile(path.join(root, 'server.properties'), 'motd=initial')
  const engine = new historyModule.ServerHistory({ root, store, settings: async () => ({}), saveSettings: async () => {}, isRunning: () => false })
  const run = command => engine.run(command, actor)
  const commit = async message => { const scan = await run({ action: 'scan' }); return run({ action: 'commit', message, fingerprint: scan.fingerprint }) }
  const checkout = async branch => { const preview = await run({ action: 'preview', branch }); return run({ action: 'apply', previewId: preview.previewId }) }
  await commit('Initial')
  await run({ action: 'branch', name: 'feature', source: 'main' })
  await run({ action: 'branch', name: 'independent', source: 'main', independent: true })
  assert.equal((await run({ action: 'get', branch: 'independent' })).view.commits.length, 1)
  await checkout('independent')
  assert.equal(await fs.readFile(path.join(root, 'server.properties'), 'utf8'), 'motd=initial')
  await checkout('feature')
  await fs.writeFile(path.join(root, 'server.properties'), 'motd=feature'); await commit('Feature')
  await checkout('main')
  await fs.writeFile(path.join(root, 'server.properties'), 'motd=main'); await commit('Main')
  const created = await run({ action: 'pullRequest', title: 'Conflicting change', source: 'feature', target: 'main' })
  const id = created.view.pullRequests[0].id
  const conflict = await run({ action: 'preview', pullRequest: id })
  assert.deepEqual(conflict.conflicts, ['server.properties'])
  await assert.rejects(run({ action: 'apply', previewId: conflict.previewId }), { code: 'CONFLICT' })
  const resolved = await run({ action: 'preview', pullRequest: id, resolutions: { 'server.properties': 'incoming' } })
  await assert.rejects(engine.run({ action: 'apply', previewId: resolved.previewId }, editor), { code: 'PREVIEW' })
  await run({ action: 'apply', previewId: resolved.previewId })
  assert.equal(await fs.readFile(path.join(root, 'server.properties'), 'utf8'), 'motd=feature')
})

test('прерванное применение восстанавливается; посторонние правки после сбоя не затираются', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-history-recovery-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'server'), store = path.join(directory, 'history')
  await fs.mkdir(root); const file = path.join(root, 'config.json')
  await fs.writeFile(file, 'one')
  let settings = { xmx: 1024 }
  const ports = { root, store, settings: async () => settings, saveSettings: async value => { settings = value }, isRunning: () => false }
  let engine = new historyModule.ServerHistory(ports)
  const run = command => engine.run(command, actor)
  let scan = await run({ action: 'scan' })
  const first = await run({ action: 'commit', message: 'First', fingerprint: scan.fingerprint })
  await fs.writeFile(file, 'two'); settings = { xmx: 2048 }
  scan = await run({ action: 'scan' })
  const second = await run({ action: 'commit', message: 'Second', fingerprint: scan.fingerprint })
  const repo = JSON.parse(await fs.readFile(path.join(store, 'repository.json'), 'utf8'))
  const journal = { before: repo.commits[second.view.head].snapshot, after: repo.commits[first.view.head].snapshot, beforeRepo: createHash('sha256').update(stable(repo)).digest('hex'), afterRepo: 'not-committed' }
  await fs.writeFile(file, 'one'); settings = { xmx: 1024 }
  await fs.writeFile(path.join(store, 'pending-apply.json'), JSON.stringify(journal))
  engine = new historyModule.ServerHistory(ports)
  assert.equal((await run({ action: 'get' })).view.head, second.view.head)
  assert.equal(await fs.readFile(file, 'utf8'), 'two')
  assert.equal(settings.xmx, 2048)
  await assert.rejects(fs.stat(path.join(store, 'pending-apply.json')), { code: 'ENOENT' })
  await fs.writeFile(file, 'changed outside history')
  await fs.writeFile(path.join(store, 'pending-apply.json'), JSON.stringify(journal))
  engine = new historyModule.ServerHistory(ports)
  await assert.rejects(run({ action: 'get' }), { code: 'LOCAL_CHANGED' })
  assert.equal(await fs.readFile(file, 'utf8'), 'changed outside history')
})
