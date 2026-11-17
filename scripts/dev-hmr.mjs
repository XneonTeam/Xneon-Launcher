import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { DEV_RENDERER_HOST, DEV_RENDERER_PORT } from '../electrobun/platform/dev-renderer.ts'

const root = fileURLToPath(new URL('../', import.meta.url))

/** Сигнал терминала останавливает только дерево процессов этого dev-запуска. */
export function runCommand(program, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32' })
    let interrupted = false
    const stop = () => {
      if (interrupted || !child.pid) return
      interrupted = true
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
    }
    const cleanup = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('error', error => { cleanup(); reject(error) })
    child.once('exit', code => { cleanup(); resolve(interrupted ? 130 : code ?? 1) })
  })
}

export async function runDevHmr({ run = runCommand, createServer: serverFactory = createServer, env = process.env } = {}) {
  const devEnv = { ...env, XNEON_DEV_HMR: '1', XNEON_ARTIFACT_CHANNEL: 'dev' }
  // Одна подготовка main/workspaces/workers; Vite следит только за интерфейсом.
  const prepared = await run(process.execPath, ['run', 'build:dev'], devEnv)
  if (prepared !== 0) return prepared
  const server = await serverFactory({ root, server: { host: DEV_RENDERER_HOST, port: DEV_RENDERER_PORT, strictPort: true } })
  try {
    await server.listen()
    server.printUrls()
    console.log('[dev] Vite HMR включён. После изменений main/preload/config перезапустите dev.')
    return await run(env.XNEON_HUTCH_EXECUTABLE || 'hutch', ['electrobun', 'run', '--env=dev'], devEnv)
  } finally {
    await server.close()
  }
}

if (import.meta.main) {
  try { process.exitCode = await runDevHmr() }
  catch (error) { console.error('[dev] Не удалось запустить HMR:', error); process.exitCode = 1 }
}
