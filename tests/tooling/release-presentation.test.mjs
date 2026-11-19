import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

test('кеш и артефакты используют версии Actions под Node.js 24', async () => {
  const setup = Bun.YAML.parse(await fs.readFile('.github/actions/setup/action.yml', 'utf8'))
  assert.ok(setup.runs.steps.some(step => step.uses === 'actions/cache@v6'))
  for (const file of ['release.yml', 'pre-release.yml']) {
    const workflow = Bun.YAML.parse(await fs.readFile(`.github/workflows/${file}`, 'utf8'))
    const uses = Object.values(workflow.jobs).flatMap(job => job.steps ?? []).map(step => step.uses).filter(Boolean)
    assert.ok(uses.includes('actions/upload-artifact@v7'))
    assert.ok(uses.includes('actions/download-artifact@v8'))
    assert.ok(!uses.some(action => /actions\/(?:upload|download)-artifact@v[1-5]$/.test(action)))
  }
})

test('описания релизов содержат Features, Bug Fixes и только существующие загрузки', async () => {
  const { releaseNotes } = await import('../../scripts/release-notes.ts')
  for (const version of ['1.0.9-pre1', '1.0.9']) {
    const body = releaseNotes(version, ['feat: Новая возможность', 'fix: Исправление'])
    assert.match(body, /### Features/)
    assert.match(body, /### Bug Fixes/)
    assert.match(body, /img.shields.io/)
    assert.match(body, new RegExp(`releases/download/v${version}/`))
    assert.doesNotMatch(body, /logo=apple|logo=linux|### macOS|### Linux/)
    assert.equal(body.includes(`xneon-launcher-${version}-win-x64.exe`), true, 'NSIS есть в обоих каналах')
    assert.ok(body.includes('portable.zip'))
  }
})

test('показываются только доступные загрузки Windows, служебные файлы свёрнуты, RED/GREEN не попадает в описание', async () => {
  const { releaseNotes } = await import('../../scripts/release-notes.ts')
  const body = releaseNotes('1.0.9', ['fix: Исправление (GREEN)'])
  assert.ok(body.startsWith('## Downloads'))
  assert.ok(body.indexOf('### Windows') < body.indexOf('### Features'))
  assert.doesNotMatch(body, /### macOS|### Linux/)
  assert.ok(body.indexOf('-win-x64.exe)') < body.indexOf('-portable.zip)'))
  assert.ok(body.indexOf('<details>') > body.indexOf('### Bug Fixes'))
  assert.ok(body.indexOf('stable-win-x64-update-v2.json') > body.indexOf('<details>'))
  assert.doesNotMatch(body, /\(GREEN\)|\(RED\)/)
  const main = body.split('<details>')[0]
  assert.doesNotMatch(main, /Setup\.zip|Setup\.tar\.gz|update-v2\.json/)
  const prerelease = releaseNotes('1.0.9-pre1', [])
  assert.ok(prerelease.split('<details>')[0].includes('xneon-launcher-1.0.9-pre1-win-x64-setup.zip'))
})

test('git-cliff не требуется ни одному каналу', async () => {
  for (const file of ['release.yml', 'pre-release.yml']) {
    const workflow = await fs.readFile(`.github/workflows/${file}`, 'utf8')
    assert.doesNotMatch(workflow, /git-cliff/)
    assert.match(workflow, /scripts\/release-notes.ts/)
  }
})

test('публикация использует проверенный существующий тег без лишнего target_commitish', async () => {
  for (const file of ['release.yml', 'pre-release.yml']) {
    const workflow = Bun.YAML.parse(await fs.readFile(`.github/workflows/${file}`, 'utf8'))
    const steps = workflow.jobs.release.steps
    const publish = steps.findIndex(step => step.name === 'Publish only verified native artifacts')
    assert.ok(publish > 0)
    assert.equal(steps[publish].with.tag_name, '${{ steps.release.outputs.tag }}')
    assert.ok(!Object.hasOwn(steps[publish].with, 'target_commitish'))
    assert.match(steps[publish - 1].run, /guard-tag/)
  }
})

test('браузерный export Share не включает обработчик архивов', async () => {
  const pkg = JSON.parse(await fs.readFile('packages/xnlc-share/package.json', 'utf8'))
  assert.equal(pkg.exports['.'].browser, './lib/browser.js')
  const browser = await fs.readFile('packages/xnlc-share/src/browser.ts', 'utf8')
  assert.doesNotMatch(browser, /object-policy|@xnlc\/archives|node:/)
})

test('Vite разрешает Share для renderer без Node и архивного пакета', async () => {
  const { build } = await import('vite')
  await fs.mkdir('.tmp', { recursive: true })
  const directory = await fs.mkdtemp(path.resolve('.tmp/share-browser-'))
  try {
    const entry = path.join(directory, 'entry.ts')
    await fs.writeFile(entry, 'export { branchHistory, diff, MAX_FILE_BYTES, SERVER_PERMISSION_KEYS, serverPermissions } from "@xnlc/share"')
    await build({
      configFile: false, logLevel: 'silent',
      build: { write: false, lib: { entry, formats: ['es'] } },
      plugins: [{ name: 'verify-renderer-boundary', buildEnd() {
        const ids = [...this.getModuleIds()]
        assert.ok(ids.some(id => id.replaceAll('\\', '/').endsWith('/xnlc-share/lib/browser.js')))
        assert.ok(!ids.some(id => /xnlc-archives|__vite-browser-external|^node:/.test(id)), ids.join('\n'))
      } }],
    })
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('канал задаёт сборка: версия определяет канал, а канал — отображаемую ветку UI', async () => {
  const { installedPreference, releaseChannelOf } = await import('../../electrobun/main/verified-update-feed.ts')
  assert.equal(releaseChannelOf('1.0.9-pre1'), 'canary')
  assert.equal(releaseChannelOf('1.0.9-beta2'), 'canary')
  assert.equal(releaseChannelOf('1.0.9'), 'stable')
  assert.equal(installedPreference('canary'), 'beta')
  assert.equal(installedPreference('stable'), 'stable')
})
