import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import filesModule from '../../dist-electron/main/remote-servers/files.js'

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
