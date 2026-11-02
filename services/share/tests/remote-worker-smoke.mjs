import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto'
import { serverPermissions } from '../../../packages/xnlc-share/lib/index.js'
const base = process.argv[2]
if (!base) throw new Error('Usage: remote-worker-smoke.mjs <base-url>')
const call = async (token, route, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(base + '/v1' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error?.message ?? 'Request failed'), { code: data.error?.code, status: response.status })
  return data
}
async function login(name) {
  const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const challenge = await call(null, '/auth/challenge', { publicKey })
  return call(null, '/auth/launcher', { publicKey, challengeId: challenge.id, name, signature: sign(null, Buffer.from(`XNLC/Share\n${challenge.id}\n${challenge.nonce}`), keys.privateKey).toString('base64') })
}
async function socket(token, id) {
  const { ticket } = await call(token, `/remote-servers/${id}/ticket`, {})
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/remote-servers/connect/' + ticket)
  ws.addEventListener('error', event => console.log(JSON.stringify({ socketError: event.error?.message ?? 'WebSocket error' })))
  ws.addEventListener('open', () => console.log(JSON.stringify({ socket: 'open' })))
  const messages = [], waiters = []
  ws.addEventListener('message', event => {
    const packet = JSON.parse(String(event.data)); messages.push(packet)
    for (const waiter of [...waiters]) if (waiter.match(packet)) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(packet) }
  })
  const wait = match => new Promise((resolve, reject) => {
    const existing = messages.find(match)
    if (existing) return resolve(existing)
    const waiter = { match, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('WebSocket response timed out; packet types: ' + messages.map(packet => packet.type).join(','))) }, 15000) }
    waiters.push(waiter)
  })
  const command = (channel, args) => { const requestId = randomUUID(); ws.send(JSON.stringify({ type: 'command', id: requestId, channel, args })); return wait(packet => packet.type === 'result' && packet.id === requestId) }
  await wait(packet => packet.type === 'ready')
  return { ws, wait, command, messages }
}
const owner = await login('Remote server verification owner'), reader = await login('Remote server verification participant')
let id; const sockets = []
try {
  const access = await call(owner.token, '/remote-servers', { info: { name: 'Remote verification fixture', gameVersion: '1.21.1', modloader: 'paper', xmx: 2048, xms: 512, extraJavaArgs: '', port: 25565, autoRestart: false, relayEnabled: false, onlineMode: true, maxPlayers: 20, source: 'local', createdAt: new Date().toISOString() } })
  id = access.id
  const permissions = { ...serverPermissions(), readFiles: true }
  const { code } = await call(owner.token, `/remote-servers/${id}/invites`, { permissions })
  await call(reader.token, '/remote-servers/join', { code })
  let host = await socket(owner.token, id); sockets.push(host.ws)
  let client = await socket(reader.token, id); sockets.push(client.ws)
  const files = new Map([['config/test.json', '{"fixture":true}']]), state = { status: 'stopped' }
  let executed = 0
  const serve = connection => connection.ws.addEventListener('message', event => {
    const packet = JSON.parse(String(event.data))
    if (packet.type !== 'command') return
    executed++
    let result
    if (packet.channel === 'mc-server:fs-read') result = files.get(packet.args[0])
    if (packet.channel === 'mc-server:fs-write') files.set(packet.args[0], packet.args[1])
    if (packet.channel === 'mc-server:start') state.status = 'running'
    connection.ws.send(JSON.stringify({ type: 'result', id: packet.id, clientId: packet.clientId, result }))
  })
  serve(host)
  assert.equal((await client.command('mc-server:start', [])).error.code, 'FORBIDDEN'); assert.equal(executed, 0)
  assert.equal((await client.command('mc-server:fs-read', ['config/test.json'])).result, '{"fixture":true}')
  assert.equal((await client.command('mc-server:fs-write', ['config/test.json', 'changed'])).error.code, 'FORBIDDEN')
  await call(owner.token, `/remote-servers/${id}/members/${reader.user.id}`, { permissions: { ...permissions, start: true, writeFiles: true } }, 'PATCH')
  await new Promise(resolve => setTimeout(resolve, 100))
  host = await socket(owner.token, id); sockets.push(host.ws); serve(host)
  client = await socket(reader.token, id); sockets.push(client.ws)
  assert.equal((await client.command('mc-server:start', [])).error, undefined)
  assert.equal(state.status, 'running')
  assert.equal((await client.command('mc-server:fs-write', ['config/test.json', 'changed'])).error, undefined)
  assert.equal(files.get('config/test.json'), 'changed')
  assert.equal((await client.command('mc-server:fs-write', ['server.properties', 'motd=not-allowed'])).error.code, 'FORBIDDEN')
  host.ws.close()
  await client.wait(packet => packet.type === 'presence' && packet.online === false)
  assert.equal((await client.command('mc-server:fs-read', ['config/test.json'])).error.code, 'OFFLINE')
  const closed = new Promise(resolve => client.ws.addEventListener('close', resolve, { once: true }))
  await call(owner.token, `/remote-servers/${id}/members/${reader.user.id}`, undefined, 'DELETE')
  await closed
  await assert.rejects(call(reader.token, `/remote-servers/${id}/ticket`, {}), { code: 'FORBIDDEN' })
  console.log(JSON.stringify({ realCloudflareWebSocket: true, separateUsers: true, permissions: true, ownerCommands: true, readWrite: true, propertiesProtected: true, offline: true, liveRevocation: true }))
} finally {
  for (const ws of sockets) ws.close()
  if (id) await call(owner.token, `/remote-servers/${id}`, undefined, 'DELETE')
  await call(owner.token, '/auth/logout', {})
  await call(reader.token, '/auth/logout', {})
}
