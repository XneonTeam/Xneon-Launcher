import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest, diff, merge, manifestHash } from '../lib/index.js'
import { manifest, metadata, hash } from './helpers.mjs'

export const launchSettings = { javaOverride: true, java: { path: 'C:/Java/bin/java.exe', major: 21, vendor: 'Adoptium' }, memoryMin: '1G', memoryMax: '6G', javaArgs: '-XX:+UseG1GC', windowOverride: true, windowWidth: 1600, windowHeight: 900, account: { type: 'microsoft', username: 'Alice', uuid: '1234' } }

test('настройки запуска валидируются и входят в хеш; старые публикации остаются совместимыми', async () => {
  const old = manifest(), withSettings = manifest([], { ...metadata, launchSettings: structuredClone(launchSettings) })
  const validated = validateManifest(withSettings)
  assert.deepEqual(validated.instance.launchSettings, launchSettings)
  assert.notEqual(await manifestHash(old, hash), await manifestHash(withSettings, hash))
  withSettings.instance.launchSettings.memoryMax = '8G'
  assert.equal(validated.instance.launchSettings.memoryMax, '6G')
  assert.equal(Object.hasOwn(validateManifest(old).instance, 'launchSettings'), false)
  for (const changes of [{ windowWidth: -1 }, { memoryMax: 'unlimited' }, { javaArgs: 'a\0b' }, { account: { ...launchSettings.account, accessToken: 'must-not-transfer' } }, { preLaunchCommand: 'a\0b' }, { unknown: 'invalid' }]) {
    assert.throws(() => validateManifest(manifest([], { ...metadata, launchSettings: { ...launchSettings, ...changes } })), { code: 'SCHEMA' })
  }
})

test('настройки сравниваются по полям и сливаются с сохранением локальных изменений', () => {
  const base = manifest([], { ...metadata, launchSettings })
  const current = manifest([], { ...metadata, launchSettings: { ...launchSettings, memoryMax: '8G' } })
  const incoming = manifest([], { ...metadata, launchSettings: { ...launchSettings, windowWidth: 1920 } })
  assert.deepEqual(diff(base, current).map(entry => entry.path), ['@instance/launchSettings/memoryMax'])
  const merged = merge(base, current, incoming)
  assert.equal(merged.conflicts.length, 0)
  assert.equal(merged.manifest.instance.launchSettings.memoryMax, '8G')
  assert.equal(merged.manifest.instance.launchSettings.windowWidth, 1920)
  const conflicting = manifest([], { ...metadata, launchSettings: { ...launchSettings, memoryMax: '10G' } })
  assert.equal(merge(base, current, conflicting).conflicts[0].path, '@instance/launchSettings/memoryMax')
  assert.equal(merge(base, current, conflicting, { '@instance/launchSettings/memoryMax': 'incoming' }).manifest.instance.launchSettings.memoryMax, '10G')
  assert.deepEqual(merge(manifest(), manifest(), base).manifest.instance.launchSettings, launchSettings)
  const extended = manifest([], { ...metadata, launchSettings: { ...launchSettings, serverOverride: true, server: 'play.example.org' } })
  const updatedClient = manifest([], { ...metadata, launchSettings: { ...launchSettings, serverOverride: false, server: '' } })
  const upgrade = merge(base, updatedClient, extended)
  assert.equal(upgrade.conflicts.length, 0)
  assert.equal(upgrade.manifest.instance.launchSettings.server, 'play.example.org')
})
