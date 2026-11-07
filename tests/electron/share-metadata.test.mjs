import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as domain from '../../packages/xnlc-share/lib/index.js'
import { createShareServer } from '../../services/share/server.mjs'
import { MemoryFiles, hash, metadata } from '../../packages/xnlc-share/tests/helpers.mjs'
import launchModule from '../../dist-electron/main/share/launch-settings.js'

test('установка по коду работает для всех ролей, нормализует ввод и не создаёт дубликат при повторе после сбоя', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-invite-install-'))
  const tokens = { alice: 'a'.repeat(40), bob: 'b'.repeat(40) }
  const service = await createShareServer({ directory, bootstrap: Object.entries(tokens).map(([user, token]) => ({ user, token })) })
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${service.server.address().port}`
  const remote = new domain.ShareApiClient(url, async () => tokens.alice, fetch)
  const publisher = new domain.ShareSystem({ files: new MemoryFiles(), remote, hash, sources: [], now: () => new Date().toISOString() })
  const published = await publisher.publish((await publisher.scan(metadata)).manifest, 'alice')
  const repositoryId = published.repository.id
  const code = await fs.readFile(new URL('../../dist-electron/main/share/service.js', import.meta.url), 'utf8')
  const nativeRequire = createRequire(new URL("../../dist-electron/main/share/service.js", import.meta.url))
  for (const role of ['owner', 'editor', 'viewer']) {
    const user = role === 'owner' ? 'alice' : 'bob'
    const request = async (route, method = 'GET', body) => {
      const response = await fetch(url + '/v1' + route, { method, headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(JSON.stringify(result))
      return result
    }
    const invitationResponse = await fetch(`${url}/v1/repositories/${repositoryId}/invites`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.alice}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: role === 'owner' ? 'viewer' : role, maxUses: 1 }) })
    const invitation = await invitationResponse.json()
    assert.match(invitation.token, /^XNLC-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/)
    const builds = new Map(), bindings = new Map(), trees = new Map()
    let failScan = role === 'viewer'
    class Worktree extends MemoryFiles {
      constructor(dir) { super(); if (trees.has(dir)) return trees.get(dir); trees.set(dir, this) }
      async recover() {}
    }
    const mocks = {
      '@xnlc/share': domain,
      '../../db': { dbHelpers: { loadBuilds: async () => [...builds.values()], insertBuild: async build => builds.set(build.id, build), findBuildById: async id => builds.get(id), getResources: async () => [], loadAccounts: async () => [] } },
      './launch-settings': launchModule,
      '../system': { detectJavaInstallations: async () => [] },
      '../builds/helpers': { getBuildIntentPath: name => path.join(directory, role, name), getBuildIntentDirName: name => name, ensureBuildIntentDir: async name => { const dir = path.join(directory, role, name); await fs.mkdir(dir, { recursive: true }); return dir } },
      '../minecraft-core': { isGameDirActive: () => false },
      './worktree': { ShareWorktree: Worktree },
      './auth': { shareConfiguration: async () => ({ url, token: tokens[user] }), shareRequest: request, shareSession: async () => ({ signedIn: true, eligible: true }) },
      '../../db/share': { getShareBinding: id => bindings.get(id), saveShareBinding: (id, link) => bindings.set(id, link), finishShareInstall: (id, link, fields) => { Object.assign(builds.get(id), fields); bindings.set(id, link) } },
      '../builds/scanner': { scanIntentDir: async () => { if (failScan) { failScan = false; throw new Error('Temporary scan failure') } return { mods: [], resourcepacks: [], shaders: [], installedMods: {} } } },
      '../runtime': { sendToRenderer() {} }, './links': {},
      './content-presentation': { describeShareContent: async () => ({}), describeIncomingShareContent: async () => ({}) },
    }
    const exports = {}
    vm.runInNewContext(code, { exports, require: name => name in mocks ? mocks[name] : nativeRequire(name), fetch, process: { env: {} }, Buffer })
    const execute = input => exports.executeShare(input, () => {})
    const value = role === 'owner' ? `xneon://share/invite/${invitation.token}` : `  ${invitation.token.toLowerCase().replaceAll('-', '- ')}\n`
    const preview = await execute({ action: 'invitationPreview', invitation: value })
    const install = { action: 'installInvite', previewId: preview.previewId, name: 'Installed' }
    if (role === 'viewer') await assert.rejects(execute(install), /Temporary scan failure/)
    const result = await execute(install)
    assert.equal(result.link.applied, published.commit.id)
    assert.equal(result.link.role, role)
    assert.equal(builds.size, 1)
    assert.equal(bindings.size, 1)
  }
})

import './share-launch-settings.test.mjs'

test('локальный запуск не блокируется фоновой операцией Share или недоступным сервисом', async () => {
  const code = await fs.readFile(new URL('../../dist-electron/main/share/service.js', import.meta.url), 'utf8')
  const nativeRequire = createRequire(new URL('../../dist-electron/main/share/service.js', import.meta.url))
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const session = new Promise(resolve => { release = resolve })
  const mocks = {
    '../../db': { dbHelpers: { findBuildById: async id => ({ id, name: 'Local' }) } },
    '../../db/share': { getShareBinding: () => null },
    './auth': { shareSession: async () => { entered(); return session } },
    '../builds/helpers': {}, '../minecraft-core': {}, './worktree': {}, '../system': {},
    '../builds/scanner': {}, '../runtime': {}, './links': {}, './content-presentation': {},
  }
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => name in mocks ? mocks[name] : nativeRequire(name), Buffer, process: { env: {} } })
  const status = exports.executeShare({ action: 'status', buildId: 'local' }, () => {})
  await started
  try {
    const result = await exports.executeShare({ action: 'checkLaunch', buildId: 'local' }, () => {})
    assert.deepEqual(Object.keys(result), [])
  } finally { release({ configured: false, signedIn: false }); await status }
  const result = await exports.executeShare({ action: 'checkLaunch', buildId: 'local' }, () => {})
  assert.deepEqual(Object.keys(result), [])
})
