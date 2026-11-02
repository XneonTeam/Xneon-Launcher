import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { serverPermissions, assertRemoteServerOperation } from '../../../packages/xnlc-share/lib/index.js'

test('ретранслятор: права, адресная доставка, состояние, офлайн и отзыв живых соединений', async () => {
  const sockets = []
  class Socket {
    readyState = 1; messages = []
    send(value) { this.messages.push(JSON.parse(value)) }
    close(code) { if ([1005, 1006, 1015].includes(code)) throw new Error('Invalid WebSocket close code'); this.readyState = 3 }
    serializeAttachment(value) { this.attachment = structuredClone(value) }
    deserializeAttachment() { return structuredClone(this.attachment) }
  }
  const ctx = { getWebSockets: () => sockets, acceptWebSocket: socket => sockets.push(socket) }
  class DurableObject { constructor(context) { this.ctx = context } }
  const source = (await fs.readFile(new URL('../worker/remote-relay.mjs', import.meta.url), 'utf8')).replace(/^import .*\r?\n/gm, '').replace('export class RemoteServerRelay', 'class RemoteServerRelay') + '\n globalThis.Relay = RemoteServerRelay'
  const sandbox = { DurableObject, assertRemoteServerOperation, crypto: { randomUUID }, TextEncoder, URL, structuredClone, WebSocket: { OPEN: 1 }, WebSocketPair: class { constructor() { this[0] = new Socket(); this[1] = new Socket() } }, Response: class { constructor(body, init) { this.status = init?.status ?? 200; this.webSocket = init?.webSocket } } }
  vm.runInNewContext(source, sandbox)
  let relay = new sandbox.Relay(ctx)
  const connect = async (owner, permissions, user) => {
    await relay.fetch(new Request('https://remote.internal/connect', { headers: { Upgrade: 'websocket', 'X-Remote-Identity': JSON.stringify({ isOwner: owner, permissions, user }) } }))
    return sockets.at(-1)
  }
  const reader = await connect(false, serverPermissions(), 'reader')
  await relay.webSocketMessage(reader, JSON.stringify({ type: 'command', id: 'offline', channel: 'mc-server:logs', args: [] }))
  assert.equal(reader.messages.at(-1).error.code, 'OFFLINE')
  const owner = await connect(true, serverPermissions(true), 'owner')
  assert.equal(reader.messages.at(-1).online, true)
  await relay.webSocketMessage(reader, JSON.stringify({ type: 'command', id: 'denied', channel: 'mc-server:start', args: [] }))
  assert.equal(reader.messages.at(-1).error.code, 'FORBIDDEN')
  const editor = await connect(false, { ...serverPermissions(), start: true }, 'editor')
  await relay.webSocketMessage(editor, JSON.stringify({ type: 'command', id: 'start', channel: 'mc-server:start', args: [] }))
  const forwarded = owner.messages.at(-1)
  assert.equal(forwarded.actor, 'editor'); assert.equal(forwarded.type, 'command')
  await relay.webSocketMessage(owner, JSON.stringify({ type: 'result', id: 'start', clientId: forwarded.clientId, result: 'started' }))
  assert.equal(editor.messages.at(-1).result, 'started')
  assert.equal(reader.messages.some(message => message.result === 'started'), false)
  await relay.webSocketMessage(editor, JSON.stringify({ type: 'command', id: 'start', channel: 'mc-server:start', args: [] }))
  assert.match(editor.messages.at(-1).error.message, /Duplicate/)
  relay = new sandbox.Relay(ctx)
  await relay.webSocketMessage(reader, JSON.stringify({ type: 'command', id: 'hibernated', channel: 'mc-server:status', args: [] }))
  assert.equal(owner.messages.at(-1).id, 'hibernated')
  const stale = owner.deserializeAttachment(); stale.lastSeen = Date.now() - 61000; owner.serializeAttachment(stale)
  await relay.webSocketMessage(editor, JSON.stringify({ type: 'ping' }))
  assert.equal(editor.messages.at(-1).online, false)
  await relay.webSocketMessage(owner, JSON.stringify({ type: 'ping' }))
  assert.ok(editor.messages.some(message => message.type === 'presence' && message.online))
  owner.close(); relay.webSocketClose(owner, 1005, '')
  assert.equal(editor.messages.at(-1).online, false)
  await relay.fetch(new Request('https://remote.internal/invalidate', { method: 'POST' }))
  assert.ok(sockets.every(socket => socket.readyState === 3))
})
