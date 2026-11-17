import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
const runner = new URL('scripts/run-offline-tests.mjs', root)
const manifest = () => JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'))

test('IPC catalog check принимает LF/CRLF без перезаписи и отклоняет настоящий drift', () => {
  const temporary = new URL('.tmp/', root)
  fs.mkdirSync(temporary, { recursive: true })
  const fixture = fs.mkdtempSync(path.join(fileURLToPath(temporary), 'ipc-catalog-eol-'))
  const output = path.join(fixture, 'packages/xnlc-agent/src/launcher-ipc-catalog.ts')
  const generator = fileURLToPath(new URL('scripts/gen-agent-ipc-catalog.mjs', root))
  const run = (...args) => spawnSync(process.execPath, [generator, ...args], { cwd: fixture, encoding: 'utf8' })
  const write = (name, text) => {
    const target = path.join(fixture, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  try {
    write('packages/xnlc-types/src/ipc-contracts.ts', [
      'export interface IpcInvokeMap {', '  "fixture:invoke": unknown', '}',
      'export interface IpcEventMap {', '  "fixture:event": unknown', '}',
      'export interface ElectrobunAPIExplicit {', '  fetchFixture: () => Promise<string>', '}', '',
    ].join('\r\n'))
    write('electrobun/preload.ts', 'installDesktopApi({\r\n  fetchFixture: () => invoke("fixture:invoke"),\r\n})\r\n')
    write('electrobun/main/mc-server-handlers.ts', 'rpcRegistry.handle("fixture:invoke", () => "fixture")\r\n')
    write('packages/xnlc-agent/src/launcher-ipc-catalog.ts', '')
    const generated = run()
    assert.equal(generated.status, 0, generated.stderr)
    const canonical = fs.readFileSync(output, 'utf8')
    assert.ok(canonical.includes('fetchFixture'))
    for (const ending of ['\n', '\r\n']) {
      const expected = canonical.replace(/\r?\n/g, ending)
      fs.writeFileSync(output, expected)
      const checked = run('--check')
      assert.equal(checked.status, 0, checked.stderr)
      assert.equal(fs.readFileSync(output, 'utf8'), expected)
    }
    const stale = canonical.replace('fetchFixture', 'staleFixture').replace(/\n/g, '\r\n')
    fs.writeFileSync(output, stale)
    const rejected = run('--check')
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /IPC catalog is outdated/)
    assert.equal(fs.readFileSync(output, 'utf8'), stale)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('prepared gate не собирает workspace повторно и сохраняет все группы', () => {
  const scripts = manifest().scripts
  assert.equal(scripts['test:offline:prepared'], 'bun scripts/run-offline-tests.mjs')
  assert.equal(scripts['test:offline'], 'bun run test:prepare && bun run test:offline:prepared')
  const result = spawnSync(process.execPath, [fileURLToPath(runner), '--list'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const groups = JSON.parse(result.stdout)
  assert.deepEqual(groups.map(group => group.name), ['desktop', 'parser-unit', 'parser-integration', 'archives', 'security-agent', 'share-domain', 'liveops-client', 'tooling'])
  assert.ok(groups.every(group => !group.args.includes('run')))
  assert.deepEqual(groups.filter(group => group.name.startsWith('share-')).map(group => group.args), [
    ['test', 'packages/xnlc-share/tests'],
  ])
  const invalid = spawnSync(process.execPath, [fileURLToPath(runner), '--typo'], { encoding: 'utf8' })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /Unknown offline runner argument/)
})

test('parser selection покрывает каждый test-файл ровно одним режимом', async () => {
  const { parserTestFiles } = await import('../../scripts/test-parser.mjs')
  const expected = fs.readdirSync(new URL('packages/xnlc-parser/tests/', root)).filter(file => file.endsWith('.test.ts')).sort()
  const groups = ['offline', 'integration', 'live'].map(mode => parserTestFiles(mode).map(file => file.split('/').at(-1)))
  assert.deepEqual(groups.flat().sort(), expected)
  assert.equal(new Set(groups.flat()).size, expected.length)
  assert.deepEqual(groups[2], ['real-world.test.ts'])
  assert.throws(() => parserTestFiles('typo'), /Unknown parser test suite/)
})

test('dispatcher прекращает работу при ошибке и передаёт exit status', async () => {
  const { runOfflineTests } = await import('../../scripts/run-offline-tests.mjs')
  const calls = []
  const code = runOfflineTests((executable, args, options) => {
    calls.push({ executable, args, options })
    return { status: calls.length === 2 ? 23 : 0 }
  })
  assert.equal(code, 23)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].executable, process.execPath)
  assert.equal(calls[0].options.env.XNLC_PARSER_LIVE_TESTS, '0')
  assert.equal(calls[0].options.stdio, 'inherit')
  assert.ok(calls[0].args.includes('--reporter=junit'))
  const desktopJunit = calls[0].args.find(arg => arg.startsWith('--reporter-outfile='))
  assert.ok(desktopJunit.endsWith('desktop.xml'))
  assert.equal(calls[1].args[0], 'scripts/test-parser.mjs')
  assert.ok(calls[1].options.env.XNLC_PARSER_JUNIT.endsWith('parser-unit.xml'))
  assert.notEqual(desktopJunit, calls[1].options.env.XNLC_PARSER_JUNIT)
  assert.ok(!calls[0].options.env.XNLC_PARSER_JUNIT)
  assert.throws(() => runOfflineTests(() => ({ error: new Error('spawn failed') })), /spawn failed/)
  assert.equal(runOfflineTests(() => ({ status: null })), 1)
  assert.equal(runOfflineTests(() => ({ status: 0 })), 0)
})

test('JUnit сводка считает физические файлы, а не вложенные describe suites', async () => {
  const { runOfflineTests } = await import('../../scripts/run-offline-tests.mjs')
  const lines = [], log = console.log
  const xml = '<testsuites tests="3" skipped="1" failures="0" time="0.4"><testsuite file="tests/one.test.ts"><testsuite file="tests/one.test.ts"><testcase file="tests/one.test.ts" /></testsuite></testsuite><testsuite file="tests/two.test.ts"><testcase file="tests/two.test.ts" /></testsuite></testsuites>'
  try {
    console.log = (...args) => lines.push(args.join(' '))
    assert.equal(runOfflineTests((_executable, args, options) => {
      const output = args.find(arg => arg.startsWith('--reporter-outfile='))?.slice('--reporter-outfile='.length) ?? options.env.XNLC_PARSER_JUNIT
      fs.writeFileSync(output, xml)
      return { status: 0 }
    }), 0)
  } finally { console.log = log }
  assert.match(lines.find(line => /^desktop\s/.test(line)), /^desktop\s+2\s+3\s+2\s+1\s+0\s/)
})

test('каждый JS/TS suite проекта входит ровно в одну группу или явный внешний набор', async () => {
  const { OFFLINE_SUITES } = await import('../../scripts/run-offline-tests.mjs')
  const { parserTestFiles } = await import('../../scripts/test-parser.mjs')
  const parser = new Set([...parserTestFiles('offline'), ...parserTestFiles('integration')].map(file => file.replace(/^\.\//, '')))
  const external = new Set(parserTestFiles('live').map(file => file.replace(/^\.\//, '')))
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  for (const file of new Set(result.stdout.split('\0'))) {
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || !fs.existsSync(new URL(file, root))) continue
    const matches = OFFLINE_SUITES.filter(group => group.name.startsWith('parser-')
      ? parserTestFiles(group.name === 'parser-unit' ? 'offline' : 'integration').includes('./' + file)
      : group.args.slice(1).some(directory => file.startsWith(directory + '/')))
    assert.equal(matches.length + Number(external.has(file)), 1, 'Missing/duplicate suite: ' + file)
    if (file.startsWith('packages/xnlc-parser/tests/') && !external.has(file)) assert.ok(parser.has(file))
  }
})

test('CI использует prepared gate после prepare; parser runner не ignored', () => {
  const workflow = Bun.YAML.parse(fs.readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'))
  const commands = workflow.jobs.tests.steps.map(step => step.run ?? '')
  assert.equal(commands.filter(command => command === 'bun run prepare:desktop').length, 1)
  assert.equal(commands.filter(command => command === 'bun run test:offline:prepared').length, 1)
  assert.ok(commands.indexOf('bun run prepare:desktop') < commands.indexOf('bun run test:offline:prepared'))
  assert.ok(commands.indexOf('bun scripts/gen-agent-ipc-catalog.mjs --check') >= 0)
  assert.ok(commands.indexOf('bun scripts/gen-agent-ipc-catalog.mjs --check') < commands.indexOf('bun run prepare:desktop'), 'Catalog drift must fail before generation can overwrite it')
  const transpile = commands.indexOf('bun scripts/build-electrobun-tests.mjs')
  assert.ok(transpile > commands.indexOf('bun run prepare:desktop'))
  assert.ok(transpile < commands.indexOf('bun run test:offline:prepared'))
  assert.ok(!commands.some(command => /bun run test:(desktop|parser|integration|archives|security|share)\b/.test(command)))
  const ignored = spawnSync('git', ['check-ignore', '--no-index', 'scripts/test-parser.mjs'], { cwd: root, encoding: 'utf8' })
  assert.equal(ignored.status, 1, ignored.stdout + ignored.stderr)
})

test('основной main typecheck включает все TypeScript build/CI scripts без отдельного tsc в workflow', () => {
  const result = spawnSync(process.execPath, ['--bun', 'run', 'tsc', '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 })
  assert.equal(result.status, 0, result.stderr)
  const files = new Set(result.stdout.split(/\r?\n/).map(file => file.replaceAll('\\', '/')))
  for (const file of fs.readdirSync(new URL('scripts/', root)).filter(file => file.endsWith('.ts'))) {
    assert.ok([...files].some(item => item.endsWith('/scripts/' + file)), 'Not covered by typecheck: ' + file)
  }
  const workflow = Bun.YAML.parse(fs.readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'))
  assert.ok(!workflow.jobs.tests.steps.some(step => /\btsc\b/.test(step.run ?? '')), 'One main tsconfig must cover tooling without an overlapping CI invocation')
})

test('prepare проверяет типы каждого workspace; CI не повторяет те же десять tsc --noEmit', () => {
  const scripts = manifest().scripts
  assert.ok(scripts['prepare:desktop'].includes('bun run --filter "@xnlc/*" build'))
  assert.equal(scripts['typecheck:workspaces'], 'bun scripts/check-workspaces.mjs', 'Standalone diagnostics must remain available')
  for (const directory of fs.readdirSync(new URL('packages/', root))) {
    const config = new URL(`packages/${directory}/tsconfig.json`, root)
    if (!fs.existsSync(config)) continue
    const pkg = JSON.parse(fs.readFileSync(new URL(`packages/${directory}/package.json`, root), 'utf8'))
    assert.ok(pkg.name.startsWith('@xnlc/'), 'prepare filter must cover ' + directory)
    assert.match(pkg.scripts.build, /(?:^|&&\s*)bun --bun run tsc -p tsconfig\.json\s*(?:&&|$)/, 'build must typecheck the same config without --noCheck: ' + directory)
  }
  const workflow = Bun.YAML.parse(fs.readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'))
  assert.ok(!workflow.jobs.tests.steps.some(step => step.run === 'bun run typecheck:workspaces'))
})

test('IPC --check отвергает drift, не исправляя проверяемый каталог', t => {
  fs.mkdirSync(new URL('.hutch/', root), { recursive: true })
  const temporary = fs.mkdtempSync(new URL('.hutch/ipc-check-', root))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  // Минимальный согласованный контракт проверяет --check без копирования всего main.
  const files = {
    'scripts/gen-agent-ipc-catalog.mjs': fs.readFileSync(new URL('scripts/gen-agent-ipc-catalog.mjs', root), 'utf8'),
    'packages/xnlc-types/src/ipc-contracts.ts': 'export interface IpcInvokeMap {\n  "fixture:call": () => void\n}\nexport interface IpcEventMap {}\nexport interface ElectrobunAPIExplicit {\n  call: () => Promise<void>\n}\n',
    'electrobun/preload.ts': 'installDesktopApi({\n  call: () => invoke("fixture:call"),\n})\n',
    'electrobun/main/mc-server-handlers.ts': 'rpcRegistry.handle("fixture:call", () => {})\n',
    'packages/xnlc-agent/src/launcher-ipc-catalog.ts': '',
  }
  for (const [file, contents] of Object.entries(files)) {
    const destination = path.join(temporary, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, contents)
  }
  const generated = spawnSync(process.execPath, ['scripts/gen-agent-ipc-catalog.mjs'], { cwd: temporary, encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  const catalog = path.join(temporary, 'packages/xnlc-agent/src/launcher-ipc-catalog.ts')
  fs.appendFileSync(catalog, '\n// drift\n')
  const changed = fs.readFileSync(catalog, 'utf8')
  const check = spawnSync(process.execPath, ['scripts/gen-agent-ipc-catalog.mjs', '--check'], { cwd: temporary, encoding: 'utf8' })
  assert.notEqual(check.status, 0)
  assert.match(check.stderr, /IPC catalog is outdated/)
  assert.equal(fs.readFileSync(catalog, 'utf8'), changed)
})
