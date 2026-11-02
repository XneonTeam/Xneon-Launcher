import http from 'node:http'
import fs from 'node:fs/promises'
import { readFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createShareService } from './service.mjs'

export async function createShareServer({ directory, ...options } = {}) {
  const objectDir = path.join(directory, 'objects')
  await fs.mkdir(objectDir, { recursive: true })
  const db = new Database(path.join(directory, 'share.db'))
  db.pragma('journal_mode = WAL')
  const objectStore = {
    read: hash => fs.readFile(path.join(objectDir, hash)),
    write: (hash, bytes) => fs.writeFile(path.join(objectDir, hash), bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error }),
    removeSync: hash => unlinkSync(path.join(objectDir, hash)),
  }
  const service = createShareService({ ...options, db, objectStore, schema: readFileSync(new URL('./migrations/001.sql', import.meta.url), 'utf8') })
  const server = http.createServer(service.handle)
  server.requestTimeout = 120000; server.headersTimeout = 15000
  return { ...service, server, close: async () => { await new Promise(resolve => server.close(resolve)); db.close() } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bootstrap = process.env.SHARE_BOOTSTRAP ? JSON.parse(process.env.SHARE_BOOTSTRAP) : []
  const service = await createShareServer({ directory: path.resolve(process.env.SHARE_DATA_DIR || '.share-data'), bootstrap })
  service.server.listen(Number(process.env.SHARE_PORT || 8787), process.env.SHARE_HOST || '127.0.0.1', () => console.log('XNLC/Share listening'))
}
