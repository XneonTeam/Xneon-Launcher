import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from "./transpile.mjs"
const source = fs.readFileSync(new URL('../../lib/datapack-version.ts', import.meta.url), 'utf8')
const { datapackVersionFile } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))

test('Датапаки: JAR-версии модов отсекаются, ZIP выбирается из списка файлов', () => {
  assert.equal(datapackVersionFile({ loaders: ['fabric'], fileName: 'mod.jar' }), null)
  assert.equal(datapackVersionFile({ loaders: ['forge'], fileName: 'archive.zip' }), null)
  assert.deepEqual(datapackVersionFile({ loaders: ['datapack'], fileName: 'mod.jar', files: [{ filename: 'mod.jar', url: 'jar' }, { filename: 'pack.zip', url: 'zip' }] }), { fileName: 'pack.zip', downloadUrl: 'zip' })
  assert.deepEqual(datapackVersionFile({ loaders: [], fileName: 'pack.zip', downloadUrl: 'cf' }), { fileName: 'pack.zip', downloadUrl: 'cf' })
  assert.equal(datapackVersionFile({ loaders: ['datapack'], fileName: 'mod.jar' }), null)
})
