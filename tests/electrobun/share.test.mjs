import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import worktreeModule from '../../dist-electrobun-tests/main/share/worktree.js'
const { ShareWorktree } = worktreeModule

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
