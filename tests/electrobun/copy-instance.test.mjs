import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import copyModule from '../../dist-electrobun-tests/main/builds/copy-instance.js'
const { copyInstanceDirectory } = copyModule

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-copy-instance-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'custom-location', 'original')
  await fs.mkdir(source, { recursive: true })
  return { root, source, target: path.join(root, 'intents', 'copy') }
}

test('duplicate: copies mods, disabled files, resource packs, shaders, configs and worlds independently', async t => {
  const { source, target } = await fixture(t)
  const files = ['mods/a.jar', 'mods/nested/b.jar.disabled', 'resourcepacks/pack.zip', 'resourcepacks/folder/pack.mcmeta', 'shaderpacks/shader.zip', 'config/options.toml', 'saves/world/level.dat']
  for (const file of [...files, '.xnlc-share/transaction-123/journal.json']) {
    await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true })
    await fs.writeFile(path.join(source, file), file)
  }
  await copyInstanceDirectory(source, target)
  for (const file of files) assert.equal(await fs.readFile(path.join(target, file), 'utf8'), file)
  await assert.rejects(fs.stat(path.join(target, '.xnlc-share')), { code: 'ENOENT' })
  await fs.writeFile(path.join(target, files[0]), 'changed copy')
  assert.equal(await fs.readFile(path.join(source, files[0]), 'utf8'), files[0])
})

test('duplicate: existing destination and source are never overwritten or removed', async t => {
  const { source, target } = await fixture(t)
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'keep.txt'), 'existing')
  await assert.rejects(copyInstanceDirectory(source, target), { code: 'EEXIST' })
  assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'existing')
  await assert.rejects(copyInstanceDirectory(source, source), /itself/)
  await assert.rejects(copyInstanceDirectory(source, path.join(source, 'nested-copy')), /itself/)
  assert.ok((await fs.stat(source)).isDirectory())
})

test('duplicate: old junctions become independent directories; failed copy leaves no partial instance', async t => {
  const { root, source, target } = await fixture(t)
  const shared = path.join(root, 'old-shared-files')
  await fs.mkdir(shared); await fs.writeFile(path.join(shared, 'a.jar'), 'original')
  await fs.symlink(shared, path.join(source, 'mods'), 'junction')
  await copyInstanceDirectory(source, target)
  assert.equal((await fs.lstat(path.join(target, 'mods'))).isSymbolicLink(), false)
  await fs.writeFile(path.join(target, 'mods/a.jar'), 'changed')
  assert.equal(await fs.readFile(path.join(shared, 'a.jar'), 'utf8'), 'original')
  const broken = path.join(root, 'broken-source')
  await fs.mkdir(broken)
  await fs.symlink(path.join(root, 'missing-directory'), path.join(broken, 'broken'), 'junction')
  const failed = path.join(root, 'failed-copy')
  await assert.rejects(copyInstanceDirectory(broken, failed))
  await assert.rejects(fs.stat(failed), { code: 'ENOENT' })
})
