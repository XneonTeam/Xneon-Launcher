import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const dir = '.github/workflows'
const files = (await fs.readdir(dir)).filter(file => /\.ya?ml$/.test(file)).sort()
assert.deepEqual(files, ['ci.yml', 'pre-release.yml', 'release.yml'],
  'Only validation, stable release and prerelease workflows exist')
const load = async file => Bun.YAML.parse(await fs.readFile(dir + '/' + file, 'utf8'))
const source = Object.fromEntries(await Promise.all(files.map(async file => [file, await fs.readFile(dir + '/' + file, 'utf8')])))
// OAuth client_id/secret нужны сборочным job'ам: prepare:desktop пишет их в
// credentials.generated.ts. Всё остальное (ключ подписи) остаётся в release.
const BUILD_CREDENTIALS = new Set([
  'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'DROPBOX_CLIENT_ID', 'YANDEX_CLIENT_ID',
  'ONEDRIVE_CLIENT_ID', 'ELY_CLIENT_ID', 'ELY_CLIENT_SECRET', 'ELY_DEVICE_CLIENT_ID',
  'XN_CLIENT_ID', 'XN_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_DEVICE_CLIENT_ID',
])
for (const file of files) {
  const workflow = Bun.YAML.parse(source[file])
  assert.ok(workflow && typeof workflow === 'object' && workflow.jobs, 'Invalid workflow: ' + file)
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(job.uses || job['runs-on'], `Missing runner/reusable job: ${file}/${name}`)
    assert.ok(!job.uses, 'Reusable workflows are not allowed: ' + file + '/' + name)
    if (job.steps) assert.ok(Array.isArray(job.steps), `Invalid steps: ${file}/${name}`)
    for (const [, secret] of JSON.stringify(job).matchAll(/\bsecrets\.([A-Z0-9_]+)/g)) {
      assert.ok(name === 'release' || BUILD_CREDENTIALS.has(secret), `Only build credentials leave the signing job: ${file}/${name} -> ${secret}`)
    }
    assert.ok(name === 'release' || !JSON.stringify(job).includes('XNLC_UPDATE_PRIVATE_KEY'),
      'Update signing key stays in the protected release job: ' + file + '/' + name)
    if (job.permissions?.contents === 'write') assert.equal(name, 'release', `Write permissions only in the signing job: ${file}/${name}`)
    if (job.environment) assert.equal(name, 'release', `Protected environment only in the signing job: ${file}/${name}`)
    const visit = (current, parents = []) => {
      assert.ok(workflow.jobs[current], `Unknown dependency: ${file}/${current}`)
      assert.ok(!parents.includes(current), `Cyclic job dependencies: ${file}/${[...parents, current]}`)
      for (const dependency of [workflow.jobs[current].needs ?? []].flat()) visit(dependency, [...parents, current])
    }
    visit(name)
  }
  console.log('YAML:', file)
}

const ci = await load('ci.yml')
assert.ok(ci.on.push && ci.on.push.branches?.includes('main'), 'CI must validate pushes to main')
assert.ok(Object.hasOwn(ci.on, 'pull_request') && Object.hasOwn(ci.on, 'workflow_dispatch'), 'CI must gate PRs and allow manual runs')
assert.ok(!ci.on.push.tags, 'Tag builds belong to release.yml and pre-release.yml')
assert.deepEqual(Object.keys(ci.jobs), ['tests'])
assert.equal(ci.jobs.tests['runs-on'], 'ubuntu-24.04')
assert.equal(ci.jobs.tests['timeout-minutes'], 15)

const pipeline = async (file, channel, tagPattern, label) => {
  const workflow = await load(file)
  assert.deepEqual(Object.keys(workflow.jobs), ['tests', 'build', 'build-linux', 'build-macos', 'release'], `${label} has checks, one build per published platform and the publish job`)
  for (const [job, runner, platform, arch] of [
    ['build-linux', 'ubuntu-24.04', 'linux', 'x64'],
    ['build-macos', 'macos-26', 'macos', 'arm64'],
  ]) {
    const build = workflow.jobs[job]
    assert.equal(build.needs, 'tests')
    assert.equal(build['runs-on'], runner)
    assert.equal(build.env.TARGET_PLATFORM, platform)
    assert.equal(build.env.TARGET_ARCH, arch)
    assert.ok(build.if.includes("startsWith(github.ref, 'refs/tags/v')"), `${label} builds ${platform} for release tags`)
    assert.ok(build.steps.some(step => step.with?.name === `native-${platform}-${arch}-\${{ env.CHANNEL }}`), `${label} uploads the ${platform} publication payload`)
  }
  assert.equal(workflow.env?.CHANNEL, channel, `${label} builds the ${channel} channel`)
  assert.deepEqual(workflow.on.push?.tags, channel === 'stable' ? [tagPattern, '!v*-pre*', '!v*-beta*'] : [tagPattern, 'v*-beta*'], `${label} reacts to its own channel only`)
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'), `${label} supports a manual preflight build`)
  assert.equal(workflow.jobs.build.needs, 'tests')
  assert.deepEqual(workflow.jobs.release.needs, ['tests', 'build', 'build-linux', 'build-macos'])
  assert.equal(workflow.jobs.release.environment, 'release-signing')
  assert.equal(workflow.jobs.release.permissions.contents, 'write')
  assert.deepEqual(workflow.jobs.build.strategy.matrix.include.map(target => target.target), ['win-x64'])
  assert.ok(workflow.jobs.build.strategy.matrix.include.every(item => item.runner === 'windows-2022' && item.arch === 'x64' && item.machine === 'X64'), `${label} builds Windows x64 with NSIS`)
  assert.equal(workflow.jobs.build.strategy['fail-fast'], false)
  assert.equal(workflow.jobs.build.strategy['max-parallel'], 3)
  return workflow
}
const release = await pipeline('release.yml', 'stable', 'v*', 'Stable release')
const prerelease = await pipeline('pre-release.yml', 'canary', 'v*-pre*', 'Prerelease')

const named = (job, name) => job.steps.find(step => step.name === name)
assert.ok(named(release.jobs.build, 'Ensure NSIS'), 'Stable Windows build installs NSIS')
assert.ok(named(release.jobs.build, 'Build and validate independent Portable profile'), 'Stable builds independent portable')
assert.ok(named(prerelease.jobs.build, 'Ensure NSIS'), 'Canary also ships the NSIS installer used for channel switching')
assert.ok(named(prerelease.jobs.build, 'Build and validate independent Portable profile'), 'Prerelease builds independent portable')
assert.equal(named(release.jobs.build, 'Build stable Windows artifacts (NSIS)').run, 'bun run build')
assert.equal(named(prerelease.jobs.build, 'Build canary native artifacts').run, 'bun run build:canary')
assert.ok(release.jobs.tests.steps.some(step => step.run === 'bun scripts/ci-release.ts channel'), 'Stable pipeline asserts its own channel first')
assert.ok(prerelease.jobs.tests.steps.some(step => step.run === 'bun scripts/ci-pre-release.ts channel'), 'Prerelease pipeline asserts its own channel first')
for (const [workflow, channel] of [[release, 'stable'], [prerelease, 'canary']]) {
  const sign = workflow.jobs.release.steps.find(step => step.name?.includes('Sign each published target'))
  assert.ok(sign, 'Every published target is signed in one protected step')
  for (const target of ['win-x64', 'linux-x64', 'macos-arm64']) {
    assert.ok(sign.run.includes(`native-${target}-${channel} signed-`), 'Missing signing command for ' + target)
  }
  assert.ok(sign.run.includes(`native-linux-x64-${channel} signed-linux linux x64 release-candidates/native-linux-x64-packages`), 'Linux signing consumes distributions')
  assert.ok(sign.run.includes(`native-win-x64-${channel} signed-win win x64`), 'Windows signing declares its target')
  assert.ok(sign.run.includes(`native-macos-arm64-${channel} signed-macos macos arm64`), 'macOS signing declares its target')
}
assert.ok(!source['release.yml'].includes('canary-'), 'Stable pipeline never mentions canary artifacts')
assert.ok(!source['pre-release.yml'].includes('stable-'), 'Prerelease pipeline never mentions stable artifacts')

// Тестовые job'ы обоих каналов отличаются только именем скрипта; CI повторяет их без двух tag-шагов.
const steps = job => JSON.stringify(job.steps).replaceAll('ci-pre-release.ts', 'ci-release.ts')
assert.equal(steps(prerelease.jobs.tests), steps(release.jobs.tests), 'Both pipelines share the same checks')
const filtered = release.jobs.tests.steps.filter(step => !/^Check (?:release channel|version tag and main ancestry before the protected release)$/.test(step.name ?? ''))
assert.equal(JSON.stringify(ci.jobs.tests.steps), JSON.stringify(filtered), 'CI runs the same shared checks')

for (const workflow of [release, prerelease]) {
  const releaseSteps = workflow.jobs.release.steps
  const secretSteps = releaseSteps.filter(step => JSON.stringify(step).includes('secrets.'))
  assert.equal(secretSteps.length, 1)
  assert.ok(!secretSteps[0].uses, 'Private key is scoped to the signing command only')
  const commands = releaseSteps.map(step => step.run ?? '')
  const candidates = releaseSteps.find(step => step.uses === 'actions/download-artifact@v8')?.with?.path
  assert.ok(candidates)
  const script = workflow === release ? 'ci-release.ts' : 'ci-pre-release.ts'
  assert.ok(commands.includes(`bun scripts/${script} check ` + candidates))
  assert.ok(commands.includes(`bun scripts/${script} assemble ` + candidates + ' verified'))
  const check = commands.findIndex(command => command.includes(script + ' check'))
  const sign = commands.findIndex(command => command.includes('sign-update-feed.ts'))
  const verify = commands.findIndex(command => command.includes('verify-signed-update-feed.ts'))
  const assemble = commands.findIndex(command => command.includes(script + ' assemble'))
  const publish = releaseSteps.findIndex(step => step.uses === 'softprops/action-gh-release@v2')
  assert.ok(check >= 0 && check < sign && sign < verify && verify < assemble && assemble < publish)
}
assert.equal(named(release.jobs.release, 'Publish only verified native artifacts').with.prerelease, false)
assert.equal(named(release.jobs.release, 'Publish only verified native artifacts').with.make_latest, true)
assert.equal(named(prerelease.jobs.release, 'Publish only verified native artifacts').with.prerelease, true)
assert.equal(named(prerelease.jobs.release, 'Publish only verified native artifacts').with.make_latest, false)
for (const workflow of [release, prerelease]) {
  assert.ok(workflow.jobs.release.steps.some(step => step.run?.includes('scripts/release-notes.ts')))
  assert.ok(!workflow.jobs.release.steps.some(step => step.uses?.includes('git-cliff')))
}

assert.equal((await fs.readFile('build/installer.nsi', 'utf8')).includes('build-windows-nsis.ts'), false)
const config = JSON.parse(await fs.readFile('tsconfig.json', 'utf8'))
assert.ok(!config.include.some(item => item.startsWith('hooks/')))
console.log('Config: CI triggers/matrix, separate release channels, NSIS references, tsconfig includes OK')
