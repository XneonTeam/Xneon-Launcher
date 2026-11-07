import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as domain from '../../packages/xnlc-share/lib/index.js'
import { MemoryFiles, hash, metadata } from '../../packages/xnlc-share/tests/helpers.mjs'
import launchModule from '../../dist-electron/main/share/launch-settings.js'

import './share-launch-settings.test.mjs'

test('локальный запуск не блокируется фоновой операцией Share или недоступным сервисом', async () => {
  const code = await fs.readFile(new URL('../../dist-electron/main/share/service.js', import.meta.url), 'utf8')
  const nativeRequire = createRequire(new URL('../../dist-electron/main/share/service.js', import.meta.url))
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const session = new Promise(resolve => { release = resolve })
  const mocks = {
    '../../db': { dbHelpers: { findBuildById: async id => ({ id, name: 'Local' }) } },
    '../../db/share': { getShareBinding: () => null },
    './auth': { shareSession: async () => { entered(); return session } },
    '../builds/helpers': {}, '../minecraft-core': {}, './worktree': {}, '../system': {},
    '../builds/scanner': {}, '../runtime': {}, './links': {}, './content-presentation': {},
  }
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => name in mocks ? mocks[name] : nativeRequire(name), Buffer, process: { env: {} } })
  const status = exports.executeShare({ action: 'status', buildId: 'local' }, () => {})
  await started
  try {
    const result = await exports.executeShare({ action: 'checkLaunch', buildId: 'local' }, () => {})
    assert.deepEqual(Object.keys(result), [])
  } finally { release({ configured: false, signedIn: false }); await status }
  const result = await exports.executeShare({ action: 'checkLaunch', buildId: 'local' }, () => {})
  assert.deepEqual(Object.keys(result), [])
})
