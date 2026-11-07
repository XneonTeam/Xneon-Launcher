import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rename, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { watchBuildContent } = require('../../dist-electron/main/builds/content-watcher.js')
const { contentMetadataEvents } = require('../../dist-electron/main/builds/content-metadata-events.js')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('Изменения контента отслеживаются, посторонние файлы игнорируются, подписка закрывается', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xnlc-content-watch-'))
  let changes = 0
  let close = () => {}
  const changed = async action => {
    const before = changes
    await action()
    for (let n = 0; n < 40 && changes === before; n++) await wait(50)
    assert.ok(changes > before)
  }
  try {
    await mkdir(path.join(root, 'mods'))
    close = watchBuildContent(root, () => changes++, 80)
    await changed(() => writeFile(path.join(root, 'mods', 'example.jar'), 'mod'))
    await changed(() => rename(path.join(root, 'mods', 'example.jar'), path.join(root, 'mods', 'example.jar.disabled')))
    await changed(() => unlink(path.join(root, 'mods', 'example.jar.disabled')))
    await wait(150)
    const before = changes
    await writeFile(path.join(root, 'latest.log'), 'log')
    await wait(200)
    assert.equal(changes, before)
    await changed(async () => {
      await mkdir(path.join(root, 'resourcepacks'))
      await writeFile(path.join(root, 'resourcepacks', 'pack.zip'), 'pack')
    })
    await changed(async () => {
      contentMetadataEvents.emit('updated', [path.join(root, 'mods', 'example.jar')])
    })
    await wait(150)
    const last = changes
    close()
    await writeFile(path.join(root, 'mods', 'other.jar'), 'mod')
    await wait(200)
    assert.equal(changes, last)
  } finally {
    close()
    await rm(root, { recursive: true, force: true })
  }
})
