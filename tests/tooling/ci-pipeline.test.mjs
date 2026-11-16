import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { loadReactModule } from '../helpers/react-module.mjs'
import { appIdentifier } from '../../electrobun/main/app-identity.ts'

const root = path.resolve(import.meta.dir, '../..')
const pipeline = () => import('../../scripts/ci-pipeline.ts')
const repository = 'MAINER4IK/Xneon-Launcher-bun'
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
  for (const name of ['xneon-launcher-1.2.3-win-x64.exe', 'xneon-launcher-1.2.3-win-x64-portable.zip', 'macos-arm64-XneonLauncher.dmg', 'linux-x64-XneonLauncher-Setup.tar.gz']) assert.ok(names.includes(name), name)
  assert.ok(!names.some(name => /latest|blockmap|\.deb$|\.rpm$|\.AppImage$/.test(name)))
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

test('единый workflow имеет корректный DAG, разделяет секреты и write permissions', async () => {
  assert.deepEqual((await fs.readdir(path.join(root, '.github/workflows'))).sort(), ['ci.yml'])
  const source = await fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  const workflow = Bun.YAML.parse(source)
  assert.ok(workflow.on.push.tags.includes('v*'))
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'))
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'))
  assert.ok(!workflow.on.workflow_dispatch?.inputs, 'No scenario/promotion inputs')
  const jobs = workflow.jobs
  assert.deepEqual(Object.keys(jobs), ['tests', 'build', 'release'])
  const visit = (name, trail = []) => {
    assert.ok(jobs[name], 'Unknown dependency: ' + name)
    assert.ok(!trail.includes(name), 'Cycle: ' + [...trail, name])
    for (const dependency of [jobs[name].needs ?? []].flat()) visit(dependency, [...trail, name])
  }
  for (const [name, job] of Object.entries(jobs)) {
    visit(name)
    assert.ok(!job.uses, 'No reusable workflows')
    if (/\$\{\{[^}]*\bsecrets\./.test(JSON.stringify(job))) assert.equal(name, 'release')
    if (job.permissions?.contents === 'write') assert.equal(name, 'release')
  }
  assert.ok(jobs.release.if.includes("startsWith(github.ref, 'refs/tags/v')"))
  assert.deepEqual(jobs.release.needs, ['tests', 'build'])
  assert.equal(jobs.build.needs, 'tests')
  assert.ok(jobs.build.if.includes("github.event_name == 'workflow_dispatch'"))
  assert.equal(jobs.tests['runs-on'], 'ubuntu-24.04')
  assert.equal(jobs.tests['timeout-minutes'], 15)
  assert.ok(!jobs.tests.strategy, 'Fast tests run once, not on every OS')
  assert.ok(jobs.tests.steps.some(step => step.run === 'bun scripts/ci-pipeline.ts guard-tag' && step.if.includes('refs/tags/v')), 'Check tag ancestry before entering the protected job')
  assert.equal(jobs.build.strategy.matrix.include.length, 4)
  assert.ok(jobs.build.strategy.matrix.include.some(item => item.runner === 'macos-15-intel'))
  assert.equal(jobs.build.strategy['fail-fast'], false)
  assert.equal(jobs.build.strategy['max-parallel'], 3)
  assert.ok(jobs.build.steps.some(step => step.if === "runner.os != 'Linux'" &&
    step.run?.includes('tests/electrobun/platform-desktop.test.ts') &&
    step.run.includes('tests/electrobun/platform-secrets.test.ts') &&
    step.run.includes('tests/electrobun/platform-unix.test.ts') &&
    step.run.includes('PE metadata')), 'Windows/macOS native cases skipped on Ubuntu must run on their real targets')
  const releaseSteps = jobs.release.steps
  assert.equal(secretSteps.length, 1)
  assert.ok(!secretSteps[0].uses, 'Private key is scoped to the signing command only')
  const commands = releaseSteps.map(step => step.run ?? '')
  const check = commands.findIndex(command => command.includes('ci-pipeline.ts check'))
  const assemble = commands.findIndex(command => command.includes('ci-pipeline.ts assemble'))
  const publish = releaseSteps.findIndex(step => step.uses === 'softprops/action-gh-release@v2')
  assert.ok(check >= 0 && check < assemble && assemble < publish)
  const publishStep = releaseSteps[publish]
  assert.equal(publishStep.with.prerelease, '${{ steps.release.outputs.prerelease == \'true\' }}')
  assert.ok(releaseSteps.some(step => step.uses === 'orhun/git-cliff-action@v4'))
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
