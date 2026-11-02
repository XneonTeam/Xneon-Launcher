import { DurableObject } from 'cloudflare:workers'
import { assertRemoteServerOperation } from '../../../packages/xnlc-share/lib/index.js'

/** Один объект на сервер. Файлы и процессы живут на компьютере владельца, здесь только канал связи. */
export class RemoteServerRelay extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.snapshot = null }
  peers() { return this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN) }
  owner() { return this.peers().find(ws => { const identity = ws.deserializeAttachment(); return identity?.owner && Date.now() - identity.lastSeen < 60000 }) }
  send(ws, value) { try { ws.send(JSON.stringify(value)) } catch {} }
  watchers() { const owner = this.owner(); if (owner) this.send(owner, { type: 'watchers', count: this.peers().filter(ws => !ws.deserializeAttachment()?.owner).length }) }
  async fetch(request) {
    if (new URL(request.url).pathname === '/invalidate') {
      for (const ws of this.peers()) ws.close(4001, 'Remote server access changed')
      this.snapshot = null
      return new Response('ok')
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket required', { status: 426 })
    const identity = JSON.parse(request.headers.get('X-Remote-Identity'))
    if (identity.isOwner) { for (const old of this.peers()) if (old.deserializeAttachment()?.owner) old.close(4002, 'Owner connected from another session'); this.snapshot = null }
    else if (this.peers().length >= 50) return new Response('Remote participant limit reached', { status: 429 })
    const pair = new WebSocketPair(), [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ connectionId: crypto.randomUUID(), user: identity.user, owner: identity.isOwner, permissions: identity.permissions, minute: 0, count: 0, lastSeen: Date.now() })
    this.send(server, { type: 'ready', online: !!this.owner() })
    if (!identity.isOwner && this.snapshot && this.owner()) this.send(server, this.snapshot)
    if (identity.isOwner) for (const ws of this.peers()) if (ws !== server) this.send(ws, { type: 'presence', online: true })
    this.watchers()
    return new Response(null, { status: 101, webSocket: client })
  }
  async webSocketMessage(ws, message) {
    let packet, identity = ws.deserializeAttachment()
    try {
      if (typeof message !== 'string' || new TextEncoder().encode(message).length > 3 * 1024 * 1024) throw new Error('Remote message exceeds limit')
      packet = JSON.parse(message)
      if (identity.owner) {
        const returning = Date.now() - identity.lastSeen >= 60000
        identity.lastSeen = Date.now(); ws.serializeAttachment(identity)
        if (returning) { for (const client of this.peers()) if (client !== ws) this.send(client, { type: 'presence', online: true }); this.watchers() }
      }
      if (packet.type === 'ping') { this.send(ws, { type: 'pong', online: !!this.owner() }); return }
      if (identity.owner) {
        if (packet.type === 'snapshot') {
          // Не держим консоль и файлы в постоянном облачном хранилище.
          if (JSON.stringify(packet).length > 120000) throw new Error('Snapshot exceeds limit')
          this.snapshot = packet
          for (const client of this.peers()) if (client !== ws) this.send(client, packet)
        } else if (packet.type === 'result') {
          const client = this.peers().find(peer => peer.deserializeAttachment()?.connectionId === packet.clientId)
          if (client) this.send(client, { type: 'result', id: packet.id, result: packet.result, error: packet.error })
        }
        return
      }
      const minute = Math.floor(Date.now() / 60000)
      identity.count = identity.minute === minute ? identity.count + 1 : 1; identity.minute = minute
      ws.serializeAttachment(identity)
      if (identity.count > 240) throw new Error('Remote command rate limit exceeded')
      if (packet.type !== 'command' || typeof packet.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(packet.id) || typeof packet.channel !== 'string') throw new Error('Invalid remote command')
      if (identity.recent?.includes(packet.id)) throw new Error('Duplicate remote command')
      identity.recent = [...(identity.recent ?? []).slice(-63), packet.id]
      ws.serializeAttachment(identity)
      assertRemoteServerOperation(identity.permissions, packet.channel, packet.args)
      const owner = this.owner()
      if (!owner) { this.send(ws, { type: 'result', id: packet.id, error: { code: 'OFFLINE', message: 'Server owner is offline' } }); return }
      this.send(owner, { ...packet, clientId: identity.connectionId, actor: identity.user })
    } catch (error) { this.send(ws, { type: 'result', id: packet?.id, error: { code: error.code ?? 'INPUT', message: error.message } }) }
  }
  webSocketClose(ws, code, reason) {
    const safeCode = code < 1000 || code >= 5000 || [1004, 1005, 1006, 1015].includes(code) ? 1000 : code
    try { ws.close(safeCode, reason) } catch {}
    if (ws.deserializeAttachment()?.owner && !this.owner()) {
      this.snapshot = null
      for (const client of this.peers()) this.send(client, { type: 'presence', online: false })
    }
    this.watchers()
  }
  webSocketError(ws) { this.webSocketClose(ws, 1011, 'Connection error') }
}
