import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadReactModule } from '../helpers/react-module.mjs'

const root = path.resolve(import.meta.dir, '../..')
const pipeline = () => import('../../scripts/ci-pipeline.ts')
const { resolveRepositoryIdentity } = await import('../../scripts/repository-identity.ts')
// Репозиторий этой копии: официальный или форк — тест не должен зависеть от владельца.
const repository = resolveRepositoryIdentity()
const read = file => fs.readFile(path.join(root, file), 'utf8')
const workflow = async file => Bun.YAML.parse(await read(`.github/workflows/${file}`))

test('identity, каналы и имена публикаций согласованы между пайплайнами', async () => {
  const { releaseIdentity, releaseChannel, assertReleaseChannel, publicationNames } = await pipeline()
  const { compareReleaseVersions } = await import('../../electrobun/main/verified-update-manifest.ts')
  const { releaseChannelOf, installedPreference } = await import('../../electrobun/main/verified-update-feed.ts')
  const { updateBaseUrls } = await import('../../electrobun/main/repository-identity.ts')
  const { releaseChannelTargets } = await import('../../scripts/verify-signed-update-feed.ts')
  const { releaseTargets } = await import('../../scripts/release-targets.ts')

  assert.deepEqual(releaseIdentity('refs/tags/v1.2.3', '1.2.3', repository), { tag: 'v1.2.3', version: '1.2.3', prerelease: false })
  assert.deepEqual(releaseIdentity('refs/tags/v1.2.3-pre2', '1.2.3-pre2', repository), { tag: 'v1.2.3-pre2', version: '1.2.3-pre2', prerelease: true })
  assert.equal(releaseIdentity('refs/tags/v1.0.8-beta1', '1.0.8-beta1', repository).prerelease, true)
  const foreign = repository === 'XneonTeam/Xneon-Launcher' ? 'fork/repo' : 'XneonTeam/Xneon-Launcher'
  for (const args of [
    ['refs/heads/main', '1.2.3', repository], ['refs/tags/v1.2.4', '1.2.3', repository],
    ['refs/tags/v1.2.3', '1.2.3', foreign], ['refs/tags/v1.2.3-pre0', '1.2.3-pre0', repository],
  ]) assert.throws(() => releaseIdentity(...args))

  assert.equal(releaseChannel('1.2.3'), 'stable')
  for (const [version, channel] of [['1.2.3', 'stable'], ['1.2.3-pre1', 'canary'], ['1.0.8-beta1', 'canary']]) {
    assert.equal(releaseChannel(version), channel)
    assert.equal(releaseChannelOf(version), channel)
    assertReleaseChannel(version, channel)
    assert.throws(() => assertReleaseChannel(version, channel === 'stable' ? 'canary' : 'stable'), /cannot build/)
  }
  assert.equal(installedPreference('canary'), 'beta')
  assert.equal(installedPreference('stable'), 'stable')
  for (const invalid of ['1.0.8-beta0', '1.0.8-beta01', '1.0.8-beta', '1.0.8-rc1']) assert.throws(() => releaseChannel(invalid))
  assert.ok(compareReleaseVersions('1.0.8-beta2', '1.0.8-beta1') > 0)
  assert.ok(compareReleaseVersions('1.0.8-pre1', '1.0.8-beta99') > 0)
  assert.ok(compareReleaseVersions('1.0.8', '1.0.8-beta2') > 0)
  const buildVersion = JSON.parse(await read('package.json')).version
  assert.equal(updateBaseUrls.stable, `https://github.com/${repository}/releases/latest/download`)
  // Canary читает релиз конкретной версии: каждый prerelease публикуется отдельно, rolling-тега canary больше нет.
  assert.equal(updateBaseUrls.canary, `https://github.com/${repository}/releases/download/v${buildVersion}`)

  for (const [version, channel] of [['1.2.3', 'stable'], ['1.2.3-pre1', 'canary']]) {
    const suffix = channel === 'canary' ? '-canary' : ''
    const names = publicationNames(version)
    for (const name of [
      `xneon-launcher-${version}-win-x64.exe`, `xneon-launcher-${version}-win-x64-portable.zip`,
      `xneon-launcher-${version}-win-x64-setup.zip`, `xneon-launcher-${version}-linux-x64-setup.tar.gz`,
      `xneon-launcher-${version}-mac-arm64.dmg`, `xneon-launcher-${version}-amd64.deb`,
      `xneon-launcher-${version}-x86_64.AppImage`, `xneon-launcher-${version}-x86_64.pacman`,
      `xneon-launcher-${version}-x86_64.rpm`, `xneon-launcher-${version}-x64.tar.xz`,
      `${channel}-win-x64-XneonLauncher${suffix}.tar.zst`, `${channel}-linux-x64-XneonLauncher${suffix}.tar.zst`,
      `${channel}-macos-arm64-XneonLauncher${suffix}.app.tar.zst`,
      `${channel}-win-x64-update.json`, `${channel}-win-x64-update.json.sig`,
      `${channel}-win-x64-update-v2.json`, `${channel}-win-x64-update-v2.json.sig`,
      `${channel}-linux-x64-update.json.sig`, `${channel}-macos-arm64-update-v2.json.sig`,
    ]) assert.ok(names.includes(name), name)
    assert.ok(!names.some(name => /latest|blockmap|release-metadata/.test(name)))
    assert.ok(!names.some(name => name.startsWith(channel === 'stable' ? 'canary-' : 'stable-')), 'каналы не смешиваются')
    assert.ok(!names.some(name => /XneonLauncher.*(?:\.dmg|Setup.*\.zip|Setup\.tar\.gz)$/.test(name)), 'технические имена SDK не публикуются')
    assert.deepEqual(releaseChannelTargets(channel), releaseTargets.map(({ platform, arch }) => ({ channel, platform, arch })))
  }
  assert.ok(publicationNames('1.0.8-beta1').includes('xneon-launcher-1.0.8-beta1-win-x64-portable.zip'))
})

test('release и pre-release: раздельные каналы, native targets, подпись и публикация', async () => {
  assert.deepEqual((await fs.readdir(path.join(root, '.github/workflows'))).sort(), ['ci.yml', 'pre-release.yml', 'release.yml'])
  const ci = await workflow('ci.yml')
  const release = await workflow('release.yml')
  const prerelease = await workflow('pre-release.yml')

  assert.ok(ci.on.push.branches.includes('main'))
  assert.ok(Object.hasOwn(ci.on, 'pull_request') && Object.hasOwn(ci.on, 'workflow_dispatch'))
  assert.ok(!ci.on.push.tags, 'Tags must not run the validation-only workflow')
  assert.deepEqual(Object.keys(ci.jobs), ['tests'])
  const ciSource = await read('.github/workflows/ci.yml')
  for (const command of ['bun run prepare:desktop', 'bun run typecheck', 'bun run test:offline:prepared', 'bun scripts/check-config.mjs']) assert.ok(ciSource.includes(command), command)

  assert.deepEqual(release.on.push.tags, ['v*', '!v*-pre*', '!v*-beta*'], 'Prerelease не создаёт пустой Release run')
  assert.deepEqual(prerelease.on.push.tags, ['v*-pre*', 'v*-beta*'])
  assert.equal(release.env.CHANNEL, 'stable')
  assert.equal(prerelease.env.CHANNEL, 'canary')

  const { releaseTargets } = await import('../../scripts/release-targets.ts')
  for (const [doc, script] of [[release, 'ci-release.ts'], [prerelease, 'ci-pre-release.ts']]) {
    assert.deepEqual(Object.keys(doc.jobs), ['tests', 'build', 'build-linux', 'build-macos', 'release'])
    assert.ok(doc.jobs.tests.steps.some(step => step.run === `bun scripts/${script} channel`), 'Каждый пайплайн сначала проверяет свой канал')
    assert.ok(doc.jobs.tests.steps.some(step => step.run === `bun scripts/${script} guard-tag`), 'Check tag ancestry before entering the protected job')
    const steps = doc.jobs.release.steps
    const commands = steps.map(step => step.run ?? '')
    const candidates = steps.find(step => step.uses === 'actions/download-artifact@v8')?.with?.path
    assert.ok(candidates)
    assert.ok(commands.includes(`bun scripts/${script} check ` + candidates))
    assert.ok(commands.includes(`bun scripts/${script} assemble ` + candidates + ' verified'))
    const check = commands.findIndex(command => command.includes(script + ' check'))
    const sign = commands.findIndex(command => command.includes('sign-update-feed.ts'))
    const verify = commands.findIndex(command => command.includes('verify-signed-update-feed.ts'))
    const assemble = commands.findIndex(command => command.includes(script + ' assemble'))
    const publish = steps.findIndex(step => step.uses === 'softprops/action-gh-release@v2')
    assert.ok(check >= 0 && check < sign && sign < verify && verify < assemble && assemble < publish)
    assert.equal(steps.filter(step => JSON.stringify(step).includes('secrets.')).length, 1)
    assert.equal(doc.jobs.release.environment, 'release-signing')
    assert.equal(doc.jobs.release.permissions.contents, 'write')
    assert.deepEqual(doc.jobs.release.needs, ['tests', 'build', 'build-linux', 'build-macos'])

    const signStep = steps.find(step => step.name?.includes('Sign each published target'))
    assert.ok(signStep, 'Каждый target подписывается в одном защищённом шаге')
    for (const target of releaseTargets) assert.ok(signStep.run.includes(`native-${target.platform}-${target.arch}-`), target.platform)
    assert.ok(steps.some(step => step.run?.includes('verify-signed-update-feed.ts')))

    const step = (job, name) => doc.jobs[job].steps.find(item => item.name === name)
    assert.equal(step('build', doc === release ? 'Build stable Windows artifacts (NSIS)' : 'Build canary native artifacts').run, doc === release ? 'bun run build' : 'bun run build:canary')
    assert.ok(step('build', 'Ensure NSIS'), 'NSIS собирается в обоих каналах: им переключается канал')
    assert.ok(step('build', 'Build and validate independent Portable profile'), 'Portable — отдельный профиль в обоих каналах')
    assert.ok(doc.jobs.build.steps.some(item => item.run?.includes('package-windows-portable.ts checked-portable')))
    assert.ok(doc.jobs.build.steps.some(item => item.with?.name === 'native-win-x64-portable'))
    assert.ok(step('build-linux', 'Build Linux distribution packages'), 'deb/rpm/pacman/AppImage/tar.xz')
    assert.ok(step('build-linux', 'Validate Linux CEF runtime and ABI'), 'Linux native payload проходит preflight')
    assert.ok(step('build-macos', 'Run macOS DMG and ZIP smoke'), 'macOS DMG проходит smoke')

    const publishStep = step('release', 'Publish only verified native artifacts')
    assert.equal(publishStep.with.tag_name, '${{ steps.release.outputs.tag }}')
    assert.ok(!Object.hasOwn(publishStep.with, 'target_commitish'))
    assert.equal(publishStep.with.prerelease, doc === prerelease)
    assert.equal(publishStep.with.make_latest, doc === release)
    assert.match(steps[steps.indexOf(publishStep) - 1].run, /guard-tag/)

    assert.equal(doc.jobs.build.needs, 'tests')
    assert.equal(doc.jobs.build.strategy.matrix.include.length, 1)
    assert.equal(doc.jobs.build.strategy['fail-fast'], false)
    assert.equal(doc.jobs.build.strategy['max-parallel'], 3)
    assert.ok(doc.jobs.build.strategy.matrix.include.every(item => item.target === 'win-x64' && item.runner === 'windows-2022' && item.arch === 'x64' && item.machine === 'X64'))
    assert.equal(doc.jobs['build-linux'].env.TARGET_PLATFORM, 'linux')
    assert.equal(doc.jobs['build-linux'].env.TARGET_ARCH, 'x64')
    assert.equal(doc.jobs['build-macos'].env.TARGET_PLATFORM, 'macos')
    assert.equal(doc.jobs['build-macos'].env.TARGET_ARCH, 'arm64')

    // Без OAuth credentials prepare:desktop пишет пустой credentials.generated.ts,
    // и опубликованное приложение теряет вход у всех облачных провайдеров.
    const oauthCredentials = [
      'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'DROPBOX_CLIENT_ID', 'YANDEX_CLIENT_ID',
      'ONEDRIVE_CLIENT_ID', 'ELY_CLIENT_ID', 'ELY_CLIENT_SECRET', 'ELY_DEVICE_CLIENT_ID',
      'XN_CLIENT_ID', 'XN_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_DEVICE_CLIENT_ID',
    ]
    for (const [jobName, stepName] of [
      ['build', doc === release ? 'Build stable Windows artifacts (NSIS)' : 'Build canary native artifacts'],
      ['build-linux', doc === release ? 'Build stable Linux candidate' : 'Build canary Linux candidate'],
      ['build-macos', doc === release ? 'Build stable macOS candidate' : 'Build canary macOS candidate'],
    ]) {
      const buildStep = doc.jobs[jobName].steps.find(item => item.name === stepName)
      assert.ok(buildStep, `${jobName}: шаг, запускающий prepare:desktop, найден`)
      for (const name of oauthCredentials) {
        assert.equal(buildStep.env?.[name], `\${{ secrets.${name} }}`, `${jobName}: ${name} доходит до prepare:desktop`)
      }
      assert.equal(doc.jobs[jobName].env?.XNLC_REQUIRE_CLOUD_CREDENTIALS, '1', `${jobName}: пустые credentials останавливают сборку`)
    }
    assert.ok(doc.jobs.build.steps.some(item => !item.if &&
      item.run?.includes('tests/electrobun/platform-desktop.test.ts') &&
      item.run.includes('tests/electrobun/platform-secrets.test.ts') &&
      item.run.includes('tests/electrobun/platform-unix.test.ts') &&
      item.run.includes('PE metadata')), 'Windows native cases skipped on Ubuntu must run on Windows')

    const linux = doc.jobs['build-linux'], macos = doc.jobs['build-macos']
    assert.equal(linux['runs-on'], 'ubuntu-24.04')
    assert.equal(macos['runs-on'], 'macos-26')
    for (const job of [linux, macos]) {
      assert.equal(job.needs, 'tests')
      assert.ok(job.if.includes("startsWith(github.ref, 'refs/tags/v')"))
      const updater = job.steps.find(item => item.run?.includes('tests/electrobun/unix-update-*.test.ts'))
      assert.ok(updater, 'native updater step runs the merged Unix updater tests')
      for (const pattern of ['tests/electrobun/update-*.test.ts', 'tests/tooling/unix-package-build.test.ts', 'tests/tooling/release-artifacts.test.mjs']) {
        assert.ok(updater.run.includes(pattern), pattern)
      }
    }
    assert.ok(doc.jobs.tests.steps.some(item => item.run === 'bun scripts/build-electrobun-tests.mjs'), 'Windows-only merged tests are transpiled before the offline suite')
    assert.ok(doc.jobs.tests.steps.some(item => item.run === 'bun run test:offline:prepared'), 'All merged tests run in the validation job')
    assert.ok(linux.steps.some(item => item.with?.name === 'native-linux-x64-${{ env.CHANNEL }}'), 'Linux payload уходит в подпись')
    assert.ok(linux.steps.some(item => item.with?.name === 'native-linux-x64-packages'), 'Linux packages уходят в подпись')
    assert.ok(macos.steps.some(item => item.with?.name === 'native-macos-arm64-${{ env.CHANNEL }}'), 'macOS payload уходит в подпись')
    assert.ok(!linux.steps.some(item => item.run?.includes('smoke-linux-cef.ts')))
    assert.ok(linux.steps.some(item => item.run?.includes('package-linux.ts')))
    assert.ok(macos.steps.some(item => item.run?.includes('smoke-macos.ts')))
    assert.doesNotMatch(JSON.stringify(linux.steps), /macOS|macos|hdiutil|ditto|Portable|NSIS/)
    assert.doesNotMatch(JSON.stringify(macos.steps), /Linux|linux|package-linux|Portable|NSIS/)
    assert.doesNotMatch(JSON.stringify(doc.jobs.build.steps), /macOS|macos|package-linux|native Linux|runner\.os/)
    assert.equal(doc.jobs.release.steps.find(item => item.uses === 'actions/download-artifact@v8').with.pattern, 'native-*')

    const uses = Object.values(doc.jobs).flatMap(job => job.steps ?? []).map(item => item.uses).filter(Boolean)
    assert.ok(uses.includes('actions/upload-artifact@v7'))
    assert.ok(uses.includes('actions/download-artifact@v8'))
    assert.ok(!uses.some(action => /actions\/(?:upload|download)-artifact@v[1-5]$/.test(action)))
  }

  assert.deepEqual(release.jobs.build.strategy.matrix.include.map(row => row.target), ['win-x64'])
  assert.ok(!release.on.push.tags.includes('v*-beta*'))

  for (const file of await fs.readdir(path.join(root, '.github/workflows'))) {
    const source = await read('.github/workflows/' + file)
    assert.doesNotMatch(source, /release-metadata|package-unix-candidate|package-linux-targets|\.blockmap|latest(?:-mac|-linux)?\.yml/, file)
    if (file.startsWith('release') || file.startsWith('pre-release')) {
      assert.doesNotMatch(source, /git-cliff/, file)
      assert.match(source, /scripts\/release-notes\.ts/, file)
    }
    const doc = Bun.YAML.parse(source)
    for (const job of Object.values(doc.jobs)) if (job.uses?.startsWith('./')) await fs.access(path.join(root, job.uses))
    for (const match of source.matchAll(/\b(?:bun|bash|node)\s+(scripts\/[\w./-]+\.(?:[cm]?[jt]s|sh|ps1))/g)) await fs.access(path.join(root, match[1]))
  }
  for (const text of ['Ensure NSIS', 'sign-update-feed.ts', 'verify-signed-update-feed.ts', 'environment: release-signing', 'XNLC_UPDATE_PRIVATE_KEY']) {
    assert.ok((await read('.github/workflows/release.yml')).includes(text), text)
    assert.ok((await read('.github/workflows/pre-release.yml')).includes(text), text)
  }

  const setup = Bun.YAML.parse(await read('.github/actions/setup/action.yml'))
  assert.ok(setup.runs.steps.some(step => step.uses === 'actions/cache@v6'))
  const runtime = setup.runs.steps.find(step => step.name === 'Linux test prerequisites')
  assert.ok(runtime)
  assert.match(runtime.run, /--no-install-recommends/)
  assert.match(runtime.run, /libsecret-1-0/)
  assert.doesNotMatch(runtime.run, /libgtk-3-dev|libwebkit2gtk-4\.1-dev|libayatana-appindicator3-dev/)
  const native = setup.runs.steps.find(step => step.name === 'Linux native build prerequisites')
  assert.ok(native.if.includes("inputs.linux-native-build == 'true'"))
  assert.match(native.run, /libwebkit2gtk-4\.1-dev/)

  const config = spawnSync(process.execPath, ['scripts/check-config.mjs'], { cwd: root, encoding: 'utf8' })
  assert.equal(config.status, 0, config.stderr || config.stdout)
})

test('release notes содержат загрузки всех платформ и скрывают служебные файлы', async () => {
  const { releaseNotes } = await import('../../scripts/release-notes.ts')
  for (const version of ['1.0.9-pre1', '1.0.9']) {
    const body = releaseNotes(version, ['feat: Новая возможность', 'fix: Исправление'])
    assert.match(body, /### Features/)
    assert.match(body, /### Bug Fixes/)
    assert.match(body, /img.shields.io/)
    assert.match(body, new RegExp(`releases/download/v${version}/`))
    assert.match(body, /### macOS/)
    assert.match(body, /### Linux/)
    assert.match(body, /logo=apple/)
    assert.match(body, /logo=linux/)
    assert.equal(body.includes(`xneon-launcher-${version}-win-x64.exe`), true, 'NSIS есть в обоих каналах')
    assert.equal(body.includes(`xneon-launcher-${version}-mac-arm64.dmg`), true, 'DMG публикуется в обоих каналах')
    assert.ok(body.includes('portable.zip'))
  }

  const body = releaseNotes('1.0.9', ['fix: Исправление (GREEN)'])
  assert.ok(body.startsWith('## Downloads'))
  assert.ok(body.indexOf('### Windows') < body.indexOf('### Features'))
  assert.ok(body.indexOf('### macOS') < body.indexOf('### Features'))
  assert.ok(body.indexOf('### Linux') < body.indexOf('### Features'))
  assert.equal((body.match(/### Windows/g) ?? []).length, 1)
  assert.ok(body.indexOf('-win-x64.exe)') < body.indexOf('-portable.zip)'))
  assert.ok(body.indexOf('<details>') > body.indexOf('### Bug Fixes'))
  assert.ok(body.indexOf('stable-win-x64-update-v2.json') > body.indexOf('<details>'))
  assert.doesNotMatch(body, /\(GREEN\)|\(RED\)/)
  const main = body.split('<details>')[0]
  assert.doesNotMatch(main, /Setup\.zip|Setup\.tar\.gz|update-v2\.json/)
  assert.ok(releaseNotes('1.0.9-pre1', []).split('<details>')[0].includes('xneon-launcher-1.0.9-pre1-win-x64-setup.zip'))

  const beta = releaseNotes('1.0.8-beta1', []).split('<details>')[0]
  assert.match(beta, /SDK_Setup-x64/)
  assert.match(beta, /Portable-x64/)
  assert.match(beta, /logo=data%3Aimage%2Fsvg%2Bxml/)
  assert.match(beta, /1\.0\.8-beta1-win-x64-portable\.zip/)
})

test('release guard поддерживает оба вида tags, запрещает moved tag, чужую ветку и перезапись релиза', async () => {
  const sha = 'a'.repeat(40)
  const env = { GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/tags/v1.2.3', GITHUB_SHA: sha, GH_TOKEN: 'fixture-not-a-secret' }
  let annotated = true, comparison = 'ahead', commit = sha, existing = 404
  const release = loadReactModule(new URL('../../scripts/ci-pipeline.ts', import.meta.url), {
    '../package.json': { version: '1.2.3' },
  }, { Bun, Buffer, process: { env }, fetch: async url => {
    const current = env.GITHUB_REPOSITORY
    const resource = url.split('/repos/' + current + '/')[1]
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
  // Форк — такой же полноправный репозиторий сборки: guard проверяет его, а не официальный.
  env.GITHUB_REPOSITORY = 'fork/repo'
  await release.guardReleaseTag()
  env.GITHUB_REPOSITORY = repository
  assert.throws(() => release.releaseIdentity('refs/tags/v1.2.3', '1.2.3', 'unexpected/repo'), /belongs to/)
})

test('macOS metadata wrapper сверяет bundle с проверенным manifest и версией пакета', async t => {
  const { appIdentifier } = await import('../../electrobun/main/app-identity.ts')
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/macos-bundle-version-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'metadata.json')
  const manifestFile = path.join(directory, 'update-v2.json')
  const version = JSON.parse(await read('package.json')).version
  for (const [workflowFile, channel] of [['release.yml', 'stable'], ['pre-release.yml', 'canary']]) {
    const doc = await workflow(workflowFile)
    const step = doc.jobs['build-macos'].steps.find(item => item.name === 'Verify native macOS image and application bundle')
    const check = step.run.split('\n').find(line => line.includes('BUNDLE_METADATA_FILE='))
    assert.ok(check, 'Wrapper metadata must match the validated SDK manifest')
    const code = /bun -e '(.+)'$/.exec(check)?.[1]
    assert.ok(code, 'Expected an executable version check')
    const metadata = { identifier: appIdentifier, channel, hash: 'fixture123' }
    for (const [manifestPatch, metadataPatch, valid] of [[{}, {}, true], [{ version: '0.0.0' }, {}, false], [{}, { hash: 'different' }, false], [{}, { identifier: 'other.app' }, false], [{}, { channel: null }, false]]) {
      await fs.writeFile(file, JSON.stringify({ ...metadata, ...metadataPatch }))
      await fs.writeFile(manifestFile, JSON.stringify({ ...metadata, version, ...manifestPatch }))
      const result = spawnSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8', env: { ...process.env, BUN_OPTIONS: '--no-env-file', BUNDLE_METADATA_FILE: file, UPDATE_MANIFEST_FILE: manifestFile } })
      if (valid) assert.equal(result.status, 0, result.stderr)
      else assert.notEqual(result.status, 0)
    }
  }
})

test('NSIS setup сохраняет полный путь при единственном найденном или установленном кандидате', { skip: process.platform !== 'win32' }, async () => {
  const doc = await workflow('release.yml')
  const step = doc.jobs.build.steps.find(item => item.name === 'Ensure NSIS')
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