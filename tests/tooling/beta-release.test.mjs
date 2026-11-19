import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

test('betaN проходит CI identity, обновления и Windows metadata', async () => {
  const { releaseIdentity, releaseChannel, publicationNames } = await import('../../scripts/ci-pipeline.ts')
  const { compareReleaseVersions } = await import('../../electrobun/main/verified-update-manifest.ts')
  const { releaseChannelOf, installedPreference } = await import('../../electrobun/main/verified-update-feed.ts')
  const { updateBaseUrls } = await import('../../electrobun/main/update-public-keys.ts')
  assert.equal(releaseIdentity('refs/tags/v1.0.8-beta1', '1.0.8-beta1', 'MAINER4IK/Xneon-Launcher-bun').prerelease, true)
  assert.equal(releaseChannel('1.0.8-beta1'), 'canary')
  assert.equal(releaseChannelOf('1.0.8-beta1'), 'canary')
  assert.equal(installedPreference('canary'), 'beta')
  assert.ok(compareReleaseVersions('1.0.8-beta2', '1.0.8-beta1') > 0)
  assert.ok(compareReleaseVersions('1.0.8-pre1', '1.0.8-beta99') > 0)
  assert.ok(compareReleaseVersions('1.0.8', '1.0.8-beta2') > 0)
  assert.equal(updateBaseUrls.stable, 'https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/latest/download')
  assert.equal(updateBaseUrls.canary, 'https://github.com/MAINER4IK/Xneon-Launcher-bun/releases/download/canary')
  for (const invalid of ['1.0.8-beta0', '1.0.8-beta01', '1.0.8-beta', '1.0.8-rc1']) assert.throws(() => releaseChannel(invalid))
  assert.ok(publicationNames('1.0.8-beta1').includes('xneon-launcher-1.0.8-beta1-win-x64-portable.zip'))
})

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
