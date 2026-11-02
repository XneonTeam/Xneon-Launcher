import { DurableObject } from 'cloudflare:workers'
import { createShareService } from '../service.mjs'
import schema from '../migrations/001.sql'
import { DurableSqlite, R2ObjectStore } from './storage.mjs'
import { MAX_FILE_BYTES } from '../../../packages/xnlc-share/lib/index.js'
import initialData from './initial-data.mjs'
import { migrateInitialData } from './migrate.mjs'
export { RemoteServerRelay } from './remote-relay.mjs'

export class ShareService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.queue = Promise.resolve()
    ctx.blockConcurrencyWhile(async () => {
      this.db = new DurableSqlite(ctx.storage)
      this.objects = new R2ObjectStore(env.SHARE_OBJECTS, this.db)
      this.service = createShareService({ db: this.db, objectStore: this.objects, schema })
      if (!await ctx.storage.getAlarm()) await ctx.storage.setAlarm(Date.now() + 86400000)
    })
  }
  serialized(callback) {
    const result = this.queue.then(callback)
    this.queue = result.catch(() => {})
    return result
  }
  fetch(request) {
    return this.serialized(async () => {
      if (!await migrateInitialData(initialData, this.db, this.objects, this.ctx.storage)) return Response.json({ status: 'migrating' }, { status: 503, headers: { 'Retry-After': '2' } })
      if (new URL(request.url).pathname === '/health') return Response.json({ service: 'XNLC/Share', status: 'ok' })
      // Workerd требует закончить чтение входного потока до отправки ответа.
      const chunks = []; let size = 0
      if (request.body) for await (const chunk of request.body) {
        size += chunk.byteLength
        if (size > MAX_FILE_BYTES) return Response.json({ error: { code: 'SIZE', message: 'Request body exceeds limit' } }, { status: 413 })
        chunks.push(Buffer.from(chunk))
      }
      const body = Buffer.concat(chunks)
      const req = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers),
        socket: { remoteAddress: request.headers.get('CF-Connecting-IP') || 'unknown' },
        async *[Symbol.asyncIterator]() {
          yield body
        },
      }
      const headers = new Headers()
      let status = 200, response
      const res = {
        setHeader: (name, value) => headers.set(name, String(value)),
        writeHead: (code, values) => { status = code; for (const [name, value] of Object.entries(values)) headers.set(name, String(value)) },
        end: body => { response = new Response(body, { status, headers }) },
      }
      try { await this.service.handle(req, res) }
      finally { await this.objects.flush(this.db) }
      return response ?? Response.json({ error: { code: 'INTERNAL', message: 'No response' } }, { status: 500 })
    })
  }
  alarm() {
    return this.serialized(async () => {
      try { await this.service.gc(); await this.objects.flush(this.db); this.db.collectJson() }
      finally { await this.ctx.storage.setAlarm(Date.now() + 86400000) }
    })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const connect = /^\/remote-servers\/connect\/([A-Za-z0-9_-]{43})$/.exec(url.pathname)
    if (connect && request.headers.get('Upgrade') === 'websocket') {
      const authorized = await env.SHARE_SERVICE.get(env.SHARE_SERVICE.idFromName('share-v1')).fetch(new Request(`https://share.internal/v1/remote-servers/tickets/${connect[1]}`, { method: 'POST' }))
      if (!authorized.ok) return authorized
      const identity = await authorized.json()
      return env.REMOTE_SERVERS.get(env.REMOTE_SERVERS.idFromName(identity.id)).fetch(new Request('https://remote.internal/connect', { headers: { Upgrade: 'websocket', 'X-Remote-Identity': JSON.stringify(identity) } }))
    }
    if (!url.pathname.startsWith('/v1/') && !(url.pathname === '/health' && request.method === 'GET')) return Response.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, { status: 404 })
    try {
      const response = await env.SHARE_SERVICE.get(env.SHARE_SERVICE.idFromName('share-v1')).fetch(request)
      if (response.ok) {
        const changed = /^\/v1\/remote-servers\/([a-f0-9-]+)(?:\/members\/[^/]+|\/leave)?$/.exec(url.pathname)
        if (changed && ['DELETE', 'PATCH', 'POST'].includes(request.method) && (url.pathname.includes('/members/') || url.pathname.endsWith('/leave') || request.method === 'DELETE')) await env.REMOTE_SERVERS.get(env.REMOTE_SERVERS.idFromName(changed[1])).fetch('https://remote.internal/invalidate', { method: 'POST' })
        if (url.pathname === '/v1/remote-servers/join' && request.method === 'POST') {
          const joined = await response.clone().json()
          await env.REMOTE_SERVERS.get(env.REMOTE_SERVERS.idFromName(joined.id)).fetch('https://remote.internal/invalidate', { method: 'POST' })
        }
      }
      return response
    }
    catch (error) { console.error('Share request failed:', error.message); return Response.json({ error: { code: 'INTERNAL', message: 'Service unavailable' } }, { status: 500 }) }
  },
}
