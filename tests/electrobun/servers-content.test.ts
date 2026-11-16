// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe, expect, test, mock } from "bun:test"
import TestZip from "../helpers/zip.ts"
import fs, { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import os, { tmpdir } from "node:os"
import path, { join } from "node:path"
import { analyzeDatapack } from "@xnlc/parser"
import { installServerDatapack } from "../../electrobun/main/server-datapacks.ts"
import { test as nodeTest } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import fsNative from "node:fs"
import { stripTypeScriptTypes } from "./transpile.mjs"
import historyModule from "../../dist-electrobun-tests/main/remote-servers/history.js"
import { createHash } from "node:crypto"
import { stable } from "@xnlc/share"
import filesModule from "../../dist-electrobun-tests/main/remote-servers/files.js"
import vm from "node:vm"
import { transformSync } from "esbuild"

{
  describe("server-datapacks-parser", () => {
    test("сервер устанавливает датапак после проверки XNLC", async () => {
      const dir = await mkdtemp(join(tmpdir(), "xnlc-server-datapack-"))
      try {
        const zip = new TestZip()
        zip.addFile("pack.mcmeta", Buffer.from('{"pack":{"pack_format":48,"description":"Example"}}'))
        zip.addFile("data/example/test.json", Buffer.from("{}"))
        await installServerDatapack(dir, "example.zip", zip.toBuffer())
        expect((await analyzeDatapack(join(dir, "example.zip"))).format).toBe("datapack")
        await expect(installServerDatapack(dir, "bad.zip", Buffer.from("broken"))).rejects.toThrow()
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  })
}

{
  const test = nodeTest
  const require = createRequire(import.meta.url)

  const { serverDatapackDirectory, installServerDatapack, deleteServerDatapack, validateDatapack } = require('../../dist-electrobun-tests/main/server-datapacks.js')
  const fixture = async run => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-datapacks-'))
    try { await run(root) } finally { await fs.rm(root, { recursive: true, force: true }) }
  }
  const pack = (prefix = '') => {
    const zip = new TestZip()
    zip.addFile(prefix + 'pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 48, description: 'Test' } })))
    zip.addFile(prefix + 'data/test/function/main.mcfunction', Buffer.from('say test'))
    return zip.toBuffer()
  }
  describe("server-datapacks", () => {
    test('level-name: стандартный мир, переименование и вложенные пути', () => fixture(async root => {
      assert.equal(await serverDatapackDirectory(root), path.join(root, 'world', 'datapacks'))
      assert.equal(await serverDatapackDirectory(root, 'My world'), path.join(root, 'My world', 'datapacks'))
      assert.equal(await serverDatapackDirectory(root, 'maps/custom'), path.join(root, 'maps', 'custom', 'datapacks'))
      for (const name of ['../outside', 'world/../../outside', 'C:\\outside', '/outside', 'world/./other']) {
        await assert.rejects(serverDatapackDirectory(root, name))
      }
    }))
    test('ZIP устанавливается без распаковки только в выбранный мир', () => fixture(async root => {
      const directory = await serverDatapackDirectory(root, 'custom')
      const buffer = pack()
      await installServerDatapack(directory, 'test.zip', buffer)
      assert.deepEqual(await fs.readFile(path.join(directory, 'test.zip')), buffer)
      await assert.rejects(fs.stat(path.join(root, 'world')))
      await assert.rejects(installServerDatapack(directory, '../outside.zip', buffer))
      await deleteServerDatapack(directory, 'test.zip')
      await assert.rejects(fs.stat(path.join(directory, 'test.zip')))
    }))
    test('pack.mcmeta обязателен в корне, ошибочный ZIP не заменяет установленный', () => fixture(async root => {
      const directory = await serverDatapackDirectory(root)
      const buffer = pack()
      await installServerDatapack(directory, 'test.zip', buffer)
      await assert.rejects(validateDatapack(pack('wrapper/')))
      await assert.rejects(installServerDatapack(directory, 'test.zip', Buffer.from('not a zip')))
      assert.deepEqual(await fs.readFile(path.join(directory, 'test.zip')), buffer)
    }))
    test('Распакованные датапаки удаляются; junction мира не используется', () => fixture(async root => {
      const directory = await serverDatapackDirectory(root)
      await fs.mkdir(path.join(directory, 'unpacked'), { recursive: true })
      await fs.writeFile(path.join(directory, 'unpacked', 'pack.mcmeta'), '{}')
      await deleteServerDatapack(directory, 'unpacked')
      await assert.rejects(fs.stat(path.join(directory, 'unpacked')))
      await fs.mkdir(path.join(root, 'other'))
      await fs.symlink(path.join(root, 'other'), path.join(root, 'linked'), 'junction')
      await assert.rejects(serverDatapackDirectory(root, 'linked'))
    }))

    test('Отменённая установка не записывает датапак', () => fixture(async root => {
      const directory = await serverDatapackDirectory(root)
      const controller = new AbortController()
      controller.abort(new Error('CONTENT_DOWNLOAD_CANCELLED'))
      await assert.rejects(installServerDatapack(directory, 'cancelled.zip', pack(), controller.signal), /CONTENT_DOWNLOAD_CANCELLED/)
      await assert.rejects(fs.stat(path.join(directory, 'cancelled.zip')))
    }))
  })
}

{
  describe("world-datapacks-parser", () => {
    test("датапаки одиночного мира: ZIP, папка, список и проверка установки", async () => {
      const root = await mkdtemp(join(tmpdir(), "xnlc-world-datapack-"))
      try {
        const saves = join(root, "saves", "world", "datapacks")
        await mkdir(saves, { recursive: true })
        const archive = new TestZip()
        archive.addFile("pack.mcmeta", Buffer.from('{"pack":{"pack_format":48,"description":"Example"}}'))
        archive.addFile("data/demo/function/main.mcfunction", Buffer.from("say hi"))
        const source = join(root, "source.zip")
        await writeFile(source, archive.toBuffer())
        const folder = join(root, "folder")
        await mkdir(join(folder, "data", "folder"), { recursive: true })
        await writeFile(join(folder, "pack.mcmeta"), '{"pack":{"pack_format":61,"description":"Folder"}}')
        const invalid = join(root, "invalid.zip")
        await writeFile(invalid, "broken")
        const code = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import path from "node:path"
      const handlers = new Map()
      const root = process.env.WORLD_TEST_ROOT
      mock.module("./electrobun/platform/desktop.ts", () => ({ rpcRegistry: { handle: (name, fn) => handlers.set(name, fn) }, nativeImage: {} }))
      mock.module("./electrobun/main/builds/helpers.ts", () => ({
        ensureBuildIntentDir: async () => root,
        sanitizeFileName: value => path.basename(value),
        downloadBuffer: async () => new Uint8Array(await Bun.file(path.join(root, "source.zip")).arrayBuffer()),
      }))
      const { registerWorldsHandlers } = await import("./electrobun/main/worlds.ts")
      registerWorldsHandlers()
      const local = handlers.get("worlds:install-datapack-local")
      const remote = handlers.get("worlds:install-datapack-remote")
      const list = handlers.get("worlds:list-datapacks")
      assert.equal((await local(null, "build", "world", path.join(root, "source.zip"))).success, true)
      assert.equal((await local(null, "build", "world", path.join(root, "folder"))).success, true)
      assert.equal((await local(null, "build", "world", path.join(root, "invalid.zip"))).success, false)
      assert.equal((await remote(null, "build", "world", "https://example.invalid/pack", "remote.zip")).success, true)
      const result = await list(null, "build", "world")
      assert.equal(result.length, 3)
      assert.deepEqual(result.find(item => item.name === "source.zip").namespaces, ["demo"])
      assert.equal(result.find(item => item.name === "source.zip").description, "Example")
      assert.equal(result.find(item => item.name === "folder").description, "Folder")
    `
        const result = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, WORLD_TEST_ROOT: root }, stdout: "pipe", stderr: "pipe" })
        expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 30000)
  })
}

{
  const test = nodeTest
  const fs = fsNative
  const source = fs.readFileSync(new URL('../../lib/datapack-version.ts', import.meta.url), 'utf8')
  const { datapackVersionFile } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
  describe("datapack-version", () => {
    test('Датапаки: JAR-версии модов отсекаются, ZIP выбирается из списка файлов', () => {
      assert.equal(datapackVersionFile({ loaders: ['fabric'], fileName: 'mod.jar' }), null)
      assert.equal(datapackVersionFile({ loaders: ['forge'], fileName: 'archive.zip' }), null)
      assert.deepEqual(datapackVersionFile({ loaders: ['datapack'], fileName: 'mod.jar', files: [{ filename: 'mod.jar', url: 'jar' }, { filename: 'pack.zip', url: 'zip' }] }), { fileName: 'pack.zip', downloadUrl: 'zip' })
      assert.deepEqual(datapackVersionFile({ loaders: [], fileName: 'pack.zip', downloadUrl: 'cf' }), { fileName: 'pack.zip', downloadUrl: 'cf' })
      assert.equal(datapackVersionFile({ loaders: ['datapack'], fileName: 'mod.jar' }), null)
    })
  })
}

{
  const test = nodeTest
  const actor = { id: 'owner', name: 'Owner' }, editor = { id: 'editor', name: 'Editor' }
  describe("server-history", () => {
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
  })
}

{
  const test = nodeTest
  describe("remote-server-files", () => {
    test('удалённые файловые операции не выходят из папки сервера через junction и server.properties', async t => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-remote-files-'))
      t.after(() => fs.rm(root, { recursive: true, force: true }))
      const server = path.join(root, 'server'), outside = path.join(root, 'outside')
      await fs.mkdir(server); await fs.mkdir(outside)
      await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')
      await fs.symlink(outside, path.join(server, 'linked'), 'junction')
      for (const channel of ['mc-server:fs-read', 'mc-server:fs-write', 'mc-server:fs-delete']) await assert.rejects(filesModule.assertRemoteServerPaths(server, channel, ['linked/secret.txt', 'modified']), { code: 'PATH' })
      await assert.rejects(filesModule.assertRemoteServerPaths(server, 'mc-server:fs-delete', ['linked']), { code: 'PATH' })
      await fs.mkdir(path.join(server, 'config'))
      await fs.symlink(outside, path.join(server, 'config', 'linked'), 'junction')
      await assert.rejects(filesModule.assertRemoteServerPaths(server, 'mc-server:fs-rename', ['config', 'renamed']), { code: 'PATH' })
      await filesModule.assertRemoteServerPaths(server, 'mc-server:fs-write', ['safe/config.json', '{}'])
      await fs.symlink(outside, path.join(server, 'server.properties'), 'junction')
      for (const operation of ['mc-server:read-properties', 'mc-server:write-properties', 'mc-server:update']) await assert.rejects(filesModule.assertRemoteServerPaths(server, operation, [{}]), { code: 'PATH' })
      assert.equal(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8'), 'secret')
    })
  })
}

{
  const test = nodeTest
  const fs = fsNative
  function fixture(){
   const source=fs.readFileSync(new URL('../../electrobun/main/remote-servers/index.ts',import.meta.url),'utf8')
   const body=source.match(/export async function listRemoteServers\([\s\S]*?\n\}/)?.[0]
   assert.ok(body)
   let resolveRequest,calls=0,user='user';const events=[]
   const c=vm.createContext({shareConfiguration:async()=>{if(!user)throw new Error('Signed out');return {userId:user}},shareRequest:()=>{calls++;return new Promise(r=>resolveRequest=r)},connections:new Map(),closeConnection(){},remoteInfo:access=>({id:'remote:'+access.id,...access.info,remote:{id:access.id}}),sendToRenderer:(...args)=>events.push(args),Date,Promise})
   vm.runInContext('let remoteList = [], listUser = "", remoteListAt = 0, remoteListTask; const REMOTE_LIST_TTL_MS = 30000;',c)
   vm.runInContext(transformSync(body.replace('export ',''),{loader:'ts'}).code,c)
   return {list:()=>c.listRemoteServers(),finish:value=>resolveRequest(value),events,calls:()=>calls,setUser:value=>user=value}
  }
  describe("remote-server-list-performance", () => {
    test('Серверы: локальный список не ожидает сеть совместного доступа',async()=>{
     const f=fixture();let settled=false;f.list().then(()=>settled=true)
     for(let i=0;i<6;i++)await Promise.resolve()
     assert.equal(settled,true,'Сеть не должна задерживать локальные серверы')
    })
    test('Серверы: фоновое обновление объединяет запросы и пушит найденные серверы',async()=>{
     const f=fixture();await f.list();await f.list();assert.equal(f.calls(),1)
     f.finish([{id:'one',isOwner:false,info:{name:'Remote'}}]);await Promise.resolve();await Promise.resolve()
     assert.ok(f.events.some(([channel])=>channel==='mc-server:remote-connection'))
     const list=await f.list();assert.equal(list[0].id,'remote:one');assert.equal(f.calls(),1)
    })
    test('Серверы: локальный UI использует модульный снимок, TTL и не скрывает список при обновлении',()=>{
     const source=fs.readFileSync(new URL('../../src/hooks/use-mc-servers.ts',import.meta.url),'utf8')
     assert.match(source,/useState<McServerInfo\[\]>\(\(\) => serversCache \?\? \[\]\)/)
     assert.match(source,/if \(serversCache === null\) setLoading\(true\)/)
     assert.match(source,/SERVERS_CACHE_TTL_MS/)
     assert.match(source,/next\.filter\(server => !server.remote\)/)
    })
    test('Серверы: поздний ответ другого аккаунта не попадает в список',async()=>{
     const f=fixture();await f.list();f.setUser(null);assert.equal((await f.list()).length,0)
     f.finish([{id:'private',isOwner:false,info:{name:'Old account'}}]);for(let i=0;i<6;i++)await Promise.resolve()
     assert.equal(f.events.length,0);f.setUser('other');assert.equal((await f.list()).length,0)
    })
    test('Серверы: создание/удаление сразу обновляет снимок, удалённый доступ не кэшируется',()=>{
     const source=fs.readFileSync(new URL('../../src/hooks/use-mc-servers.ts',import.meta.url),'utf8')
     const statement=source.match(/const setServers = useCallback\([\s\S]*?\n  \}, \[\]\)/)?.[0];assert.ok(statement)
     const ref={current:[]};let state
     const context=vm.createContext({serversRef:ref,setServersState:value=>state=value,useCallback:fn=>fn})
     vm.runInContext('let serversCache=null,hadRemoteServers=false;',context)
     vm.runInContext(transformSync(statement,{loader:'ts'}).code+';globalThis.update=setServers;globalThis.snapshot=()=>({serversCache,hadRemoteServers})',context)
     context.update([{id:'local'},{id:'remote',remote:{id:'access'}}]);assert.equal(state.length,2)
     assert.deepEqual([...context.snapshot().serversCache].map(s=>s.id),['local']);assert.equal(context.snapshot().hadRemoteServers,true)
     context.update(previous=>previous.filter(s=>s.id!=='local'));assert.equal(context.snapshot().serversCache.length,0)
    })
  })
}
