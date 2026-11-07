import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import Database from 'better-sqlite3'
import storage from '../../dist-electron/main/data-location.js'

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'xnlc-data-move-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'old'), target = path.join(root, 'new'), profile = path.join(root, 'electron-profile'), cache = path.join(root, 'legacy-cache'), config = path.join(root, 'location.json')
  for (const directory of [source, profile, cache]) fs.mkdirSync(directory)
  const put = (relative, content) => { const file = path.join(source, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file }
  put('intents/Build/mods/test.jar.disabled', 'disabled mod')
  put('mc-servers/server/world/level.dat', 'world bytes')
  put('minecraft/assets/indexes/test.json', '{"objects":{}}')
  put('skins/favorite.png', 'skin bytes')
  fs.writeFileSync(path.join(profile, 'settings.txt'), 'profile data')
  fs.mkdirSync(path.join(profile, 'themes'))
  fs.writeFileSync(path.join(profile, 'themes/custom.css.json'), JSON.stringify({ fontPath: path.join(profile, 'font.ttf') }))
  fs.writeFileSync(path.join(cache, 'launcher.log'), 'log data')
  const db = new Database(path.join(source, 'data.db'))
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE builds (id TEXT PRIMARY KEY,intentPath TEXT,installedMods TEXT,javaPath TEXT); CREATE TABLE accounts (id TEXT PRIMARY KEY,token TEXT)')
  db.prepare('INSERT INTO settings VALUES (?,?)').run('instancesPath', '')
  db.prepare('INSERT INTO settings VALUES (?,?)').run('customThemes', JSON.stringify([{ fontPath: path.join(profile, 'font.ttf') }]))
  db.prepare('INSERT INTO builds VALUES (?,?,?,?)').run('build', path.join(source, 'intents/Build'), JSON.stringify({ 'test.jar': path.join(source, 'intents/Build/mods/test.jar.disabled') }), path.join(root, 'external-java/java.exe'))
  db.prepare('INSERT INTO accounts VALUES (?,?)').run('account', 'encrypted:unchanged')
  db.close()
  const state = { root: source }
  return { root, source, target, profile, cache, config, state, put,
    schedule: (destination = target, instances = source) => storage.scheduleInstancesMove(config, state, instances, destination) }
}

test('переносит только сборки: база, серверы, Minecraft, профиль и кэш остаются на месте', async t => {
  const f = await fixture(t)
  const planned = f.schedule()
  const next = storage.migrateInstancesLocation(f.config, planned)
  assert.equal(next.root, f.source)
  assert.equal(next.pendingInstances, undefined)
  assert.equal(fs.readFileSync(path.join(f.target, 'intents/Build/mods/test.jar.disabled'), 'utf8'), 'disabled mod')
  for (const name of ['data.db', 'mc-servers', 'minecraft', 'skins', 'profile', 'system-cache']) assert.equal(fs.existsSync(path.join(f.target, name)), false, name)
  assert.equal(fs.readFileSync(path.join(f.source, 'mc-servers/server/world/level.dat'), 'utf8'), 'world bytes')
  assert.equal(fs.readFileSync(path.join(f.profile, 'settings.txt'), 'utf8'), 'profile data')
  const db = new Database(path.join(f.source, 'data.db'))
  const row = db.prepare('SELECT * FROM builds').get()
  assert.equal(row.intentPath, path.join(f.target, 'intents/Build'))
  assert.equal(JSON.parse(row.installedMods)['test.jar'], path.join(f.target, 'intents/Build/mods/test.jar.disabled'))
  assert.equal(row.javaPath, path.join(f.root, 'external-java/java.exe'))
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='instancesPath'").get().value, f.target)
  assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='customThemes'").get().value)[0].fontPath, path.join(f.profile, 'font.ttf'))
  assert.equal(db.prepare('SELECT token FROM accounts').get().token, 'encrypted:unchanged')
  db.close()
})

test('повторный перенос B → C берёт текущие сборки, а не старую папку по умолчанию', async t => {
  const f = await fixture(t)
  const first = storage.migrateInstancesLocation(f.config, f.schedule())
  fs.writeFileSync(path.join(f.target, 'intents/Build/mods/new.jar'), 'new mod')
  const target = path.join(f.root, 'third')
  const second = storage.scheduleInstancesMove(f.config, first, f.target, target)
  storage.migrateInstancesLocation(f.config, second)
  assert.equal(fs.readFileSync(path.join(target, 'intents/Build/mods/new.jar'), 'utf8'), 'new mod')
  const db = new Database(path.join(f.source, 'data.db'))
  assert.equal(db.prepare('SELECT intentPath FROM builds').get().intentPath, path.join(target, 'intents/Build'))
  db.close()
})

test('занятые intents не перезаписываются, вложенные папки отклоняются', async t => {
  const f = await fixture(t)
  fs.mkdirSync(path.join(f.target, 'intents'), { recursive: true })
  fs.writeFileSync(path.join(f.target, 'intents/keep'), 'user file')
  assert.throws(() => f.schedule(), /DATA_PATH_NOT_EMPTY/)
  assert.equal(fs.readFileSync(path.join(f.target, 'intents/keep'), 'utf8'), 'user file')
  assert.throws(() => f.schedule(path.join(f.source, 'intents/sub')), /DATA_PATH_NESTED/)
  assert.equal(fs.existsSync(f.config), false)
})

test('посторонние файлы в выбранной папке не мешают переносу intents и не меняются', async t => {
  const f = await fixture(t)
  fs.mkdirSync(f.target); fs.writeFileSync(path.join(f.target, 'keep.txt'), 'keep')
  storage.migrateInstancesLocation(f.config, f.schedule())
  assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'keep')
})

test('ошибка копирования оставляет старые пути и файлы, неполная копия убирается', async t => {
  const f = await fixture(t), planned = f.schedule()
  const require = createRequire(new URL('../../dist-electron/main/data-location.js', import.meta.url))
  const mockedFs = { ...fs, copyFileSync: () => { throw new Error('Disk full') } }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL('../../dist-electron/main/data-location.js', import.meta.url), 'utf8'), { module, exports: module.exports, process, require: name => name === 'node:fs' ? mockedFs : require(name) })
  assert.throws(() => module.exports.migrateInstancesLocation(f.config, planned), /Disk full/)
  const db = new Database(path.join(f.source, 'data.db'))
  assert.equal(db.prepare('SELECT intentPath FROM builds').get().intentPath, path.join(f.source, 'intents/Build'))
  db.close()
  assert.equal(fs.existsSync(path.join(f.target, 'intents')), false)
  assert.equal(fs.readdirSync(f.target).length, 0)
  assert.equal(fs.readFileSync(path.join(f.source, 'intents/Build/mods/test.jar.disabled'), 'utf8'), 'disabled mod')
})

test('повторный запуск после готовой копии завершает перенос без перезаписи файлов', async t => {
  const f = await fixture(t), planned = f.schedule()
  storage.migrateInstancesLocation(f.config, planned)
  storage.writeDataLocation(f.config, planned)
  const next = storage.migrateInstancesLocation(f.config, storage.readDataLocation(f.config, f.source))
  assert.equal(next.root, f.source)
  assert.equal(next.pendingInstances, undefined)
})

test('пути в снимках корзины обновляются, исходный снимок остаётся прежним', async t => {
  const f = await fixture(t)
  f.put('intents/.trash/build.json', JSON.stringify({ intentPath: path.join(f.source, 'intents/Build') }))
  storage.migrateInstancesLocation(f.config, f.schedule())
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, 'intents/.trash/build.json'), 'utf8')).intentPath, path.join(f.target, 'intents/Build'))
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.source, 'intents/.trash/build.json'), 'utf8')).intentPath, path.join(f.source, 'intents/Build'))
})

test('выбор текущей папки отменяет запланированный перенос', async t => {
  const f = await fixture(t), planned = f.schedule()
  const next = storage.scheduleInstancesMove(f.config, planned, f.source, f.source)
  assert.equal(next.pendingInstances, undefined)
})

test('ссылки внутри сборок указывают в новую папку', async t => {
  const f = await fixture(t)
  fs.symlinkSync(path.join(f.source, 'intents/Build/mods'), path.join(f.source, 'intents/Build/link'), 'junction')
  storage.migrateInstancesLocation(f.config, f.schedule())
  assert.equal(path.resolve(fs.readlinkSync(path.join(f.target, 'intents/Build/link'))), path.join(f.target, 'intents/Build/mods'))
})

test('предыдущий план переноса ВСЕХ данных отменяется до открытия базы', async t => {
  const f = await fixture(t), config = path.join(f.root, '.xneonlauncher-location.json')
  storage.writeDataLocation(config, { root: f.source, pending: { id: 'obsolete', source: f.source, target: f.target } })
  const require = createRequire(new URL('../../dist-electron/main/paths.js', import.meta.url))
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL('../../dist-electron/main/paths.js', import.meta.url), 'utf8'), { module, exports: module.exports, process, Error, console, require: name => name === 'electron' ? { app: { isPackaged: false, getPath: () => f.root, setPath: () => assert.fail('Profile must not move') } } : require(name) })
  assert.equal(module.exports.getLauncherDataRoot(), f.source)
  assert.equal(storage.readDataLocation(config, f.source).pending, undefined)
  assert.equal(fs.existsSync(f.target), false)
})
