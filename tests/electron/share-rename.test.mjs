import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import nameModule from '../../dist-electron/main/share/instance-name.js'

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
