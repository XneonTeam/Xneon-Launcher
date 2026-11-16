// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import nodeTest, { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import worktreeModule from "../../dist-electrobun-tests/main/share/worktree.js"
import vm from "node:vm"
import Database from "better-sqlite3"
import launchModule from "../../dist-electrobun-tests/main/share/launch-settings.js"
import { createRequire } from "node:module"
import * as domain from "../../packages/xnlc-share/lib/index.js"
import { createShareServer } from "../../infrastructure/xnlc-share/server.mjs"
import { MemoryFiles, hash, metadata } from "../../packages/xnlc-share/tests/helpers.mjs"
import nameModule from "../../dist-electrobun-tests/main/share/instance-name.js"
import React from "react"
import { loadReactModule, reactNodes } from "../helpers/react-module.mjs"

{
  const { ShareWorktree } = worktreeModule
  describe("share", () => {
    test('ShareWorktree: real disk apply, stale content, traversal and symlink protection', async t => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-worktree-'))
      t.after(() => fs.rm(directory, { recursive: true, force: true }))
      const tree = new ShareWorktree(directory)
      await fs.mkdir(path.join(directory, 'config')); await fs.writeFile(path.join(directory, 'config/a.json'), '{}')
      const before = (await tree.hash('config/a.json')).sha256
      await tree.apply([{ path: 'config/a.json', bytes: Buffer.from('{"v":2}'), expected: before }, { path: 'config/b.json', bytes: Buffer.from('{}'), expected: null }])
      assert.equal(await fs.readFile(path.join(directory, 'config/a.json'), 'utf8'), '{"v":2}')
      await assert.rejects(tree.apply([{ path: 'config/a.json', bytes: null, expected: before }]), /after preview/)
      assert.equal(await fs.readFile(path.join(directory, 'config/a.json'), 'utf8'), '{"v":2}')
      await assert.rejects(tree.read('../outside.txt'), /Unsafe/)
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-outside-'))
      t.after(() => fs.rm(outside, { recursive: true, force: true }))
      await fs.symlink(outside, path.join(directory, 'linked'), 'junction')
      await assert.rejects(tree.read('linked/secret.json'), /Symbolic/)
    })

    test('ShareWorktree: journal recovery restores files after interrupted update', async t => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-recovery-'))
      t.after(() => fs.rm(directory, { recursive: true, force: true }))
      const transaction = path.join(directory, '.xnlc-share', 'transaction-1234-abcd')
      await fs.mkdir(transaction, { recursive: true }); await fs.mkdir(path.join(directory, 'config'))
      await fs.writeFile(path.join(directory, 'config/a.json'), 'new')
      await fs.writeFile(path.join(directory, 'config/b.json'), 'new file')
      await fs.writeFile(path.join(transaction, '0.old'), 'old')
      await fs.writeFile(path.join(transaction, 'journal.json'), JSON.stringify({ committed: false, entries: [{ path: 'config/a.json', existed: true, applied: true, index: 0 }, { path: 'config/b.json', existed: false, applied: true, index: 1 }] }))
      await new ShareWorktree(directory).recover()
      assert.equal(await fs.readFile(path.join(directory, 'config/a.json'), 'utf8'), 'old')
      await assert.rejects(fs.stat(path.join(directory, 'config/b.json')), { code: 'ENOENT' })
      await assert.rejects(fs.stat(transaction), { code: 'ENOENT' })
    })
  })
}

{
  describe("share-launch-settings", () => {
    test('установка обновления сохраняет описание, иконку, обложку и состав в SQLite', async t => {
      const db = new Database(':memory:')
      t.after(() => db.close())
      db.exec(`CREATE TABLE builds (id TEXT PRIMARY KEY, name TEXT, description TEXT, version TEXT, modLoader TEXT, loaderVersion TEXT, icon TEXT, coverImage TEXT, mods TEXT, resourcepacks TEXT, shaders TEXT, installedMods TEXT, modsCount INTEGER, resourcepacksCount INTEGER, shadersCount INTEGER);
    CREATE TABLE shared_instances (build_id TEXT PRIMARY KEY, repository_id TEXT, branch TEXT, applied_commit TEXT, latest_commit TEXT, user_id TEXT, role TEXT, status TEXT, updated_at INTEGER);
    INSERT INTO builds (id,name,description,icon,coverImage) VALUES ('test','Моя локальная копия','Старое описание','old-icon','old-cover');`)
      for (const column of ['intentPath TEXT', 'javaOverride INTEGER', 'javaPath TEXT', 'javaArgs TEXT', 'memoryMin TEXT', 'memoryMax TEXT', 'windowOverride INTEGER', 'windowWidth INTEGER', 'windowHeight INTEGER', 'defaultAccountId TEXT', 'serverOverride INTEGER', 'server TEXT', 'serverPort TEXT', '[group] TEXT', 'preLaunchCommand TEXT', 'postLaunchCommand TEXT', 'wrapperCommand TEXT', 'customEnv TEXT']) db.exec('ALTER TABLE builds ADD COLUMN ' + column)
      const module = { exports: {} }
      const core = {
        run: (sql, args) => db.prepare(sql).run(...args),
        queryAll: (sql, args) => db.prepare(sql).all(...args),
        transactionImmediate: fn => db.transaction(fn).immediate(),
      }
      const code = await fs.readFile(new URL('../../dist-electrobun-tests/db/share.js', import.meta.url), 'utf8')
      vm.runInNewContext(code, { module, exports: module.exports, require: name => { assert.equal(name, './core'); return core } })
      const link = { repositoryId: 'repo', branch: 'main', applied: 'commit', latest: 'commit', userId: 'user', role: 'viewer', status: 'up_to_date' }
      const fields = { description: 'Новое описание', version: '1.21.1', modLoader: 'fabric', loaderVersion: '0.16.0', icon: 'new-icon', coverImage: 'new-cover', mods: [{ name: 'mod' }], resourcepacks: [{ name: 'pack' }], shaders: [{ name: 'shader' }], installedMods: { mod: 'mods/mod.jar' } }
      module.exports.finishShareInstall('test', link, fields)
      let row = db.prepare('SELECT * FROM builds').get()
      for (const key of ['description', 'version', 'modLoader', 'loaderVersion', 'icon', 'coverImage']) assert.equal(row[key], fields[key])
      for (const key of ['mods', 'resourcepacks', 'shaders', 'installedMods']) assert.deepEqual(JSON.parse(row[key]), fields[key])
      assert.equal(row.name, 'Моя локальная копия')
      module.exports.finishShareInstall('test', link, { ...fields, name: 'Обновлённая сборка', intentPath: 'C:/instances/Обновлённая сборка' })
      row = db.prepare('SELECT * FROM builds').get()
      assert.equal(row.name, 'Обновлённая сборка')
      assert.equal(row.intentPath, 'C:/instances/Обновлённая сборка')
      assert.equal(row.modsCount, 1); assert.equal(row.resourcepacksCount, 1); assert.equal(row.shadersCount, 1)
      assert.equal(db.prepare('SELECT applied_commit FROM shared_instances').get().applied_commit, 'commit')
      const { icon, coverImage, ...legacy } = fields
      module.exports.finishShareInstall('test', link, legacy)
      row = db.prepare('SELECT * FROM builds').get()
      assert.equal(row.icon, icon); assert.equal(row.coverImage, coverImage)
      module.exports.finishShareInstall('test', link, { ...fields, icon: '', coverImage: '' })
      row = db.prepare('SELECT * FROM builds').get()
      assert.equal(row.icon, ''); assert.equal(row.coverImage, '')
      const launch = { javaOverride: true, javaPath: '/usr/lib/jvm/java-21/bin/java', javaArgs: '-XX:+UseG1GC', memoryMin: '1G', memoryMax: '6G', windowOverride: true, windowWidth: 1600, windowHeight: 900, defaultAccountId: 'local-account', serverOverride: true, server: 'play.example.org', serverPort: '25565', group: 'Friends', preLaunchCommand: 'echo before', postLaunchCommand: 'echo after', wrapperCommand: '', customEnv: 'PACK_MODE=fast' }
      module.exports.finishShareInstall('test', link, { ...fields, launch })
      row = db.prepare('SELECT * FROM builds').get()
      for (const [key, value] of Object.entries(launch)) assert.equal(row[key], typeof value === 'boolean' ? Number(value) : value)
      module.exports.finishShareInstall('test', link, fields)
      assert.equal(db.prepare('SELECT defaultAccountId FROM builds').get().defaultAccountId, 'local-account')
    })

    test('настройки запуска сопоставляют Java и аккаунт между компьютерами, не передают токены и не создают ложных изменений', () => {
      const { serializeLaunchSettings, resolveLaunchSettings } = launchModule
      const ownerAccount = { id: 'owner-account', type: 'microsoft', username: 'Alice', uuid: 'abcd-1234', isActive: true, accessToken: 'private-access-token', refreshToken: 'private-refresh-token' }
      const sourceJava = { path: 'C:\\Java\\jdk-21\\bin\\java.exe', version: '21.0.1', vendor: 'Adoptium' }
      const source = { javaOverride: true, javaPath: sourceJava.path, memoryMin: '1G', memoryMax: '6G', javaArgs: '-XX:+UseG1GC', windowOverride: true, windowWidth: 1600, windowHeight: 900, defaultAccountId: ownerAccount.id }
      const portable = serializeLaunchSettings(source, [ownerAccount], [sourceJava])
      assert.equal(JSON.stringify(portable).includes('private-'), false)
      assert.equal(JSON.stringify(portable).includes('owner-account'), false)
      const account = { ...ownerAccount, id: 'receiver-account', uuid: 'abcd1234' }
      const java = { path: '/usr/lib/jvm/java-21/bin/java', version: '21.0.2', vendor: 'Adoptium' }
      const resolved = resolveLaunchSettings(portable, [account], [java])
      assert.equal(resolved.javaPath, java.path)
      assert.equal(resolved.defaultAccountId, account.id)
      assert.equal(resolved.memoryMax, '6G')
      assert.equal(resolved.windowWidth, 1600)
      assert.deepEqual(serializeLaunchSettings(resolved, [account], [java], portable), portable)
      const missing = resolveLaunchSettings(portable, [], [])
      assert.equal(missing.javaPath, '')
      assert.equal(missing.defaultAccountId, '')
      assert.deepEqual(serializeLaunchSettings(missing, [], [], portable), portable)
    })
  })
}

{
  describe("share-metadata", () => {
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
      const code = await fs.readFile(new URL('../../dist-electrobun-tests/main/share/service.js', import.meta.url), 'utf8')
      const nativeRequire = createRequire(new URL("../../dist-electrobun-tests/main/share/service.js", import.meta.url))
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
          '../java-discovery': { detectJavaInstallations: async () => [] },
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
        vm.runInNewContext(code, { module: { get exports() { return exports }, set exports(value) { Object.assign(exports, value) } }, exports, require: name => name in mocks ? mocks[name] : nativeRequire(name), fetch, process: { env: {} }, Buffer })
        const execute = input => exports.executeShare(input, () => {})
        const value = role === 'owner' ? invitation.token : `  ${invitation.token.toLowerCase().replaceAll('-', '- ')}\n`
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

    test('локальный запуск не блокируется фоновой операцией Share или недоступным сервисом', async () => {
      const code = await fs.readFile(new URL('../../dist-electrobun-tests/main/share/service.js', import.meta.url), 'utf8')
      const nativeRequire = createRequire(new URL('../../dist-electrobun-tests/main/share/service.js', import.meta.url))
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
      vm.runInNewContext(code, { module: { get exports() { return exports }, set exports(value) { Object.assign(exports, value) } }, exports, require: name => name in mocks ? mocks[name] : nativeRequire(name), Buffer, process: { env: {} } })
      const status = exports.executeShare({ action: 'status', buildId: 'local' }, () => {})
      await started
      try {
        const result = await exports.executeShare({ action: 'checkLaunch', buildId: 'local' }, () => {})
        assert.deepEqual(Object.keys(result), [])
      } finally { release({ configured: false, signedIn: false }); await status }
      const result = await exports.executeShare({ action: 'checkLaunch', buildId: 'local' }, () => {})
      assert.deepEqual(Object.keys(result), [])
    })
  })
}

{
  describe("share-rename", () => {
    test('смена названия переносит содержимое, обходит занятые папки и откатывается при ошибке записи', async t => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-share-rename-'))
      t.after(() => fs.rm(root, { recursive: true, force: true }))
      const source = path.join(root, 'Old')
      await fs.mkdir(path.join(source, 'saves'), { recursive: true })
      await fs.writeFile(path.join(source, 'saves', 'test.txt'), 'world')
      await fs.mkdir(path.join(root, 'New'))
      const rename = await nameModule.prepareSharedRename(source, 'Old', 'New', ['New (2)'], value => value)
      assert.equal(rename.name, 'New (3)')
      await rename.move()
      assert.equal(await fs.readFile(path.join(rename.directory, 'saves', 'test.txt'), 'utf8'), 'world')
      await assert.rejects(fs.stat(source), { code: 'ENOENT' })
      await rename.rollback()
      assert.equal(await fs.readFile(path.join(source, 'saves', 'test.txt'), 'utf8'), 'world')
      assert.ok((await fs.stat(path.join(root, 'New'))).isDirectory())
    })
  })
}

{
  const test = nodeTest
  function fixture({ shared = false, scanned = true, busy = false } = {}) {
    const calls = [], effects = []
    let state = 0
    const scan = { manifest: { entries: [{ path: 'mods/demo.jar' }, { path: 'config/test.json' }] }, changes: [] }
    const { SharePublishDialog } = loadReactModule(new URL('../../components/launcher/instance/shared/share-publish-dialog.tsx', import.meta.url), {
      react: { ...React, useState: initial => { const index = state++; return [index === 1 && scanned ? scan : typeof initial === 'function' ? initial() : initial, () => {}] }, useRef: value => ({ current: value }), useMemo: callback => callback(), useEffect: callback => effects.push(callback) },
      'react-i18next': { useTranslation: () => ({ t: key => key }) },
      './share-ui': { ShareModal: () => null, ShareButton: () => null, bytesLabel: String, shareInput: '' },
      './share-publish-tabs': { SharePublishTabs: () => null }, './share-file-tree': { ShareFileTree: () => null }, './share-content-changes': { ShareContentChanges: () => null },
    })
    const controller = { busy, data: { link: shared ? {} : undefined }, run: async request => { calls.push(request); return { uploadedBytes: 1, reusedBytes: 0 } }, refresh: async () => {} }
    const tree = SharePublishDialog({ open: true, onClose() {}, controller, buildId: 'build' })
    const buttons = reactNodes(tree).filter(node => node.props.onClick && node.props.busy !== undefined)
    assert.equal(buttons.length, 1)
    return { button: buttons[0], calls }
  }
  describe("publish-button-icon", () => {
    test('публикация недоступна до scan и во время занятого контроллера', () => {
      assert.equal(fixture({ scanned: false }).button.props.disabled, true)
      assert.equal(fixture({ busy: true }).button.props.disabled, true)
    })
    for (const shared of [false, true]) test(`кнопка отправляет ${shared ? 'push' : 'publish'} с путями мода и идентификатором сборки`, async () => {
      const { button, calls } = fixture({ shared })
      assert.equal(button.props.disabled, false)
      button.props.onClick()
      await Promise.resolve()
      assert.equal(calls.length, 1)
      assert.equal(calls[0].action, shared ? 'push' : 'publish')
      assert.equal(calls[0].buildId, 'build')
      assert.deepEqual(Array.from(calls[0].selected), ['mods/demo.jar', '@instance', '@exclusions'])
      assert.ok(calls[0].requestId)
    })
  })
}
