import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import Database from 'better-sqlite3'
import launchModule from '../../dist-electron/main/share/launch-settings.js'

test('установка обновления сохраняет описание, иконку, обложку и состав в SQLite', async t => {
  const db = new Database(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE builds (id TEXT PRIMARY KEY, name TEXT, description TEXT, version TEXT, modLoader TEXT, loaderVersion TEXT, icon TEXT, coverImage TEXT, mods TEXT, resourcepacks TEXT, shaders TEXT, installedMods TEXT, modsCount INTEGER, resourcepacksCount INTEGER, shadersCount INTEGER);
    CREATE TABLE shared_instances (build_id TEXT PRIMARY KEY, repository_id TEXT, branch TEXT, applied_commit TEXT, latest_commit TEXT, user_id TEXT, role TEXT, status TEXT, updated_at INTEGER);
    INSERT INTO builds (id,name,description,icon,coverImage) VALUES ('test','Моя локальная копия','Старое описание','old-icon','old-cover');`)
  for (const column of ['intentPath TEXT', 'javaOverride INTEGER', 'javaPath TEXT', 'javaArgs TEXT', 'memoryMin TEXT', 'memoryMax TEXT', 'windowOverride INTEGER', 'windowWidth INTEGER', 'windowHeight INTEGER', 'defaultAccountId TEXT', 'serverOverride INTEGER', 'server TEXT', 'serverPort TEXT', '[group] TEXT', 'preLaunchCommand TEXT', 'postLaunchCommand TEXT', 'wrapperCommand TEXT', 'customEnv TEXT']) db.exec('ALTER TABLE builds ADD COLUMN ' + column)
  const exports = {}
  const core = {
    run: (sql, args) => db.prepare(sql).run(...args),
    queryAll: (sql, args) => db.prepare(sql).all(...args),
    transactionImmediate: fn => db.transaction(fn).immediate(),
  }
  const code = await fs.readFile(new URL('../../dist-electron/db/share.js', import.meta.url), 'utf8')
  vm.runInNewContext(code, { exports, require: name => { assert.equal(name, './core'); return core } })
  const link = { repositoryId: 'repo', branch: 'main', applied: 'commit', latest: 'commit', userId: 'user', role: 'viewer', status: 'up_to_date' }
  const fields = { description: 'Новое описание', version: '1.21.1', modLoader: 'fabric', loaderVersion: '0.16.0', icon: 'new-icon', coverImage: 'new-cover', mods: [{ name: 'mod' }], resourcepacks: [{ name: 'pack' }], shaders: [{ name: 'shader' }], installedMods: { mod: 'mods/mod.jar' } }
  exports.finishShareInstall('test', link, fields)
  let row = db.prepare('SELECT * FROM builds').get()
  for (const key of ['description', 'version', 'modLoader', 'loaderVersion', 'icon', 'coverImage']) assert.equal(row[key], fields[key])
  for (const key of ['mods', 'resourcepacks', 'shaders', 'installedMods']) assert.deepEqual(JSON.parse(row[key]), fields[key])
  assert.equal(row.name, 'Моя локальная копия')
  exports.finishShareInstall('test', link, { ...fields, name: 'Обновлённая сборка', intentPath: 'C:/instances/Обновлённая сборка' })
  row = db.prepare('SELECT * FROM builds').get()
  assert.equal(row.name, 'Обновлённая сборка')
  assert.equal(row.intentPath, 'C:/instances/Обновлённая сборка')
  assert.equal(row.modsCount, 1); assert.equal(row.resourcepacksCount, 1); assert.equal(row.shadersCount, 1)
  assert.equal(db.prepare('SELECT applied_commit FROM shared_instances').get().applied_commit, 'commit')
  const { icon, coverImage, ...legacy } = fields
  exports.finishShareInstall('test', link, legacy)
  row = db.prepare('SELECT * FROM builds').get()
  assert.equal(row.icon, icon); assert.equal(row.coverImage, coverImage)
  exports.finishShareInstall('test', link, { ...fields, icon: '', coverImage: '' })
  row = db.prepare('SELECT * FROM builds').get()
  assert.equal(row.icon, ''); assert.equal(row.coverImage, '')
  const launch = { javaOverride: true, javaPath: '/usr/lib/jvm/java-21/bin/java', javaArgs: '-XX:+UseG1GC', memoryMin: '1G', memoryMax: '6G', windowOverride: true, windowWidth: 1600, windowHeight: 900, defaultAccountId: 'local-account', serverOverride: true, server: 'play.example.org', serverPort: '25565', group: 'Friends', preLaunchCommand: 'echo before', postLaunchCommand: 'echo after', wrapperCommand: '', customEnv: 'PACK_MODE=fast' }
  exports.finishShareInstall('test', link, { ...fields, launch })
  row = db.prepare('SELECT * FROM builds').get()
  for (const [key, value] of Object.entries(launch)) assert.equal(row[key], typeof value === 'boolean' ? Number(value) : value)
  exports.finishShareInstall('test', link, fields)
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
