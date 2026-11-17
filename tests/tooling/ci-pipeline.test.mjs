import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadReactModule } from '../helpers/react-module.mjs'
import { appIdentifier } from '../../electrobun/main/app-identity.ts'

const root = path.resolve(import.meta.dir, '../..')
const pipeline = () => import('../../scripts/ci-pipeline.ts')
const repository = 'MAINER4IK/Xneon-Launcher-bun'
test('имена установщиков содержат версию, а технические имена SDK не меняются', async () => {
  const { publicationNames } = await pipeline()
  for (const version of ['1.2.3', '1.2.3-pre1']) {
    const names = publicationNames(version)
    assert.ok(names.includes(`xneon-launcher-${version}-mac-arm64.dmg`))
    assert.ok(names.includes(`xneon-launcher-${version}-mac-x64.dmg`))
    assert.ok(names.includes(`xneon-launcher-${version}-win-x64-setup.zip`))
    assert.ok(names.includes(`xneon-launcher-${version}-linux-x64-setup.tar.gz`))
    assert.ok(!names.some(name => /XneonLauncher.*(?:\.dmg|Setup.*\.zip|Setup\.tar\.gz)$/.test(name)))
  }
})
test('macOS связывает metadata wrapper с проверенным manifest и версией пакета', async t => {
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/macos-bundle-version-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'metadata.json')
  const manifestFile = path.join(directory, 'update-v2.json')
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
  for (const [workflowFile, channel] of [['release.yml', 'stable'], ['pre-release.yml', 'canary']]) {
    const workflow = Bun.YAML.parse(await fs.readFile(path.join(root, '.github/workflows', workflowFile), 'utf8'))
    const step = workflow.jobs.build.steps.find(step => step.name === 'Verify native macOS image and application bundle')
    const check = step.run.split('\n').find(line => line.includes('BUNDLE_METADATA_FILE='))
    assert.ok(check, 'Wrapper metadata must match the validated SDK manifest')
    const code = /bun -e '(.+)'$/.exec(check)?.[1]
    assert.ok(code, 'Expected an executable version check')
    const metadata = { identifier: appIdentifier, channel, hash: 'fixture123' }
    for (const [manifestPatch, metadataPatch, valid] of [[{}, {}, true], [{version: '0.0.0'}, {}, false], [{}, {hash: 'different'}, false], [{}, {identifier: 'other.app'}, false], [{}, {channel: null}, false]]) {
      await fs.writeFile(file, JSON.stringify({ ...metadata, ...metadataPatch }))
      await fs.writeFile(manifestFile, JSON.stringify({ ...metadata, version, ...manifestPatch }))
      const result = spawnSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8', env: { ...process.env, BUN_OPTIONS: '--no-env-file', BUNDLE_METADATA_FILE: file, UPDATE_MANIFEST_FILE: manifestFile } })
      if (valid) assert.equal(result.status, 0, result.stderr)
      else assert.notEqual(result.status, 0)
    }
  }
})

test('NSIS setup сохраняет полный путь при единственном найденном или установленном кандидате', { skip: process.platform !== 'win32' }, async () => {
  const source = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8')
  const workflow = Bun.YAML.parse(source)
  const step = workflow.jobs.build.steps.find(step => step.name === 'Ensure NSIS')
  assert.ok(step?.run.includes('& $candidates[0] /VERSION'))
  for (const installed of [false, true]) {
    const expected = path.win32.join(installed ? process.env['ProgramFiles(x86)'] : process.env.ProgramFiles, 'NSIS', 'makensis.exe')
    const quoted = expected.replaceAll("'", "''")
    const script = `
      $script:installed = $false
      function Test-Path { param([string]$LiteralPath) return ($LiteralPath -eq '${quoted}' -and (${installed ? '$script:installed' : '$true'})) }
      function Add-Content { param($LiteralPath, $Value) }
      function choco { $script:installed = $true; $global:LASTEXITCODE = 0 }
      ${step.run.replace('& $candidates[0] /VERSION', 'ConvertTo-Json -InputObject $candidates[0] -Compress')}
    `
    const result = Bun.spawnSync(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], { stdout: 'pipe', stderr: 'pipe' })
    assert.equal(result.exitCode, 0, result.stderr.toString())
    assert.equal(JSON.parse(result.stdout.toString().trim()), expected)
  }
})

test('обычный tag создаёт stable release, -preN создаёт prerelease; чужой repo/ref/version запрещены', async () => {
  const { releaseIdentity } = await pipeline()
  assert.deepEqual(releaseIdentity('refs/tags/v1.2.3', '1.2.3', repository), { tag: 'v1.2.3', version: '1.2.3', prerelease: false })
  assert.deepEqual(releaseIdentity('refs/tags/v1.2.3-pre2', '1.2.3-pre2', repository), { tag: 'v1.2.3-pre2', version: '1.2.3-pre2', prerelease: true })
  for (const args of [
    ['refs/heads/main', '1.2.3', repository], ['refs/tags/v1.2.4', '1.2.3', repository],
    ['refs/tags/v1.2.3', '1.2.3', 'fork/repo'], ['refs/tags/v1.2.3-pre0', '1.2.3-pre0', repository],
  ]) assert.throws(() => releaseIdentity(...args))
})

test('публикация допускает только native + NSIS + portable + подписи, checksums привязаны к точным байтам', async t => {
  const { publicationNames, checksumText, verifyChecksums } = await pipeline()
  const names = publicationNames('1.2.3')
  for (const name of ['xneon-launcher-1.2.3-win-x64.exe', 'xneon-launcher-1.2.3-win-x64-portable.zip', 'xneon-launcher-1.2.3-mac-arm64.dmg', 'xneon-launcher-1.2.3-linux-x64-setup.tar.gz']) assert.ok(names.includes(name), name)
  for (const name of ['xneon-launcher-1.2.3-amd64.deb', 'xneon-launcher-1.2.3-x86_64.rpm', 'xneon-launcher-1.2.3-x86_64.pacman', 'xneon-launcher-1.2.3-x86_64.AppImage', 'xneon-launcher-1.2.3-x64.tar.xz']) assert.ok(names.includes(name), name)
  assert.ok(!names.some(name => /latest|blockmap/.test(name)))
  assert.ok(!names.some(name => name.startsWith('canary-')), 'Стабильный релиз не содержит canary-файлов')
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/ci-hashes-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.writeFile(path.join(directory, 'file.zip'), 'original')
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), await checksumText(directory, ['file.zip']))
  await verifyChecksums(directory, ['file.zip'])
  await fs.appendFile(path.join(directory, 'file.zip'), 'tampered')
  await assert.rejects(verifyChecksums(directory, ['file.zip']), /checksum/i)
  await fs.writeFile(path.join(directory, 'extra'), 'unexpected')
  await assert.rejects(verifyChecksums(directory, ['file.zip']), /Unexpected/i)
})

test('prerelease публикует canary и независимый portable: без NSIS и stable-подписи', async () => {
  const { publicationNames, releaseChannel, assertReleaseChannel } = await pipeline()
  assert.equal(releaseChannel('1.2.3'), 'stable')
  assert.equal(releaseChannel('1.2.3-pre1'), 'canary')
  assertReleaseChannel('1.2.3', 'stable')
  assertReleaseChannel('1.2.3-pre1', 'canary')
  assert.throws(() => assertReleaseChannel('1.2.3', 'canary'), /cannot build/)
  assert.throws(() => assertReleaseChannel('1.2.3-pre1', 'stable'), /cannot build/)
  const names = publicationNames('1.2.3-pre1')
  for (const name of ['canary-win-x64-update-v2.json', 'canary-win-x64-XneonLauncher-canary.tar.zst', 'xneon-launcher-1.2.3-pre1-win-x64-setup.zip', 'xneon-launcher-1.2.3-pre1-mac-arm64.dmg', 'xneon-launcher-1.2.3-pre1-linux-x64-setup.tar.gz']) assert.ok(names.includes(name), name)
  assert.ok(!names.some(name => name.startsWith('stable-')), 'Prerelease не содержит stable-файлов')
  assert.ok(!names.some(name => name.endsWith('-win-x64.exe')), 'Prerelease не содержит NSIS-установщик')
  assert.ok(names.includes('xneon-launcher-1.2.3-pre1-win-x64-portable.zip'), 'Portable доступен в canary')
  assert.ok(names.includes('xneon-launcher-1.2.3-pre1-amd64.deb'), 'Canary тоже публикует системные Linux-пакеты')
})

test('release и pre-release — отдельные пайплайны со своими каналами, CI только проверяет', async () => {
  assert.deepEqual((await fs.readdir(path.join(root, '.github/workflows'))).sort(),
    ['ci.yml', 'pre-release.yml', 'release.yml'],
    'Validation, stable release and prerelease workflows only')
  const load = async file => Bun.YAML.parse(await fs.readFile(path.join(root, '.github/workflows', file), 'utf8'))
  const ci = await load('ci.yml')
  assert.ok(ci.on.push.branches.includes('main'))
  assert.ok(Object.hasOwn(ci.on, 'pull_request') && Object.hasOwn(ci.on, 'workflow_dispatch'))
  assert.ok(!ci.on.push.tags, 'Tags must not run the validation-only workflow')
  assert.deepEqual(Object.keys(ci.jobs), ['tests'])

  const release = await load('release.yml')
  const prerelease = await load('pre-release.yml')
  assert.deepEqual(release.on.push.tags, ['v*', '!v*-pre*', '!v*-beta*'], 'Prerelease не создаёт пустой Release run')
  assert.deepEqual(prerelease.on.push.tags, ['v*-pre*', 'v*-beta*'])
  assert.equal(release.env.CHANNEL, 'stable')
  assert.equal(prerelease.env.CHANNEL, 'canary')
  for (const [workflow, script] of [[release, 'ci-release.ts'], [prerelease, 'ci-pre-release.ts']]) {
    assert.deepEqual(Object.keys(workflow.jobs), ['tests', 'build', 'release'])
    assert.ok(workflow.jobs.tests.steps.some(step => step.run === `bun scripts/${script} channel`), 'Каждый пайплайн сначала проверяет свой канал')
    assert.ok(workflow.jobs.tests.steps.some(step => step.run === `bun scripts/${script} guard-tag`), 'Check tag ancestry before entering the protected job')
    const releaseSteps = workflow.jobs.release.steps
    const commands = releaseSteps.map(step => step.run ?? '')
    const candidates = releaseSteps.find(step => step.uses === 'actions/download-artifact@v8')?.with?.path
    assert.ok(candidates)
    assert.ok(commands.includes(`bun scripts/${script} check ` + candidates))
    assert.ok(commands.includes(`bun scripts/${script} assemble ` + candidates + ' verified'))
    const check = commands.findIndex(command => command.includes(script + ' check'))
    const assemble = commands.findIndex(command => command.includes(script + ' assemble'))
    const publish = releaseSteps.findIndex(step => step.uses === 'softprops/action-gh-release@v2')
    assert.ok(check >= 0 && check < assemble && assemble < publish)
    assert.equal(workflow.jobs.release.permissions.contents, 'write')
  }
  const step = (workflow, job, name) => workflow.jobs[job].steps.find(item => item.name === name)
  assert.equal(step(release, 'build', 'Build stable native artifacts (NSIS on Windows only)').run, 'bun run build')
  assert.equal(step(prerelease, 'build', 'Build canary native artifacts').run, 'bun run build:canary')
  assert.ok(step(release, 'build', 'Ensure NSIS'), 'NSIS остаётся в стабильном канале')
  assert.ok(!step(prerelease, 'build', 'Ensure NSIS'), 'Пререлиз не ставит NSIS')
  assert.ok(step(release, 'build', 'Build and validate independent Portable profile'), 'Portable — stable')
  assert.ok(step(prerelease, 'build', 'Build and validate independent Portable profile'), 'Пререлиз тоже собирает portable')
  assert.ok(step(release, 'build', 'Build Linux distribution packages'), 'deb/rpm/pacman/AppImage/tar.xz')
  assert.ok(step(prerelease, 'build', 'Build Linux distribution packages'), 'canary тоже собирает системные пакеты')
  const publish = 'Publish only verified native artifacts'
  assert.equal(step(release, 'release', publish).with.prerelease, false)
  assert.equal(step(release, 'release', publish).with.make_latest, true)
  assert.equal(step(prerelease, 'release', publish).with.prerelease, true)
  assert.equal(step(prerelease, 'release', publish).with.make_latest, false)
  for (const workflow of [release, prerelease]) {
    assert.equal(workflow.jobs.build.needs, 'tests')
    assert.deepEqual(workflow.jobs.release.needs, ['tests', 'build'])
    assert.equal(workflow.jobs.build.strategy.matrix.include.length, 4)
    assert.equal(workflow.jobs.build.strategy['fail-fast'], false)
    assert.equal(workflow.jobs.build.strategy['max-parallel'], 3)
    assert.ok(workflow.jobs.build.strategy.matrix.include.some(item => item.target === 'macos-arm64' && item.runner === 'macos-26' && item.arch === 'arm64' && item.machine === 'arm64'), 'ARM64 uses the documented macos-26 pool without relaxing architecture validation')
    assert.ok(workflow.jobs.build.steps.some(item => item.if === "runner.os != 'Linux'" &&
      item.run?.includes('tests/electrobun/platform-desktop.test.ts') &&
      item.run.includes('tests/electrobun/platform-secrets.test.ts') &&
      item.run.includes('tests/electrobun/platform-unix.test.ts') &&
      item.run.includes('PE metadata')), 'Windows/macOS native cases skipped on Ubuntu must run on their real targets')
  }
})



test('release guard поддерживает оба вида tags, запрещает moved tag, чужую ветку и перезапись релиза', async () => {
  const sha = 'a'.repeat(40)
  const env = { GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/tags/v1.2.3', GITHUB_SHA: sha, GH_TOKEN: 'fixture-not-a-secret' }
  let annotated = true, comparison = 'ahead', commit = sha, existing = 404
  const release = loadReactModule(new URL('../../scripts/ci-pipeline.ts', import.meta.url), {
    '../package.json': { version: '1.2.3' },
  }, { Bun, Buffer, process: { env }, fetch: async url => {
    const resource = url.split('/repos/' + repository + '/')[1]
    if (resource === 'releases/tags/v1.2.3') return { status: existing }
    const responses = {
      'git/ref/tags/v1.2.3': { object: { type: annotated ? 'tag' : 'commit', sha: commit } },
      ['git/tags/' + commit]: { object: { type: 'commit', sha: commit } },
      [`compare/${commit}...main`]: { status: comparison },
    }
    assert.ok(Object.hasOwn(responses, resource), resource)
    return { ok: true, json: async () => responses[resource] }
  } })
  await release.guardReleaseTag()
  annotated = false
  await release.guardReleaseTag()
  existing = 200
  await assert.rejects(release.guardReleaseTag(), /already exists/)
  existing = 404
  comparison = 'diverged'
  await assert.rejects(release.guardReleaseTag(), /reachable from main/)
  comparison = 'ahead'
  commit = 'b'.repeat(40)
  await assert.rejects(release.guardReleaseTag(), /moved/)
  commit = sha
  env.GITHUB_REPOSITORY = 'fork/repo'
  await assert.rejects(release.guardReleaseTag())
})

test('общие transport hashes потоковые, детерминированы и не принимают ссылки или недопустимые имена', async t => {
  const { artifactChecksums, checksumText, formatChecksums, verifyChecksums } = await import('../../scripts/artifact-checksums.ts')
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/artifact-hashes-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.writeFile(path.join(directory, 'b.zip'), 'second')
  await fs.writeFile(path.join(directory, 'a.zip'), 'first')
  const expected = ['a.zip', 'b.zip'].map((file, index) => createHash('sha256').update(index ? 'second' : 'first').digest('hex') + '  ' + file).join('\n') + '\n'
  const entries = await artifactChecksums(directory, ['b.zip', 'a.zip'])
  assert.deepEqual(entries.map(item => [item.file, item.size]), [['a.zip', 5], ['b.zip', 6]])
  assert.equal(formatChecksums(entries), expected)
  assert.equal(await checksumText(directory, ['b.zip', 'a.zip']), expected)
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), expected)
  await verifyChecksums(directory, ['a.zip', 'b.zip'])
  for (const file of ['../outside', 'a\n.zip', 'a\\b.zip', '/absolute.zip']) await assert.rejects(checksumText(directory, [file]), /Invalid checksum path/)
  await assert.rejects(checksumText(directory, ['a.zip', 'a.zip']), /Duplicate/)
  await fs.writeFile(path.join(directory, 'empty.zip'), '')
  await assert.rejects(checksumText(directory, ['empty.zip']), /Invalid artifact/)
  await assert.rejects(checksumText(directory, ['missing.zip']))
  await fs.mkdir(path.join(directory, 'folder'))
  await assert.rejects(checksumText(directory, ['folder']), /Invalid artifact/)
  // Junction работает и без Windows Developer Mode; Unix получает symlink.
  await fs.symlink(path.join(directory, 'folder'), path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(checksumText(directory, ['linked']), /Invalid artifact/)
  await assert.rejects(verifyChecksums(directory, ['a.zip', 'b.zip']), /Unexpected/)
})
