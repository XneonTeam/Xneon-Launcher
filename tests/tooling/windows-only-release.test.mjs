import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { publicationNames } from '../../scripts/ci-pipeline.ts'
import { releaseNotes } from '../../scripts/release-notes.ts'

test('оба канала временно собирают только Windows без signing gate', async () => {
  for (const filename of ['release.yml', 'pre-release.yml']) {
    const workflow = Bun.YAML.parse(await fs.readFile(`.github/workflows/${filename}`, 'utf8'))
    assert.deepEqual(workflow.jobs.build.strategy.matrix.include.map(row => row.target), ['win-x64'])
    assert.deepEqual(workflow.jobs.release.needs, ['tests', 'build'])
  }
})

test('allowlist и release notes не требуют отсутствующих Linux/macOS артефактов', () => {
  for (const version of ['1.0.8', '1.0.8-pre1']) {
    const names = publicationNames(version)
    assert.ok(names.includes(`xneon-launcher-${version}-win-x64-portable.zip`))
    assert.ok(!names.some(name => /linux|macos|\.dmg$|\.deb$|\.rpm$|\.AppImage$/.test(name)))
    const body = releaseNotes(version, ['fix: Windows release'])
    assert.match(body, /### Windows/)
    assert.doesNotMatch(body, /### macOS|### Linux|logo=apple|logo=linux/)
  }
})

test('Ubuntu-тесты не скачивают графический SDK; native-сборка подключает его отдельно', async () => {
  const setup = Bun.YAML.parse(await fs.readFile('.github/actions/setup/action.yml', 'utf8'))
  const runtime = setup.runs.steps.find(step => step.name === 'Linux test prerequisites')
  assert.ok(runtime)
  assert.match(runtime.run, /--no-install-recommends/)
  assert.match(runtime.run, /libsecret-1-0/)
  assert.doesNotMatch(runtime.run, /libgtk-3-dev|libwebkit2gtk-4\.1-dev|libayatana-appindicator3-dev/)
  const native = setup.runs.steps.find(step => step.name === 'Linux native build prerequisites')
  assert.ok(native.if.includes("inputs.linux-native-build == 'true'"))
  assert.match(native.run, /libwebkit2gtk-4\.1-dev/)
})
