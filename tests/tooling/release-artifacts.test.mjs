import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createZstdCompress } from 'node:zlib'
import os from 'node:os'
import { zipSync } from 'fflate'
import { loadReactModule } from '../helpers/react-module.mjs'
import { appIdentifier } from '../../electrobun/main/app-identity.ts'
import { updatePublicKeys, updateBaseUrls } from '../../electrobun/main/update-public-keys.ts'
import {
  compatibilityManifestFileName, manifestFileName, nativeArchiveName, unixDistributionName, unixDistributions,
  verifySignedUpdateManifest,
} from '../../electrobun/main/update-manifest.ts'

const root = path.resolve(import.meta.dir, '../..')
const read = file => fs.readFile(path.join(root, file), 'utf8')
const native = () => import('../../scripts/electrobun-artifacts.ts')
const pipeline = () => import('../../scripts/ci-pipeline.ts')
const hash = data => createHash('sha256').update(data).digest('hex')

// --- fixtures: native tar, feed и упаковка ---------------------------------

function tarArchive(files) {
  const blocks = []
  for (const [name, bytes] of files) {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, 'utf8')
    header.write('0000755\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124)
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512))
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)])
}

function nativeBinary(platform) {
  if (platform === 'win') {
    const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68)
    return bytes
  }
  const bytes = Buffer.alloc(64)
  if (platform === 'linux') { bytes.write('\x7fELF'); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(62, 18) }
  else { bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x0100000c, 4) }
  return bytes
}

function windowsNativeArchive(version, value, channel = 'stable') {
  const pe = nativeBinary('win')
  const bytes = tarArchive([
    ['XneonLauncher/bin/bun.exe', pe],
    ['XneonLauncher/bin/launcher.exe', pe],
    ['XneonLauncher/bin/ElectrobunCore.dll', pe],
    ['XneonLauncher/Resources/version.json', Buffer.from(JSON.stringify({ schemaVersion: 1, identifier: appIdentifier, channel, version, hash: value, platform: 'win', arch: 'x64' }))],
  ])
  return { compressed: Buffer.from(Bun.zstdCompressSync(bytes)), tarSize: bytes.length, tarSha256: hash(bytes) }
}

function unixNativeArchive(platform, arch, version, value, channel = 'stable') {
  const app = platform === 'macos' ? 'Xneon Launcher.app' : 'XneonLauncher'
  const resources = `${app}/${platform === 'macos' ? 'Contents/Resources' : 'Resources'}`
  const bin = `${app}/${platform === 'macos' ? 'Contents/MacOS' : 'bin'}`
  const binary = nativeBinary(platform)
  const local = { schemaVersion: 1, identifier: appIdentifier, channel, version, hash: value, platform, arch }
  const entries = [
    [`${bin}/bun`, binary], [`${bin}/launcher`, binary],
    [`${bin}/libElectrobunCore.${platform === 'macos' ? 'dylib' : 'so'}`, binary],
    [`${resources}/version.json`, Buffer.from(JSON.stringify(local))],
    [`${resources}/app/bun/workers/unix-update-helper.js`, Buffer.from('fixture-helper')],
  ]
  if (platform === 'macos') entries.push([`${app}/Contents/Info.plist`, Buffer.from('<plist><dict><key>CFBundleIdentifier</key><string>org.xneon.launcher</string></dict></plist>')])
  const bytes = tarArchive(entries)
  return { compressed: Buffer.from(Bun.zstdCompressSync(bytes)), tarSize: bytes.length, tarSha256: hash(bytes) }
}

function pe(nsis = false) {
  const bytes = Buffer.alloc(160)
  bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68)
  if (nsis) bytes.write('NullsoftInst', 96)
  return bytes
}

function executable(platform, arch) {
  if (platform === 'win') return pe()
  const bytes = Buffer.alloc(160)
  if (platform === 'macos') { bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4) }
  else { Buffer.from('7f454c46', 'hex').copy(bytes); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18) }
  return bytes
}

async function packagingFixture(t, platform = 'win', arch = platform === 'macos' ? 'arm64' : 'x64', { core = true } = {}) {
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/packaging-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const bundle = platform === 'macos' ? 'Xneon Launcher.app' : 'XneonLauncher', prefix = `stable-${platform}-${arch}`
  const input = path.join(directory, 'input'), tree = path.join(directory, 'tree')
  const resources = path.join(tree, bundle, platform === 'macos' ? 'Contents/Resources' : 'Resources')
  const bin = path.join(tree, bundle, platform === 'macos' ? 'Contents/MacOS' : 'bin')
  await fs.mkdir(path.join(resources, 'app/bun'), { recursive: true }); await fs.mkdir(bin, { recursive: true }); await fs.mkdir(input)
  const local = { displayName: 'Xneon Launcher', identifier: appIdentifier, channel: 'stable', version: '1.2.3', hash: 'fixture123', baseUrl: platform === 'win' ? updateBaseUrls.stable : '' }
  await fs.writeFile(path.join(resources, 'version.json'), JSON.stringify(local))
  const creds = Array.from({ length: 12 }, (_, index) => `p${index}: { clientId: "" }`).join(',\n')
  const mainSource = `var cloudCredentials = {\n${creds}\n};\n` + Object.entries(updatePublicKeys).map(([key, pem]) => key + '\n' + pem.split('\n')[1]).join('\n') + '\nMAINER4IK/Xneon-Launcher-bun'
  await fs.writeFile(path.join(resources, 'app/bun/index.js'), mainSource)
  for (const file of ['launcher', 'bun']) await fs.writeFile(path.join(bin, file + (platform === 'win' ? '.exe' : '')), executable(platform, arch))
  if (core) await fs.writeFile(path.join(bin, platform === 'win' ? 'ElectrobunCore.dll' : `libElectrobunCore.${platform === 'macos' ? 'dylib' : 'so'}`), executable(platform, arch))
  if (platform === 'win') await fs.writeFile(path.join(bin, 'bun.exe'), Buffer.concat([pe(), randomBytes(1024 ** 2 + 1024)]))
  await fs.writeFile(path.join(resources, 'uninstall'), 'native update manager')
  const tarFile = path.join(directory, 'payload.tar')
  const packed = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-cf', tarFile, '-C', tree, bundle], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
  const tar = await fs.readFile(tarFile), archive = Buffer.from(Bun.zstdCompressSync(tar))
  const manifest = { schemaVersion: 1, identifier: appIdentifier, version: local.version, channel: 'stable', platform, arch, hash: local.hash, artifact: { file: `${prefix}-XneonLauncher${platform === 'macos' ? '.app' : ''}.tar.zst` } }
  const v2 = { ...manifest, artifact: { ...manifest.artifact, tarSize: tar.length, tarSha256: hash(tar) } }
  await fs.writeFile(path.join(input, manifest.artifact.file), archive)
  await fs.writeFile(path.join(input, prefix + '-update.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(input, prefix + '-update-v2.json'), JSON.stringify(v2))
  if (platform === 'win') await fs.writeFile(path.join(input, 'win-x64-XneonLauncher-Setup.zip'), zipSync({
    'Xneon Launcher-Setup.exe': pe(), '.installer/Xneon Launcher-Setup.metadata.json': Buffer.from(JSON.stringify({ name: 'Xneon Launcher', identifier: appIdentifier, channel: 'stable', hash: local.hash })), '.installer/Xneon Launcher-Setup.tar.zst': archive,
  }))
  if (platform === 'win') await fs.writeFile(path.join(input, 'xneon-launcher-1.2.3-win-x64.exe'), Buffer.concat([pe(true), randomBytes(1024 ** 2 + 1024)]))
  if (platform === 'macos') await fs.writeFile(path.join(input, `macos-${arch}-XneonLauncher.dmg`), 'fixture image: hdiutil verification runs on macOS CI')
  if (platform === 'linux') {
    const setup = path.join(directory, 'setup')
    await fs.mkdir(setup)
    const metadata = { name: 'Xneon Launcher', identifier: appIdentifier, channel: 'stable', hash: local.hash }
    await fs.writeFile(path.join(setup, 'installer'), Buffer.concat([executable(platform, arch), Buffer.from('ELECTROBUN_METADATA_V1' + JSON.stringify(metadata) + 'ELECTROBUN_ARCHIVE_V1'), archive]))
    await fs.writeFile(path.join(setup, 'README.txt'), 'SDK installer fixture')
    const setupTar = path.join(directory, 'setup.tar')
    const packed = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-cf', setupTar, '-C', setup, '.'], { encoding: 'utf8' })
    assert.equal(packed.status, 0, packed.stderr)
    await fs.writeFile(path.join(input, `linux-${arch}-XneonLauncher-Setup.tar.gz`), Bun.gzipSync(await fs.readFile(setupTar)))
  }
  return { directory, input, options: { platform, arch, channel: 'stable', version: '1.2.3', nsis: platform === 'win' }, v2 }
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privateKey, keys: { fixture: publicKey.export({ format: 'pem', type: 'spki' }).toString() } }
}

/** Потоковый кадр, как у Hutch 0.30: Content Size не объявлен. */
async function streamingZstd(data) {
  const stream = createZstdCompress(), chunks = []
  stream.on('data', chunk => chunks.push(chunk))
  const done = new Promise((resolve, reject) => { stream.once('end', resolve); stream.once('error', reject) })
  for (let offset = 0; offset < data.length; offset += 64 * 1024) stream.write(data.subarray(offset, offset + 64 * 1024))
  stream.end()
  await done
  return Buffer.concat(chunks)
}

async function feedFixture(target, version, action, streaming = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xneon-feed-'))
  try {
    const input = path.join(directory, 'native'); await fs.mkdir(input, { recursive: true })
    const binary = nativeBinary(target.platform)
    const app = target.platform === 'macos' ? 'Xneon Launcher.app' : 'XneonLauncher'
    const resources = `${app}/${target.platform === 'macos' ? 'Contents/Resources' : 'Resources'}`
    const bin = `${app}/${target.platform === 'macos' ? 'Contents/MacOS' : 'bin'}`
    const ext = target.platform === 'win' ? '.exe' : ''
    const local = { schemaVersion: 1, identifier: 'org.xneon.launcher', ...target, version, hash: 'fixture123' }
    const entries = [
      [`${bin}/bun${ext}`, binary], [`${bin}/launcher${ext}`, binary],
      [`${resources}/version.json`, Buffer.from(JSON.stringify(local))],
    ]
    if (target.platform !== 'win') entries.push([`${resources}/app/bun/workers/unix-update-helper.js`, Buffer.from('fixture-helper')])
    if (target.platform === 'macos') entries.push([`${app}/Contents/Info.plist`, Buffer.from('<plist><dict><key>CFBundleIdentifier</key><string>org.xneon.launcher</string></dict></plist>')])
    const bytes = tarArchive(entries), archive = nativeArchiveName(target)
    await fs.writeFile(path.join(input, archive), streaming ? await streamingZstd(bytes) : Bun.zstdCompressSync(bytes))
    await fs.writeFile(path.join(input, compatibilityManifestFileName(target)),
      JSON.stringify({ ...local, artifact: { file: archive, tarSize: bytes.length, tarSha256: hash(bytes) } }))
    if (target.platform === 'win') await fs.writeFile(path.join(input, `xneon-launcher-${version}-win-x64.exe`), Buffer.alloc(1024 ** 2 + 16))
    let packages
    if (target.platform === 'linux') {
      packages = path.join(directory, 'distributions'); await fs.mkdir(packages)
      for (const format of unixDistributions) {
        const data = Buffer.alloc(128)
        if (format === 'deb') data.write('!<arch>\ndebian-binary')
        else if (format === 'rpm') data.writeUInt32BE(0xedabeedb)
        else if (format === 'pacman') data.writeUInt32BE(0x28b52ffd)
        else if (format === 'appimage') { nativeBinary('linux').copy(data); data.write('AI\x02', 8) }
        else Buffer.from('fd377a585a00', 'hex').copy(data)
        await fs.writeFile(path.join(packages, unixDistributionName(version, format)), data)
      }
    }
    return await action(directory, input, packages)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

const macTarget = { platform: 'macos', arch: 'arm64', channel: 'stable' }
const linuxTarget = { platform: 'linux', arch: 'x64', channel: 'stable' }
const winTarget = { platform: 'win', arch: 'x64', channel: 'stable' }

// --- artifact names, headers и Windows packaging ----------------------------

test('имена артефактов, native headers и Windows version resource', async () => {
  const { nativeArtifactNames, validateNativeExecutable } = await native()
  const { createWindowsVersionResource } = await import('../../scripts/windows-version-resource.ts')

  assert.deepEqual(nativeArtifactNames({ platform: 'win', arch: 'x64', channel: 'stable', version: '1.2.3', nsis: true }).sort(), [
    'stable-win-x64-update.json', 'stable-win-x64-update-v2.json', 'stable-win-x64-XneonLauncher.tar.zst', 'win-x64-XneonLauncher-Setup.zip', 'xneon-launcher-1.2.3-win-x64.exe',
  ].sort())
  for (const arch of ['arm64', 'x64']) {
    const names = nativeArtifactNames({ platform: 'macos', arch, channel: 'stable', version: '1.2.3' })
    assert.ok(names.includes(`macos-${arch}-XneonLauncher.dmg`))
    assert.ok(names.includes(`stable-macos-${arch}-XneonLauncher.app.tar.zst`))
    assert.ok(!names.includes(`stable-macos-${arch}-XneonLauncher.tar.zst`))
  }
  assert.ok(nativeArtifactNames({ platform: 'linux', arch: 'x64', channel: 'stable', version: '1.2.3' }).includes('linux-x64-XneonLauncher-Setup.tar.gz'))
  assert.ok(nativeArtifactNames({ platform: 'win', arch: 'x64', channel: 'canary', version: '1.2.3' }).includes('canary-win-x64-XneonLauncher-Setup-canary.zip'))
  for (const platform of ['macos', 'linux']) {
    validateNativeExecutable(executable(platform, 'arm64'), platform, 'arm64')
    validateNativeExecutable(executable(platform, 'x64'), platform, 'x64')
    assert.throws(() => validateNativeExecutable(executable(platform, 'arm64'), platform, 'x64'))
    assert.throws(() => validateNativeExecutable(Buffer.alloc(4), platform, 'x64'))
  }
  assert.throws(() => nativeArtifactNames({ platform: 'win', arch: 'arm64', channel: 'stable', nsis: true }))
  assert.throws(() => nativeArtifactNames({ platform: 'win', arch: 'x64', channel: 'bad' }))

  for (const version of ['1.2.3', '1.2.3-pre4']) {
    const bytes = createWindowsVersionResource(version)
    const blocks = new Map()
    function block(start, limit) {
      const end = start + bytes.readUInt16LE(start)
      assert.ok(end > start && end <= limit)
      const length = bytes.readUInt16LE(start + 2), text = bytes.readUInt16LE(start + 4) === 1
      let cursor = start + 6
      while (bytes.readUInt16LE(cursor)) cursor += 2
      const key = bytes.toString('utf16le', start + 6, cursor)
      cursor = (cursor + 2 + 3) & ~3
      const valueEnd = cursor + length * (text ? 2 : 1)
      assert.ok(valueEnd <= end)
      blocks.set(key, bytes.subarray(cursor, valueEnd))
      cursor = (valueEnd + 3) & ~3
      while (cursor < end) { assert.equal(cursor % 4, 0); cursor = (block(cursor, end) + 3) & ~3 }
      return end
    }
    assert.equal(block(0, bytes.length), bytes.length)
    const fixed = blocks.get('VS_VERSION_INFO')
    assert.equal(fixed.length, 52)
    assert.equal(fixed.readUInt32LE(0), 0xfeef04bd)
    assert.equal(fixed.readUInt32LE(8), 0x00010002)
    assert.equal(fixed.readUInt32LE(12), 0x00030000)
    for (const key of ['FileDescription', 'ProductName', 'CompanyName']) assert.equal(blocks.get(key).toString('utf16le'), 'Xneon Launcher\0')
    assert.equal(blocks.get('ProductVersion').toString('utf16le'), version + '\0')
    assert.equal(blocks.get('FileVersion').toString('utf16le'), '1.2.3.0\0')
    assert.equal(blocks.get('OriginalFilename').toString('utf16le'), 'Xneon Launcher.dll\0')
    assert.deepEqual([...blocks.get('Translation')], [9, 4, 176, 4])
  }
  assert.doesNotThrow(() => createWindowsVersionResource('1.2.3-beta1'))
  for (const value of ['', '1.2', '1.2.3\0bad', '1.2.3-rc1', '65536.0.0']) assert.throws(() => createWindowsVersionResource(value))

  for (const file of ['scripts/release-metadata.ts', 'scripts/package-unix-candidate.sh', 'scripts/package-linux-targets.sh']) await assert.rejects(fs.access(path.join(root, file)), { code: 'ENOENT' })
  for (const file of ['build/installer.nsi', 'scripts/build-windows-distribution.ts', 'scripts/package-windows-portable.ts', 'scripts/sign-update-feed.ts', 'scripts/verify-signed-update-feed.ts']) await fs.access(path.join(root, file))
})

test('Windows packaging: системный bsdtar, NSIS и отдельный portable', async t => {
  const { nativeTarExecutable } = await import('../../scripts/native-tar.ts')
  assert.equal(nativeTarExecutable('win32', { SystemRoot: 'D:\\Windows' }), 'D:\\Windows\\System32\\tar.exe')
  assert.equal(nativeTarExecutable('win32', { WINDIR: 'C:\\Windows' }), 'C:\\Windows\\System32\\tar.exe')
  assert.equal(nativeTarExecutable('linux', { SystemRoot: 'D:\\Windows' }), 'tar')
  assert.equal(nativeTarExecutable('darwin', {}), 'tar')
  if (process.platform === 'win32') {
    await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
    const directory = await fs.mkdtemp(path.join(root, '.tmp/native-tar-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    await fs.writeFile(path.join(directory, 'marker.txt'), 'native tar')
    const archive = path.join(directory, 'fixture.zip')
    const tar = nativeTarExecutable()
    const packed = spawnSync(tar, ['-a', '-cf', archive, '-C', directory, 'marker.txt'], { encoding: 'utf8' })
    assert.equal(packed.status, 0, packed.stderr)
    const unpacked = spawnSync(tar, ['-xOf', archive, 'marker.txt'], { encoding: 'utf8' })
    assert.equal(unpacked.status, 0, unpacked.stderr)
    assert.equal(unpacked.stdout, 'native tar')
  }

  const distribution = await read('scripts/build-windows-distribution.ts')
  assert.doesNotMatch(distribution, /release-metadata|writeBlockMap|writeLatestFile|latest\.yml|const unpacked/)
  assert.match(distribution, /installer\.nsi/)
  assert.match(distribution, /Bundled update manager is missing/)
  assert.match(distribution, /findMakensis/)
  const installer = await read('build/installer.nsi')
  for (const text of ['RequestExecutionLevel user', 'ClearLegacyInstallRoot', 'WriteSchemeRegistry', 'WebView2', 'RunLauncherIfRequested']) assert.ok(installer.includes(text), text)
  assert.match(installer, /\$INSTDIR\\app\\bin\\launcher\.exe/)
  assert.doesNotMatch(installer, /mklink/)

  const portable = await read('scripts/package-windows-portable.ts')
  for (const text of ['PortableProfile', 'portableAppIdentifier', 'validateBundleCredentials', 'windowsX64']) assert.ok(portable.includes(text), text)
  assert.doesNotMatch(portable, /\.blockmap|latest\.yml|unpackedSource|windowsInstaller|\[installer, destination\]/)

  for (const [channel, sdkStatus, nsisStatus, count, code] of [['stable', 0, 0, 3, 0], ['stable', 7, 0, 1, 7], ['stable', 0, 9, 2, 9], ['canary', 0, 0, 3, 0], ['canary', 0, 9, 2, 9], ['dev', 0, 0, 1, 0]]) {
    const calls = [], process = { argv: ['pinned-bun.exe', 'electrobun.mjs', 'build', '--env=' + channel], execPath: 'pinned-bun.exe', platform: 'win32', env: {} }
    loadReactModule(new URL('../../scripts/electrobun.mjs', import.meta.url), { 'node:child_process': { spawnSync: (...args) => { calls.push(args); return { status: calls.length === 1 ? sdkStatus : nsisStatus } } } }, { process })
    assert.equal(calls.length, count)
    assert.equal(process.exitCode, code)
    if (count >= 2) {
      assert.equal(calls[1][0], process.execPath)
      assert.equal(calls[1][1][0], 'scripts/normalize-update-artifacts.ts')
    }
    if (count === 3) assert.equal(calls[2][1][0], 'scripts/build-windows-distribution.ts')
    assert.equal(calls[0][2].env.XNEON_ARTIFACT_CHANNEL, channel)
  }
})

test('native release validation: байты, NSIS, checksums, traversal и delta', { timeout: 60_000 }, async t => {
  const { inspectElectrobunRelease, stageElectrobunRelease } = await native()
  const f = await packagingFixture(t)
  const inspected = await inspectElectrobunRelease(f.input, f.options)
  assert.equal(inspected.files.length, 5)
  const output = path.join(f.directory, 'verified')
  await stageElectrobunRelease(f.input, output, f.options)
  assert.equal((await fs.readdir(output)).length, 6)
  for (const file of inspected.files) assert.deepEqual(await fs.readFile(path.join(f.input, file)), await fs.readFile(path.join(output, file)))
  await inspectElectrobunRelease(output, { ...f.options, requireChecksums: true })
  await fs.appendFile(path.join(output, 'xneon-launcher-1.2.3-win-x64.exe'), 'tamper')
  await assert.rejects(inspectElectrobunRelease(output, { ...f.options, requireChecksums: true }), /checksum/i)

  const metadata = path.join(f.input, 'latest.yml')
  await fs.writeFile(metadata, 'version: 1.2.3')
  await assert.rejects(inspectElectrobunRelease(f.input, f.options), /Unexpected|artifact/i)
  await fs.rm(metadata)
  const manifestFile = path.join(f.input, 'stable-win-x64-update-v2.json')
  const originalManifest = await fs.readFile(manifestFile)
  await fs.writeFile(manifestFile, JSON.stringify({ ...f.v2, artifact: { ...f.v2.artifact, tarSha256: '0'.repeat(64) } }))
  await assert.rejects(inspectElectrobunRelease(f.input, f.options), /integrity|SHA|hash/i)
  for (const patch of [{ artifact: { ...f.v2.artifact, file: '../outside.tar.zst' } }, { identifier: 'untrusted.app' }, { channel: 'canary' }]) {
    await fs.writeFile(manifestFile, JSON.stringify({ ...f.v2, ...patch }))
    await assert.rejects(inspectElectrobunRelease(f.input, f.options))
  }
  await fs.writeFile(manifestFile, originalManifest)

  await assert.rejects(inspectElectrobunRelease(f.input, { ...f.options, requireChecksums: true }), /checksums/)
  await fs.writeFile(path.join(f.input, 'stable-win-x64-oldhash123.patch'), 'native SDK delta')
  assert.equal((await inspectElectrobunRelease(f.input, f.options)).files.length, 6)
  await fs.writeFile(path.join(f.input, 'xneon-launcher-1.2.3-win-x64.exe'), Buffer.concat([pe(), randomBytes(1024 ** 2 + 1024)]))
  await assert.rejects(inspectElectrobunRelease(f.input, f.options), /NSIS/)

  for (const platform of ['macos', 'linux']) {
    const unix = await packagingFixture(t, platform)
    const checked = await inspectElectrobunRelease(unix.input, unix.options)
    assert.equal(checked.files.length, 4)
    assert.ok(checked.files.some(name => name.endsWith(platform === 'macos' ? '.dmg' : '-Setup.tar.gz')))
  }
  // Без native core updater не загрузится (updaterNative.ts), такой payload не выпускается.
  const withoutCore = await packagingFixture(t, 'win', 'x64', { core: false })
  await assert.rejects(inspectElectrobunRelease(withoutCore.input, withoutCore.options), /ElectrobunCore/)
})

test('Bun обновляет реальные PE metadata, сохраняет иконки и отклоняет непригодный файл', { skip: process.platform !== 'win32' }, async t => {
  const { setWindowsExecutableVersion } = await import('../../scripts/windows-version-resource.ts')
  const { windowsProductIdentity } = await import('../../scripts/windows-candidate-validation.ts')
  const directory = await fs.mkdtemp(path.join(root, '.hutch/pe-identity-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'Лаунчер с пробелами.exe')
  await fs.copyFile(process.execPath, file)
  function resources(bytes) {
    const pe = bytes.readUInt32LE(60), optional = pe + 24
    const sections = optional + bytes.readUInt16LE(pe + 20)
    const directoryOffset = bytes.readUInt16LE(optional) === 0x20b ? 112 : 96
    function offset(rva) {
      for (let index = 0; index < bytes.readUInt16LE(pe + 6); index++) {
        const section = sections + index * 40, base = bytes.readUInt32LE(section + 12)
        if (rva >= base && rva < base + bytes.readUInt32LE(section + 16)) return bytes.readUInt32LE(section + 20) + rva - base
      }
      throw new Error('Resource RVA is outside the PE sections')
    }
    const base = offset(bytes.readUInt32LE(optional + directoryOffset + 16)), result = {}
    function walk(relative, keys = []) {
      const directory = base + relative
      const count = bytes.readUInt16LE(directory + 12) + bytes.readUInt16LE(directory + 14)
      for (let index = 0; index < count; index++) {
        const entry = directory + 16 + index * 8, id = bytes.readUInt32LE(entry)
        if (!keys.length && id === 16) continue
        const target = bytes.readUInt32LE(entry + 4), key = [...keys, id]
        if (target & 0x80000000) walk(target & 0x7fffffff, key)
        else {
          const data = base + target, start = offset(bytes.readUInt32LE(data))
          result[key.join('/')] = createHash('sha256').update(bytes.subarray(start, start + bytes.readUInt32LE(data + 4))).digest('hex')
        }
      }
    }
    walk(0)
    return result
  }
  const originalResources = resources(await fs.readFile(file))
  assert.ok(Object.keys(originalResources).some(key => key.startsWith('3/')), 'Fixture must contain icons')
  for (const version of ['1.2.3', '1.2.4-pre2']) {
    await setWindowsExecutableVersion(file, version)
    windowsProductIdentity(file, version)
    assert.deepEqual(resources(await fs.readFile(file)), originalResources)
  }
  const executed = spawnSync(file, ['--version'], { encoding: 'utf8' })
  assert.equal(executed.status, 0, executed.stderr)
  assert.equal(executed.stdout.trim(), Bun.version)
  const invalid = path.join(directory, 'invalid.exe')
  await fs.writeFile(invalid, 'not a PE')
  await assert.rejects(setWindowsExecutableVersion(invalid, '1.2.3'))
  assert.equal(await fs.readFile(invalid, 'utf8'), 'not a PE')
  await assert.rejects(setWindowsExecutableVersion(path.join(directory, 'missing.exe'), '1.2.3'))
})

// --- подпись Manifest v1 ----------------------------------------------------

test('Manifest v1: macOS и Windows подписываются байт-в-байт и защищают installer', async () => {
  await feedFixture(macTarget, '1.0.8', async (directory, input) => {
    const before = await fs.readFile(path.join(input, compatibilityManifestFileName(macTarget)))
    const { generateUpdateFeed, signUpdateFeed, verifyUpdateFeed } = await import('../../scripts/update-feed')
    const manifest = await generateUpdateFeed(input, undefined, macTarget, '1.0.8')
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.distributions, undefined)
    const { privateKey, keys } = keypair(), output = path.join(directory, 'signed')
    await signUpdateFeed(input, undefined, output, macTarget, '1.0.8', 'fixture', privateKey, keys)
    const verified = await verifyUpdateFeed(output, macTarget, '1.0.8', keys)
    assert.equal(verified.manifest.hash, 'fixture123')
    assert.deepEqual(await fs.readFile(path.join(output, manifestFileName(macTarget))), await fs.readFile(path.join(output, compatibilityManifestFileName(macTarget))))
    assert.deepEqual(await fs.readFile(path.join(input, compatibilityManifestFileName(macTarget))), before)
    const file = path.join(output, manifestFileName(macTarget))
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('fixture123', 'tampered12'))
    await assert.rejects(verifyUpdateFeed(output, macTarget, '1.0.8', keys))
  })

  await feedFixture(winTarget, '1.0.8', async (directory, input) => {
    const { signUpdateFeed, verifyUpdateFeed } = await import('../../scripts/update-feed')
    const { privateKey, keys } = keypair(), output = path.join(directory, 'signed')
    const signed = await signUpdateFeed(input, undefined, output, winTarget, '1.0.8', 'fixture', privateKey, keys)
    assert.equal(signed.installer?.file, 'xneon-launcher-1.0.8-win-x64.exe')
    const document = JSON.parse(await fs.readFile(path.join(output, compatibilityManifestFileName(winTarget)), 'utf8'))
    assert.equal(document.schemaVersion, 1)
    assert.match(document.installer.sha256, /^[a-f0-9]{64}$/)
    assert.match(document.artifact.tarSha256, /^[a-f0-9]{64}$/)
    await fs.writeFile(path.join(output, signed.installer.file), Buffer.alloc(1024 ** 2 + 16, 1))
    await assert.rejects(verifyUpdateFeed(output, winTarget, '1.0.8', keys))
  })
})

test('Manifest v1 Linux: потоковый Zstd, tarSize и пять distributions', async () => {
  const { generateUpdateFeed, signUpdateFeed, verifyUpdateFeed } = await import('../../scripts/update-feed')
  await feedFixture(linuxTarget, '1.0.8', async (directory, input, packages) => {
    const archive = await fs.readFile(path.join(input, nativeArchiveName(linuxTarget)))
    assert.equal(archive[4] >> 6, 0)
    const { privateKey, keys } = keypair(), output = path.join(directory, 'signed')
    const signed = await signUpdateFeed(input, packages, output, linuxTarget, '1.0.8', 'fixture', privateKey, keys)
    const verified = await verifyUpdateFeed(output, linuxTarget, '1.0.8', keys)
    assert.equal(verified.manifest.artifact.downloadSize, archive.length)
    assert.ok(verified.manifest.artifact.tarSize > 0)
    assert.deepEqual(Object.keys(signed.distributions ?? {}).sort(), [...unixDistributions].sort())
    await fs.writeFile(path.join(output, signed.distributions.deb.file), 'tampered')
    await assert.rejects(verifyUpdateFeed(output, linuxTarget, '1.0.8', keys))
    await fs.rm(path.join(packages, signed.distributions.rpm.file))
    await assert.rejects(generateUpdateFeed(input, packages, linuxTarget, '1.0.8'))
  }, true)

  await feedFixture(linuxTarget, '1.0.8', async (_directory, input, packages) => {
    const file = path.join(input, compatibilityManifestFileName(linuxTarget))
    const local = JSON.parse(await fs.readFile(file, 'utf8'))
    await fs.writeFile(file, JSON.stringify({ ...local, artifact: { ...local.artifact, tarSize: local.artifact.tarSize + 512 } }))
    await assert.rejects(generateUpdateFeed(input, packages, linuxTarget, '1.0.8'))
  }, true)
})

test('Manifest v1: чужая платформа, подпись и несовпадение identity отвергаются', async () => {
  const { generateUpdateFeed } = await import('../../scripts/update-feed')
  await feedFixture(macTarget, '1.0.8', async (_directory, input) => {
    await assert.rejects(generateUpdateFeed(input, undefined, macTarget, '1.0.9'))
    await assert.rejects(generateUpdateFeed(input, undefined, { ...macTarget, arch: 'x64' }, '1.0.8'))
  })
  await feedFixture(macTarget, '1.0.8', async (directory, input) => {
    const { signUpdateFeed, verifyUpdateFeed } = await import('../../scripts/update-feed')
    const { privateKey, keys } = keypair(), output = path.join(directory, 'signed')
    await signUpdateFeed(input, undefined, output, macTarget, '1.0.8', 'fixture', privateKey, keys)
    const bytes = await fs.readFile(path.join(output, manifestFileName(macTarget)))
    const signature = await fs.readFile(path.join(output, manifestFileName(macTarget) + '.sig'))
    await assert.rejects(verifyUpdateFeed(output, winTarget, '1.0.8', keys))
    assert.throws(() => verifySignedUpdateManifest(bytes, signature, keypair().keys, macTarget), /signature/)
    assert.throws(() => verifySignedUpdateManifest(Buffer.from(bytes.toString().replace('fixture123', 'evil12345')), signature, keys, macTarget), /signature/)
  })
})

// --- проверка подписанной выдачи, сборка и checksums ------------------------

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
    'node:assert/strict': { ...assert, deepEqual: (actual, expected, message) => assert.deepEqual(Array.from(actual), Array.from(expected), message) },
  }, { Bun: streamingBun, Buffer, process })
  const windowsTarget = [{ platform: 'win', arch: 'x64', channel: 'stable' }]
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, '.tmp/ci-signatures-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const installerBytes = Buffer.from('fixture installer')
  await fs.writeFile(path.join(directory, 'xneon-launcher-1.2.3-win-x64.exe'), installerBytes)
  const channel = 'stable'
  const archiveSet = windowsNativeArchive('1.2.3', 'fixture123', channel)
  const archive = archiveSet.compressed
  const { tarSize, tarSha256 } = archiveSet
  const name = channel + '-win-x64-update-v2.json'
  const canonical = channel + '-win-x64-update.json'
  const file = channel + '-win-x64-XneonLauncher.tar.zst'
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, identifier: appIdentifier, channel,
    version: '1.2.3', platform: 'win', arch: 'x64', hash: 'fixture123',
    installer: { file: 'xneon-launcher-1.2.3-win-x64.exe', size: installerBytes.length, sha256: hash(installerBytes) },
    artifact: { file, tarSize, tarSha256, downloadSize: archive.length, downloadSha256: hash(archive) } }))
  await fs.writeFile(path.join(directory, file), archive)
  for (const manifestName of [canonical, name]) {
    await fs.writeFile(path.join(directory, manifestName), bytes)
    await fs.writeFile(path.join(directory, manifestName + '.sig'), JSON.stringify({ keyId: 'fixture', signature: sign(null, bytes, privateKey).toString('base64') }))
  }
  await verifySignedUpdateFeed(directory, '1.2.3', windowsTarget)
  assert.equal(streams.size, 6)
  assert.ok([...streams.values()].every(count => count === 1), 'One read must serve signed digest and transport checksum within one verification')
  const originalChecksums = await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
  await verifySignedUpdateFeed(directory, '1.2.3', windowsTarget)
  assert.ok([...streams.values()].every(count => count === 2), 'A new trust boundary must read the actual bytes again')
  assert.equal(await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), originalChecksums)
  const installerPath = path.join(directory, 'xneon-launcher-1.2.3-win-x64.exe')
  await fs.writeFile(installerPath, 'Fixture installer')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3', windowsTarget), /Installer/, 'Same-size installer tampering must break the signed hash')
  await fs.writeFile(installerPath, installerBytes)
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), 'tampered')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3', windowsTarget), /checksum/i)
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), originalChecksums)
  const archivePath = path.join(directory, 'stable-win-x64-XneonLauncher.tar.zst')
  const originalArchive = await fs.readFile(archivePath)
  const changedArchive = Buffer.from(originalArchive)
  changedArchive[0] ^= 1
  await fs.writeFile(archivePath, changedArchive)
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3', windowsTarget), 'Signed SHA256 must reject same-size changes')
  await fs.appendFile(archivePath, 'extra byte')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3', windowsTarget), 'Signed downloadSize must reject a different size')
  await fs.writeFile(archivePath, originalArchive)
  await fs.writeFile(path.join(directory, 'unexpected.zip'), 'extra')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3', windowsTarget), /Unexpected/)
  await fs.rm(path.join(directory, 'unexpected.zip'))
  await fs.writeFile(path.join(directory, 'canary-win-x64-update-v2.json'), '{}')
  await fs.writeFile(path.join(directory, 'canary-win-x64-update-v2.json.sig'), '{}')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3', windowsTarget), /Unexpected/, 'Стабильный релиз не принимает canary-файлы')
  await fs.rm(path.join(directory, 'canary-win-x64-update-v2.json'))
  await fs.rm(path.join(directory, 'canary-win-x64-update-v2.json.sig'))
  await fs.appendFile(path.join(directory, 'stable-win-x64-update.json'), ' ')
  await fs.appendFile(path.join(directory, 'stable-win-x64-update-v2.json'), ' ')
  await assert.rejects(verifySignedUpdateFeed(directory, '1.2.3', windowsTarget), /signature/)
})

test('release assembly связывает signed bytes с native выдачей и повторно проверяет весь allowlist', { timeout: 60_000 }, async t => {
  const { nativeArtifactNames } = await native()
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
    else if (name.endsWith('.AppImage')) {
      bytes.set([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x41, 0x49, 0x02], 0)
      bytes.writeUInt16LE(62, 18)
    }
    else bytes.set([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], 0)
    return bytes
  }
  const packages = path.join(input, 'native-linux-x64-packages')
  await fs.mkdir(input, { recursive: true })
  await fs.mkdir(packages)
  const packageNames = ['xneon-launcher-1.2.3-amd64.deb', 'xneon-launcher-1.2.3-x86_64.rpm', 'xneon-launcher-1.2.3-x86_64.pacman', 'xneon-launcher-1.2.3-x86_64.AppImage', 'xneon-launcher-1.2.3-x64.tar.xz']
  for (const name of packageNames) await fs.writeFile(path.join(packages, name), linuxPackageFixture(name))
  await fs.writeFile(path.join(packages, 'SHA256SUMS.txt'), await checksumText(packages, packageNames))
  await release.verifyLinuxPackages(packages, '1.2.3')
  const signed = path.join(input, 'update-verified')
  await fs.mkdir(signed, { recursive: true })
  const sets = [
    { platform: 'win', arch: 'x64', channel: 'stable', nsis: true },
    { platform: 'linux', arch: 'x64', channel: 'stable' },
    { platform: 'macos', arch: 'arm64', channel: 'stable' },
  ]
  for (const options of sets) {
    const source = path.join(input, `native-${options.platform}-${options.arch}-${options.channel}`)
    await fs.mkdir(source)
    const names = nativeArtifactNames({ ...options, version: '1.2.3' })
    for (const name of names) await fs.writeFile(path.join(source, name), 'native ' + name)
    const { compressed: archive, tarSize, tarSha256 } = options.platform === 'win'
      ? windowsNativeArchive('1.2.3', 'fixture123', options.channel)
      : unixNativeArchive(options.platform, options.arch, '1.2.3', 'fixture123', options.channel)
    await fs.writeFile(path.join(source, names[2]), archive)
    const original = { schemaVersion: 1, identifier: appIdentifier, channel: options.channel, platform: options.platform, arch: options.arch,
      version: '1.2.3', hash: 'fixture123', artifact: { file: names[2], tarSize, tarSha256 } }
    if (options.platform === 'win') {
      const installer = Buffer.from('native ' + names.at(-1))
      await fs.writeFile(path.join(source, names.at(-1)), installer)
      original.installer = { file: names.at(-1), size: installer.length, sha256: hash(installer) }
    }
    await fs.writeFile(path.join(source, names[1]), JSON.stringify(original))
    const manifest = { ...original, artifact: { ...original.artifact, downloadSize: archive.length, downloadSha256: hash(archive) } }
    if (options.platform === 'linux') {
      manifest.distributions = {}
      for (const name of packageNames) {
        const format = unixDistributions.find(value => unixDistributionName('1.2.3', value) === name)
        assert.ok(format, name)
        const bytes = await fs.readFile(path.join(packages, name))
        manifest.distributions[format] = { file: name, downloadSize: bytes.length, downloadSha256: hash(bytes) }
        await fs.copyFile(path.join(packages, name), path.join(signed, name))
      }
    }
    const bytes = Buffer.from(JSON.stringify(manifest))
    for (const manifestName of [names[0], names[1]]) {
      await fs.writeFile(path.join(signed, manifestName), bytes)
      await fs.writeFile(path.join(signed, manifestName + '.sig'), JSON.stringify({ keyId: 'fixture', signature: sign(null, bytes, privateKey).toString('base64') }))
    }
    await fs.copyFile(path.join(source, names[2]), path.join(signed, names[2]))
    if (options.platform === 'win') await fs.copyFile(path.join(source, names.at(-1)), path.join(signed, names.at(-1)))
    await fs.writeFile(path.join(source, 'SHA256SUMS.txt'), await checksumText(source, names))
  }
  const portable = path.join(input, 'native-win-x64-portable')
  await fs.mkdir(portable)
  const portableName = 'xneon-launcher-1.2.3-win-x64-portable.zip'
  await fs.writeFile(path.join(portable, portableName), 'separate portable fixture')
  await fs.writeFile(path.join(portable, 'SHA256SUMS.txt'), await checksumText(portable, [portableName]))
  const outsideSigned = path.join(directory, 'signed')
  await fs.rename(signed, outsideSigned)
  await release.checkCandidates(input, '1.2.3')
  assert.equal(inspections, 3)
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
  assert.equal(inspections, 6)
  assert.equal((await fs.readdir(output)).length, 26)
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
  await assert.rejects(release.assemblePublication(input, path.join(directory, 'substituted'), '1.2.3'), /Installer/, 'Подмена установщика ловится подписанным манифестом')

  const canaryInput = path.join(directory, 'canary-input')
  await fs.mkdir(canaryInput, { recursive: true })
  for (const options of [
    { platform: 'win', arch: 'x64', channel: 'canary', nsis: true },
    { platform: 'linux', arch: 'x64', channel: 'canary' },
    { platform: 'macos', arch: 'arm64', channel: 'canary' },
  ]) {
    const source = path.join(canaryInput, `native-${options.platform}-${options.arch}-canary`)
    await fs.mkdir(source)
    const names = nativeArtifactNames({ ...options, version: '1.2.3-pre1' })
    for (const name of names) await fs.writeFile(path.join(source, name), 'canary ' + name)
    await fs.writeFile(path.join(source, 'SHA256SUMS.txt'), await checksumText(source, names))
  }
  const canaryPackages = path.join(canaryInput, 'native-linux-x64-packages')
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
  await fs.symlink(path.join(directory, 'folder'), path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(checksumText(directory, ['linked']), /Invalid artifact/)
  await assert.rejects(verifyChecksums(directory, ['a.zip', 'b.zip']), /Unexpected/)
})