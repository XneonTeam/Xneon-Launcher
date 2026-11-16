import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

for (const file of await fs.readdir('.github/workflows')) {
  if (!/\.ya?ml$/.test(file)) continue
  const workflow = Bun.YAML.parse(await fs.readFile('.github/workflows/' + file, 'utf8'))
  assert.ok(workflow && typeof workflow === 'object' && workflow.jobs, 'Invalid workflow: ' + file)
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(job.uses || job['runs-on'], `Missing runner/reusable job: ${file}/${name}`)
    if (job.steps) assert.ok(Array.isArray(job.steps), `Invalid steps: ${file}/${name}`)
  }
  console.log('YAML:', file)
}
const ci = Bun.YAML.parse(await fs.readFile('.github/workflows/ci.yml', 'utf8'))
assert.ok(ci.on.push && Object.hasOwn(ci.on, 'pull_request'), 'CI must gate push and PR')
assert.deepEqual((await fs.readdir('.github/workflows')).filter(file => /\.ya?ml$/.test(file)), ['ci.yml'])
assert.ok(ci.on.push.tags.includes('v*') && Object.hasOwn(ci.on, 'workflow_dispatch'), 'CI must support tags and manual builds')
assert.deepEqual(Object.keys(ci.jobs), ['tests', 'build', 'release'])
assert.equal(ci.jobs.tests['runs-on'], 'ubuntu-24.04')
assert.equal(ci.jobs.tests['timeout-minutes'], 15)
assert.deepEqual(ci.jobs.build.strategy.matrix.include.map(target => target.target), ['win-x64', 'linux-x64', 'macos-arm64', 'macos-x64'])
for (const [name, job] of Object.entries(ci.jobs)) {
  assert.ok(!job.uses, 'Reusable workflows are not allowed: ' + name)
  const visit = (current, parents = []) => {
    assert.ok(ci.jobs[current], 'Unknown dependency: ' + current)
    assert.ok(!parents.includes(current), 'Cyclic job dependencies: ' + [...parents, current])
    for (const dependency of [ci.jobs[current].needs ?? []].flat()) visit(dependency, [...parents, current])
  }
  visit(name)
  if (/\$\{\{[^}]*\bsecrets\./.test(JSON.stringify(job))) assert.equal(name, 'release')
  if (job.permissions?.contents === 'write') assert.equal(name, 'release')
}
const wrangler = JSON.parse(await fs.readFile('infrastructure/xnlc-share/wrangler.jsonc', 'utf8'))
assert.equal(wrangler.$schema, 'https://unpkg.com/wrangler@4.160.0/config-schema.json')
assert.ok(wrangler.compatibility_flags.includes('nodejs_compat'))
assert.ok(wrangler.durable_objects.bindings.some(item => item.class_name === 'ShareService'))
await fs.access('infrastructure/xnlc-share/' + wrangler.main)
assert.equal((await fs.readFile('build/installer.nsi', 'utf8')).includes('build-windows-nsis.ts'), false)
const config = JSON.parse(await fs.readFile('tsconfig.json', 'utf8'))
assert.ok(!config.include.some(item => item.startsWith('hooks/')))
console.log('Config: CI triggers/matrix, NSIS references, tsconfig includes, Worker entry/bindings/schema OK')
