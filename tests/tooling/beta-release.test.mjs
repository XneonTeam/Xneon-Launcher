import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'


test('beta запускает только prerelease workflow и собирает независимый portable', async () => {
  const stable = Bun.YAML.parse(await fs.readFile('.github/workflows/release.yml', 'utf8'))
  const beta = Bun.YAML.parse(await fs.readFile('.github/workflows/pre-release.yml', 'utf8'))
  assert.ok(stable.on.push.tags.includes('!v*-beta*'))
  assert.ok(beta.on.push.tags.includes('v*-beta*'))
  assert.ok(beta.jobs.build.steps.some(step => step.run?.includes('package-windows-portable.ts checked-portable')))
  assert.ok(beta.jobs.build.steps.some(step => step.with?.name === 'native-win-x64-portable'))
})

test('загрузки beta содержат SDK, portable и встроенную иконку Windows', async () => {
  const { releaseNotes } = await import('../../scripts/release-notes.ts')
  const body = releaseNotes('1.0.8-beta1', [])
  const main = body.split('<details>')[0]
  assert.match(main, /SDK_Setup-x64/)
  assert.match(main, /Portable-x64/)
  assert.match(main, /logo=data%3Aimage%2Fsvg%2Bxml/)
  assert.match(main, /1\.0\.8-beta1-win-x64-portable\.zip/)
})
