import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
for (const channel of ['db:update-build-fields', 'db:save-builds']) test(`${channel}: импорт, начавшийся во время await, не пропускает старую запись`, async () => {
  const handlers = new Map(), writes = []
  let busy = false
  const module = { exports: {} }
  const dependencies = {
    './settings-handlers': { registerSettingsHandlers() {} },
    './account-service': { registerAccountHandlers() {} },
    './builds/modpack-persistence': { assertBuildMetadataIdle: () => { if (busy) throw new Error('MODPACK_BUSY') } },
    './external-links': {}, './errors': {}, './runtime': {}, './import': {}, './java-discovery': {}, '@xnlc/core/retry': {},
    '../platform/desktop': { rpcRegistry: { handle: (name, handler) => handlers.set(name, handler) } },
    './builds/helpers': { isLoaderSelectionFieldChange: () => true, cleanupReplacedLoaderArtifacts: async () => {}, cleanupReplacedLoaderArtifactsForBuilds: async () => {} },
    '../db': { dbHelpers: {
      findBuildById: async () => { busy = true; return { id: 'build', name: 'Pack' } },
      loadBuildsLight: async () => { busy = true; return [] },
      updateBuildFields: async (...args) => writes.push(args), saveAllBuilds: async (...args) => writes.push(args),
    } },
  }
  const source = fs.readFileSync(new URL('../../electrobun/main/system.ts', import.meta.url), 'utf8')
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports,
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      assert.ok(['os', 'path', 'fs/promises', 'url'].includes(name), name)
      return require(name)
    },
  })
  module.exports.registerSystemHandlers()
  const handler = handlers.get(channel)
  const operation = channel === 'db:save-builds' ? handler(null, [{ id: 'build', version: 'old' }]) : handler(null, 'build', { version: 'old' })
  await assert.rejects(operation, /MODPACK_BUSY/)
  assert.deepEqual(writes, [])
})
