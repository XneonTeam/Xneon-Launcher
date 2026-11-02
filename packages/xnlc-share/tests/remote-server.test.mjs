import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertRemoteServerOperation as check, serverPermissions, validateServerPermissions, remoteFilePath } from '../lib/index.js'

test('права сервера независимы; свойства и остановка не обходятся через файлы или консоль', () => {
  const view = serverPermissions(), full = serverPermissions(true)
  check(view, 'mc-server:status', [])
  check(view, 'mc-server:logs', [])
  for (const channel of ['mc-server:start', 'mc-server:stop', 'mc-server:kill']) assert.throws(() => check(view, channel, []), { code: 'FORBIDDEN' })
  const editor = { ...view, writeFiles: true, readFiles: true, console: true }
  check(editor, 'mc-server:fs-write', ['config/test.yml', 'enabled: true'])
  for (const operation of [['mc-server:fs-write', ['SERVER.PROPERTIES', 'motd=x']], ['mc-server:fs-delete', ['server.properties']], ['mc-server:fs-rename', ['config/test.yml', 'server.properties']], ['mc-server:send-command', ['stop']], ['mc-server:send-command', ['/minecraft:stop']], ['mc-server:write-properties', [{ motd: 'x' }]]]) assert.throws(() => check(editor, ...operation), { code: 'FORBIDDEN' })
  for (const channel of ['mc-server:delete', 'mc-server:export-zip', 'settings:set', 'mc-server:install-pack']) assert.throws(() => check(full, channel, []))
  assert.throws(() => check(full, 'mc-server:fs-download', ['', 'https://cdn.modrinth.com/test.jar', 'nested/server.properties']), { code: 'PATH' })
  assert.throws(() => check(full, 'mc-server:fs-download', ['mods', 'http://127.0.0.1/private', 'a.jar']), { code: 'URL' })
  assert.throws(() => check(full, 'mc-server:update', [{ javaPath: 'C:/Windows/cmd.exe' }]), { code: 'INPUT' })
  assert.throws(() => check(editor, 'mc-server:send-command', ['execute as @a run minecraft:stop']), { code: 'FORBIDDEN' })
  check(full, 'mc-server:start', [])
  for (const command of [{ action: 'get' }, { action: 'java', path: null }, { action: 'java', path: 'C:/Java/bin/java.exe' }, { action: 'relay', enabled: false }]) {
    check(full, 'mc-server:host-settings', [command])
    assert.throws(() => check(view, 'mc-server:host-settings', [command]), { code: 'FORBIDDEN' })
  }
  for (const command of [{ action: 'relay', enabled: 'yes' }, { action: 'java' }, { action: 'get', path: 'private' }, { action: 'delete' }]) assert.throws(() => check(full, 'mc-server:host-settings', [command]), { code: 'INPUT' })
  check(full, 'mc-server:write-properties', [{ motd: 'Friends' }])
  check(full, 'mc-server:add-op', ['Alice'])
  check({ ...view, readFiles: true }, 'mc-server:history', [{ action: 'get' }])
  check({ ...view, readFiles: true }, 'mc-server:history', [{ action: 'review', id: 'pr' }])
  assert.throws(() => check({ ...view, readFiles: true }, 'mc-server:history', [{ action: 'commentPullRequest', id: 'pr', text: 'comment' }]), { code: 'FORBIDDEN' })
  check({ ...view, readFiles: true, versions: true }, 'mc-server:history', [{ action: 'commentPullRequest', id: 'pr', text: 'comment' }])
  assert.throws(() => check({ ...view, readFiles: true }, 'mc-server:history', [{ action: 'commit' }]), { code: 'FORBIDDEN' })
  assert.throws(() => check({ ...view, readFiles: true, versions: true }, 'mc-server:history', [{ action: 'apply', previewId: 'x' }]), { code: 'FORBIDDEN' })
  assert.throws(() => check(full, 'mc-server:history', [{ action: 'get' }, { id: 'forged-owner' }]), { code: 'INPUT' })
  assert.deepEqual(validateServerPermissions({ start: true }), { ...view, start: true })
  assert.throws(() => validateServerPermissions({ start: 'true' }), { code: 'PERMISSIONS' })
})

test('пути сервера не принимают traversal, устройства Windows, ADS и пустое удаление', () => {
  for (const value of ['../private', '/absolute', 'C:/private', 'config/../private', 'CON', 'a.txt:stream', 'config//test', 'dir.', 'dir\\..\\private']) assert.throws(() => remoteFilePath(value), { code: 'PATH' })
  assert.equal(remoteFilePath('', true), '')
  assert.throws(() => remoteFilePath(''), { code: 'PATH' })
  assert.throws(() => check(serverPermissions(true), 'mc-server:fs-delete', ['']), { code: 'PATH' })
})
