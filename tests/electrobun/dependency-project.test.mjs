import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { dependencyProjectId } = require('../../dist-electrobun-tests/main/builds/dependency-project.js')
test('Модули Fabric API сопоставляются с общим проектом, остальные моды сохраняют собственный id', () => {
  assert.equal(dependencyProjectId('fabric-resource-loader-v0'), 'fabric-api')
  assert.equal(dependencyProjectId('fabric-resource-loader-v1'), 'fabric-api')
  assert.equal(dependencyProjectId('fabric-api-base'), 'fabric-api')
  assert.equal(dependencyProjectId('fabric-language-kotlin'), 'fabric-language-kotlin')
  assert.equal(dependencyProjectId('sodium'), 'sodium')
})
