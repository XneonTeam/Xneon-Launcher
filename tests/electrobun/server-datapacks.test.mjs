import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { serverDatapackDirectory, installServerDatapack, deleteServerDatapack, validateDatapack } = require('../../dist-electrobun-tests/main/server-datapacks.js')
const fixture = async run => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-datapacks-'))
  try { await run(root) } finally { await fs.rm(root, { recursive: true, force: true }) }
}
const pack = (prefix = '') => {
  const zip = new AdmZip()
  zip.addFile(prefix + 'pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 48, description: 'Test' } })))
  zip.addFile(prefix + 'data/test/function/main.mcfunction', Buffer.from('say test'))
  return zip.toBuffer()
}
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
  assert.throws(() => validateDatapack(pack('wrapper/')))
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
