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
    assert.ok(!names.some(name => /linux|macos|\.dmg$/.test(name)))
    assert.ok(names.includes(`xneon-launcher-${version}-win-x64-setup.zip`))
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
  for (const name of ['xneon-launcher-1.2.3-win-x64.exe', 'xneon-launcher-1.2.3-win-x64-portable.zip', 'stable-win-x64-update-v2.json.sig']) assert.ok(names.includes(name), name)
  assert.ok(!names.some(name => /linux|macos|\.dmg$|\.deb$|\.rpm$|\.pacman$|\.AppImage$|\.tar\.xz$/.test(name)))
  assert.ok(!names.some(name => /latest|blockmap/.test(name)))
  assert.ok(!names.some(name => name.startsWith('canary-')), 'Стабильный релиз не содержит canary-файлов')
  assert.ok(!names.includes('canary-win-x64-update-v2.json.sig'))
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

test('prerelease публикует canary, NSIS и независимый portable', async () => {
  const { publicationNames, releaseChannel, assertReleaseChannel } = await pipeline()
  assert.equal(releaseChannel('1.2.3'), 'stable')
  assert.equal(releaseChannel('1.2.3-pre1'), 'canary')
  assertReleaseChannel('1.2.3', 'stable')
  assertReleaseChannel('1.2.3-pre1', 'canary')
  assert.throws(() => assertReleaseChannel('1.2.3', 'canary'), /cannot build/)
  assert.throws(() => assertReleaseChannel('1.2.3-pre1', 'stable'), /cannot build/)
  const names = publicationNames('1.2.3-pre1')
  for (const name of ['canary-win-x64-update-v2.json', 'canary-win-x64-update-v2.json.sig', 'canary-win-x64-XneonLauncher-canary.tar.zst', 'xneon-launcher-1.2.3-pre1-win-x64-setup.zip']) assert.ok(names.includes(name), name)
  assert.ok(!names.some(name => name.startsWith('stable-')), 'Prerelease не содержит stable-файлов')
  assert.ok(names.includes('xneon-launcher-1.2.3-pre1-win-x64.exe'), 'Canary тоже публикует NSIS: он переключает канал')
  assert.ok(names.includes('xneon-launcher-1.2.3-pre1-win-x64-portable.zip'), 'Portable доступен в canary')
  assert.ok(!names.some(name => /linux|macos|\.deb$/.test(name)), 'Unix-публикация временно отключена и в canary')
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
    const sign = commands.findIndex(command => command.includes('sign-update-feed.ts'))
    const verify = commands.findIndex(command => command.includes('verify-signed-update-feed.ts'))
    const assemble = commands.findIndex(command => command.includes(script + ' assemble'))
    const publish = releaseSteps.findIndex(step => step.uses === 'softprops/action-gh-release@v2')
    assert.ok(check >= 0 && check < sign && sign < verify && verify < assemble && assemble < publish)
    assert.equal(releaseSteps.filter(step => JSON.stringify(step).includes('secrets.')).length, 1)
    assert.equal(workflow.jobs.release.environment, 'pre2-signing')
    assert.equal(workflow.jobs.release.permissions.contents, 'write')
  }
  const step = (workflow, job, name) => workflow.jobs[job].steps.find(item => item.name === name)
  assert.equal(step(release, 'build', 'Build stable native artifacts (NSIS on Windows only)').run, 'bun run build')
  assert.equal(step(prerelease, 'build', 'Build canary native artifacts').run, 'bun run build:canary')
  assert.ok(step(release, 'build', 'Ensure NSIS'), 'NSIS собирается в стабильном канале')
  assert.ok(step(prerelease, 'build', 'Ensure NSIS'), 'Canary тоже собирает NSIS: им переключается канал')
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
    assert.equal(workflow.jobs.build.strategy.matrix.include.length, 1)
    assert.equal(workflow.jobs.build.strategy['fail-fast'], false)
    assert.equal(workflow.jobs.build.strategy['max-parallel'], 3)
    assert.ok(workflow.jobs.build.strategy.matrix.include.every(item => item.target === 'win-x64' && item.runner === 'windows-2022' && item.arch === 'x64' && item.machine === 'X64'), 'Release temporarily targets only Windows x64')
    assert.ok(workflow.jobs.build.steps.some(item => item.if === "runner.os != 'Linux'" &&
      item.run?.includes('tests/electrobun/platform-desktop.test.ts') &&
      item.run.includes('tests/electrobun/platform-secrets.test.ts') &&
      item.run.includes('tests/electrobun/platform-unix.test.ts') &&
      item.run.includes('PE metadata')), 'Windows/macOS native cases skipped on Ubuntu must run on their real targets')
  }
})

test('повторная trusted Ed25519 verification не меняет checksums и отвергает подмену', async t => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const streams = new Map()
  const streamingBun = { file: name => {
    const file = Bun.file(name)
    return { size: file.size, stream: () => { streams.set(name, (streams.get(name) ?? 0) + 1); return file.stream() } }
  } }
  const checksums = loadReactModule(new URL('../../scripts/artifact-checksums.ts', import.meta.url), {}, { Bun: streamingBun, Buffer })
  const { verifySignedUpdateFeed } = loadReactModule(new URL('../../scripts/verify-signed-update-feed.ts', import.meta.url), {
    './artifact-checksums': checksums,
    '../electrobun/main/update-public-keys': { updatePublicKeys: { fixture: publicKey.export({ type: 'spki', format: 'pem' }) } },
    // Массивы из vm имеют другой prototype; проверяем те же элементы в одном realm.
    'node:assert/strict': { ...assert, deepEqual: (actual, expected, message) => assert.deepEqual(Array.from(actual), Array.from(expected), message) },
  }, { Bun: streamingBun, Buffer, process })
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/ci-signatures-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const installerBytes = Buffer.from('fixture installer')
  await fs.writeFile(path.join(directory, 'xneon-launcher-1.2.3-win-x64.exe'), installerBytes)
  {
    // Стабильный релиз публикует только stable-манифест; canary проверяется отдельно ниже.
    const channel = 'stable'
    const archive = Buffer.from('archive ' + channel)
    const hash = createHash('sha256').update(archive).digest('hex')
    const name = channel + '-win-x64-update-v2.json'
    const file = channel + '-win-x64-XneonLauncher.tar.zst'
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, identifier: appIdentifier, channel,
      version: '1.2.3', platform: 'win', arch: 'x64', hash: 'fixture123',
      installer: { file: 'xneon-launcher-1.2.3-win-x64.exe', size: installerBytes.length, sha256: createHash('sha256').update(installerBytes).digest('hex') },
      artifact: { file, tarSize: 100, tarSha256: 'a'.repeat(64), downloadSize: archive.length, downloadSha256: hash } }))
    await fs.writeFile(path.join(directory, file), archive)
    await fs.writeFile(path.join(directory, name), bytes)
    await fs.writeFile(path.join(directory, name + '.sig'), JSON.stringify({ keyId: 'fixture', signature: sign(null, bytes, privateKey).toString('base64') }))
  }
  await verifySignedUpdateFeed(directory, '1.2.3')
  assert.equal(streams.size, 4)
  assert.ok([...streams.values()].every(count => count === 1), 'One read must serve signed digest and transport checksum within one verification')
  const originalChecksums = await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
  await verifySignedUpdateFeed(directory, '1.2.3')
  assert.ok([...streams.values()].every(count => count === 2), 'A new trust boundary must read the actual bytes again')
  assert.equal(await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), originalChecksums)
  const installerPath = path.join(directory, 'xneon-launcher-1.2.3-win-x64.exe')
  await fs.writeFile(installerPath, 'Fixture installer')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3'), /Installer hash/, 'Same-size installer tampering must break the signed hash')
  await fs.writeFile(installerPath, installerBytes)
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), 'tampered')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3'), /checksum/i)
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), originalChecksums)
  const archivePath = path.join(directory, 'stable-win-x64-XneonLauncher.tar.zst')
  const originalArchive = await fs.readFile(archivePath)
  const changedArchive = Buffer.from(originalArchive)
  changedArchive[0] ^= 1
  await fs.writeFile(archivePath, changedArchive)
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3'), 'Signed SHA256 must reject same-size changes')
  await fs.appendFile(archivePath, 'extra byte')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3'), 'Signed downloadSize must reject a different size')
  await fs.writeFile(archivePath, originalArchive)
  await fs.writeFile(path.join(directory, 'unexpected.zip'), 'extra')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3'), /Unexpected/)
  await fs.rm(path.join(directory, 'unexpected.zip'))
  await fs.writeFile(path.join(directory, 'canary-win-x64-update-v2.json'), '{}')
  await fs.writeFile(path.join(directory, 'canary-win-x64-update-v2.json.sig'), '{}')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3'), /Unexpected/, 'Стабильный релиз не принимает canary-файлы')
  await fs.rm(path.join(directory, 'canary-win-x64-update-v2.json'))
  await fs.rm(path.join(directory, 'canary-win-x64-update-v2.json.sig'))
  await fs.appendFile(path.join(directory, 'stable-win-x64-update-v2.json'), ' ')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3'), /signature/)
})

test('release assembly связывает signed bytes с native выдачей и повторно проверяет весь allowlist', async t => {
  const { nativeArtifactNames } = await import('../../scripts/electrobun-artifacts.ts')
  const { checksumText } = await pipeline()
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const realmAssert = { ...assert, deepEqual: (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message) }
  const { verifySignedUpdateFeed } = loadReactModule(new URL('../../scripts/verify-signed-update-feed.ts', import.meta.url), {
    '../electrobun/main/update-public-keys': { updatePublicKeys: { fixture: publicKey.export({ type: 'spki', format: 'pem' }) } },
    'node:assert/strict': realmAssert,
  }, { Bun, Buffer, process })
  let inspections = 0
  const release = loadReactModule(new URL('../../scripts/ci-pipeline.ts', import.meta.url), {
    'node:assert/strict': realmAssert,
    './verify-signed-update-feed': { verifySignedUpdateFeed },
    // Реальные tar/PE/Mach-O/ELF проверки покрыты electrobun-packaging.test.mjs;
    // здесь изолируется orchestration, но криптография и файловый I/O настоящие.
    './electrobun-artifacts': { nativeArtifactNames, inspectElectrobunRelease: async (directory, options) => {
      inspections++
      const files = nativeArtifactNames(options)
      const expected = [...files, ...(options.requireChecksums ? ['SHA256SUMS.txt'] : [])]
      assert.deepEqual((await fs.readdir(directory)).sort(), expected.sort())
      if (options.requireChecksums) assert.equal(await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), await checksumText(directory, files))
      return { files }
    } },
  }, { Bun, Buffer, process, fetch: () => { throw new Error('Unexpected network access') } })
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/ci-assembly-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'input'), output = path.join(directory, 'output')
  const linuxPackageFixture = name => {
    const bytes = Buffer.alloc(2 * 1024 * 1024)
    if (name.endsWith('.deb')) bytes.write('!<arch>\ndebian-binary', 0)
    else if (name.endsWith('.rpm')) bytes.set([0xed, 0xab, 0xee, 0xdb], 0)
    else if (name.endsWith('.pacman')) bytes.set([0x28, 0xb5, 0x2f, 0xfd], 0)
    else if (name.endsWith('.AppImage')) bytes.set([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x41, 0x49, 0x02], 0)
    else bytes.set([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], 0)
    return bytes
  }
  const signed = path.join(input, 'update-verified')
  await fs.mkdir(signed, { recursive: true })
  const sets = [
    { platform: 'win', arch: 'x64', channel: 'stable', nsis: true },
  ]
  for (const options of sets) {
    const source = path.join(input, `native-${options.platform}-${options.arch}-${options.channel}`)
    await fs.mkdir(source)
    const names = nativeArtifactNames({ ...options, version: '1.2.3' })
    for (const name of names) await fs.writeFile(path.join(source, name), 'native ' + name)
    if (options.platform === 'win') {
      const archive = await fs.readFile(path.join(source, names[2]))
      const installer = Buffer.from('native ' + names.at(-1))
      const original = { schemaVersion: 1, identifier: appIdentifier, channel: options.channel, platform: 'win', arch: 'x64', version: '1.2.3', hash: 'fixture123',
        installer: { file: names.at(-1), size: installer.length, sha256: createHash('sha256').update(installer).digest('hex') },
        artifact: { file: names[2], tarSize: 100, tarSha256: 'a'.repeat(64) } }
      await fs.writeFile(path.join(source, names[1]), JSON.stringify(original))
      const bytes = Buffer.from(JSON.stringify({ ...original, artifact: { ...original.artifact, downloadSize: archive.length, downloadSha256: createHash('sha256').update(archive).digest('hex') } }))
      await fs.writeFile(path.join(signed, names[1]), bytes)
      await fs.writeFile(path.join(signed, names[1] + '.sig'), JSON.stringify({ keyId: 'fixture', signature: sign(null, bytes, privateKey).toString('base64') }))
      await fs.copyFile(path.join(source, names[2]), path.join(signed, names[2]))
      if (options.nsis) await fs.copyFile(path.join(source, names.at(-1)), path.join(signed, names.at(-1)))
    }
    await fs.writeFile(path.join(source, 'SHA256SUMS.txt'), await checksumText(source, names))
  }
  const portable = path.join(input, 'native-win-x64-portable')
  await fs.mkdir(portable)
  const portableName = 'xneon-launcher-1.2.3-win-x64-portable.zip'
  await fs.writeFile(path.join(portable, portableName), 'separate portable fixture')
  await fs.writeFile(path.join(portable, 'SHA256SUMS.txt'), await checksumText(portable, [portableName]))
  // Unix-проверку сохраняем отдельно, но эти артефакты не входят в текущий релиз.
  const packages = path.join(directory, 'native-linux-x64-packages')
  await fs.mkdir(packages)
  const packageNames = ['xneon-launcher-1.2.3-amd64.deb', 'xneon-launcher-1.2.3-x86_64.rpm', 'xneon-launcher-1.2.3-x86_64.pacman', 'xneon-launcher-1.2.3-x86_64.AppImage', 'xneon-launcher-1.2.3-x64.tar.xz']
  for (const name of packageNames) await fs.writeFile(path.join(packages, name), linuxPackageFixture(name))
  await fs.writeFile(path.join(packages, 'SHA256SUMS.txt'), await checksumText(packages, packageNames))
  await release.verifyLinuxPackages(packages, '1.2.3')
  const outsideSigned = path.join(directory, 'signed')
  await fs.rename(signed, outsideSigned)
  await release.checkCandidates(input, '1.2.3')
  assert.equal(inspections, 1)
  await assert.rejects(release.checkCandidates(input, '1.2.3-pre1'), /Unexpected/, 'Стабильный набор не проходит canary-проверку')
  await fs.appendFile(path.join(portable, portableName), 'tamper')
  await assert.rejects(release.checkCandidates(input, '1.2.3'), /checksum/i)
  await fs.writeFile(path.join(portable, portableName), 'separate portable fixture')
  await fs.mkdir(path.join(input, 'unverified'))
  await assert.rejects(release.checkCandidates(input, '1.2.3'), /Unexpected/)
  await fs.rmdir(path.join(input, 'unverified'))
  await fs.rename(outsideSigned, signed)
  inspections = 0
  await verifySignedUpdateFeed(signed, '1.2.3')
  await release.assemblePublication(input, output, '1.2.3')
  assert.equal(inspections, 2)
  assert.equal((await fs.readdir(output)).length, 8)
  await release.verifyPublication(output, '1.2.3')
  await fs.writeFile(path.join(output, 'unverified.zip'), 'extra')
  await assert.rejects(release.verifyPublication(output, '1.2.3'), /Unexpected/)
  await fs.rm(path.join(output, 'unverified.zip'))
  await fs.appendFile(path.join(output, 'stable-win-x64-XneonLauncher.tar.zst'), 'tamper')
  const files = (await fs.readdir(output)).filter(file => file !== 'SHA256SUMS.txt')
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), await checksumText(output, files))
  await assert.rejects(release.verifyPublication(output, '1.2.3'))
  await fs.appendFile(path.join(signed, 'xneon-launcher-1.2.3-win-x64.exe'), 'substituted installer')
  const signedFiles = (await fs.readdir(signed)).filter(file => file !== 'SHA256SUMS.txt')
  await fs.writeFile(path.join(signed, 'SHA256SUMS.txt'), await checksumText(signed, signedFiles))
  await assert.rejects(release.assemblePublication(input, path.join(directory, 'substituted'), '1.2.3'), /Installer (?:hash|size)/, 'Подмена установщика ловится подписанным манифестом')

  // Каналы не смешиваются: canary-набор проверяется отдельно со своим portable.
  const canaryInput = path.join(directory, 'canary-input')
  await fs.mkdir(canaryInput, { recursive: true })
  for (const options of [
    { platform: 'win', arch: 'x64', channel: 'canary', nsis: true },
  ]) {
    const source = path.join(canaryInput, `native-${options.platform}-${options.arch}-canary`)
    await fs.mkdir(source)
    const names = nativeArtifactNames({ ...options, version: '1.2.3-pre1' })
    for (const name of names) await fs.writeFile(path.join(source, name), 'canary ' + name)
    await fs.writeFile(path.join(source, 'SHA256SUMS.txt'), await checksumText(source, names))
  }
  const canaryPackages = path.join(directory, 'canary-linux-packages')
  await fs.mkdir(canaryPackages)
  const canaryPackageNames = ['xneon-launcher-1.2.3-pre1-amd64.deb', 'xneon-launcher-1.2.3-pre1-x86_64.rpm', 'xneon-launcher-1.2.3-pre1-x86_64.pacman', 'xneon-launcher-1.2.3-pre1-x86_64.AppImage', 'xneon-launcher-1.2.3-pre1-x64.tar.xz']
  for (const name of canaryPackageNames) await fs.writeFile(path.join(canaryPackages, name), linuxPackageFixture(name))
  await fs.writeFile(path.join(canaryPackages, 'SHA256SUMS.txt'), await checksumText(canaryPackages, canaryPackageNames))
  await release.verifyLinuxPackages(canaryPackages, '1.2.3-pre1')
  const canaryPortable = path.join(canaryInput, 'native-win-x64-portable')
  await fs.mkdir(canaryPortable)
  const canaryPortableName = 'xneon-launcher-1.2.3-pre1-win-x64-portable.zip'
  await fs.writeFile(path.join(canaryPortable, canaryPortableName), 'separate canary portable fixture')
  await fs.writeFile(path.join(canaryPortable, 'SHA256SUMS.txt'), await checksumText(canaryPortable, [canaryPortableName]))
  await release.checkCandidates(canaryInput, '1.2.3-pre1')
  await assert.rejects(release.checkCandidates(canaryInput, '1.2.3'), /Unexpected/, 'Canary-набор не проходит stable-проверку')
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
