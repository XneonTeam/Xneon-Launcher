import { expect, test } from 'bun:test'
import fs from 'node:fs'
import { browserLink } from '../../lib/external-links.ts'
import { loadReactModule } from '../helpers/react-module.mjs'
import { createServer } from 'vite'
import path from 'node:path'

test('настоящий Vite отдаёт Fast Refresh и присылает HMR update после изменения TSX', async () => {
  const root = path.resolve(import.meta.dir, '../..')
  const directory = fs.mkdtempSync(path.join(root, '.hmr-probe-'))
  const file = path.join(directory, 'probe.tsx')
  fs.writeFileSync(file, 'export default function Probe() { return <p>before</p> }')
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true } })
  let socket
  try {
    await server.listen()
    const address = server.httpServer.address()
    const origin = `http://127.0.0.1:${address.port}`
    const relative = '/' + path.relative(root, file).replaceAll('\\', '/')
    const response = await fetch(origin + relative)
    const code = await response.text()
    expect(response.ok).toBe(true)
    expect(code).toContain('/@react-refresh')
    expect(code).toContain('import.meta.hot')
    socket = new WebSocket(origin.replace('http:', 'ws:') + '/?token=' + server.config.webSocketToken, 'vite-hmr')
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('HMR update timeout')), 10000)
      socket.addEventListener('error', () => { clearTimeout(deadline); reject(new Error('HMR websocket failed')) })
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        if (message.type === 'connected') fs.writeFileSync(file, 'export default function Probe() { return <p>after</p> }')
        if (message.type === 'update' && message.updates.some(update => update.path === relative)) { clearTimeout(deadline); resolve() }
      })
    })
    expect(await (await fetch(origin + relative)).text()).toContain('after')
  } finally {
    socket?.close()
    await server.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}, 20000)

test('HTTP-страница HMR оставляет якоря текущего документа внутри webview', () => {
  const base = 'http://127.0.0.1:5173/'
  expect(browserLink('#section', base)).toBeNull()
  expect(browserLink(base + '#section', base)).toBeNull()
  expect(browserLink('https://example.org/#section', base)).toBe('https://example.org/#section')
})

test('compile-time HMR выключен для stable/canary и portable даже при заданной переменной', () => {
  const config = (channel, portable = false) => loadReactModule(new URL('../../electrobun.config.ts', import.meta.url), {
    './package.json': { version: '1.0.0', description: 'fixture' },
    './electrobun/main/app-identity': { appIdentifier: 'app', portableAppIdentifier: 'portable' },
    './electrobun/main/update-public-keys': { updateBaseUrls: { stable: 'https://example.org/stable', canary: 'https://example.org/canary' } },
  }, { process: { platform: 'win32', arch: 'x64', env: { XNEON_DEV_HMR: '1', XNEON_ARTIFACT_CHANNEL: channel, XNEON_BUILD_PORTABLE: portable ? '1' : '' } } }).default
  expect(config('dev').build.bun.define.XNEON_DEV_HMR).toBe('true')
  for (const channel of ['stable', 'canary']) expect(config(channel).build.bun.define.XNEON_DEV_HMR).toBe('false')
  expect(config('dev', true).build.bun.define.XNEON_DEV_HMR).toBe('false')
})

test('HMR выбирает только фиксированный loopback URL и только в dev', async () => {
  const { launcherEntryUrl } = await import('../../electrobun/platform/dev-renderer.ts')
  expect(launcherEntryUrl('dev', true)).toBe('http://127.0.0.1:5173/')
  for (const channel of ['stable', 'canary', '', 'other']) {
    expect(launcherEntryUrl(channel, true)).toBe('views://launcher/index.html')
  }
  expect(launcherEntryUrl('dev', false)).toBe('views://launcher/index.html')
})

test('dev запускает Vite до окна, закрывает сервер после выхода и передаёт режим HMR сборке', async () => {
  const { runDevHmr } = await import('../../scripts/dev-hmr.mjs')
  const calls = []
  const code = await runDevHmr({
    env: {},
    run: async (program, args, env) => { calls.push([args, env.XNEON_DEV_HMR, env.XNEON_ARTIFACT_CHANNEL]); return 0 },
    createServer: async options => {
      expect(options.server.host).toBe('127.0.0.1')
      expect(options.server.strictPort).toBe(true)
      return { listen: async () => calls.push('listen'), close: async () => calls.push('close'), printUrls() {} }
    },
  })
  expect(code).toBe(0)
  expect(calls).toEqual([
    [['run', 'build:dev'], '1', 'dev'], 'listen',
    [['electrobun', 'run', '--env=dev'], '1', 'dev'], 'close',
  ])
})

test('ошибка подготовки не запускает сервер или окно', async () => {
  const { runDevHmr } = await import('../../scripts/dev-hmr.mjs')
  expect(await runDevHmr({ env: {}, run: async () => 7, createServer: async () => { throw new Error('Unexpected server') } })).toBe(7)
})

test('занятый порт не открывает окно и закрывает Vite', async () => {
  const { runDevHmr } = await import('../../scripts/dev-hmr.mjs')
  let commands = 0, closed = 0
  await expect(runDevHmr({ env: {}, run: async () => { commands++; return 0 }, createServer: async () => ({
    listen: async () => { throw new Error('Port occupied') }, close: async () => { closed++ },
  }) })).rejects.toThrow('Port occupied')
  expect(commands).toBe(1)
  expect(closed).toBe(1)
})

test('ошибка запуска окна не оставляет dev-сервер', async () => {
  const { runDevHmr } = await import('../../scripts/dev-hmr.mjs')
  let commands = 0, closed = 0
  await expect(runDevHmr({ env: {}, run: async () => { if (++commands === 2) throw new Error('Missing Hutch'); return 0 }, createServer: async () => ({
    listen: async () => {}, close: async () => { closed++ }, printUrls() {},
  }) })).rejects.toThrow('Missing Hutch')
  expect(closed).toBe(1)
})

test('обычный dev включает HMR; bundled-режим и production-сборка остаются отдельными', () => {
  const { scripts } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(scripts.dev).toBe('bun run dev:hmr')
  expect(scripts['dev:hmr']).toBe('bun scripts/dev-hmr.mjs')
  expect(scripts['dev:bundled']).toBe('bun run build:dev && bun scripts/electrobun.mjs run --env=dev')
  expect(scripts.build).not.toMatch(/hmr|vite serve/)
})
