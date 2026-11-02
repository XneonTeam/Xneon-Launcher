import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createShareServer } from '../server.mjs'
import { serverPermissions } from '../../../packages/xnlc-share/lib/index.js'

test('удалённый сервер: код, права, делегирование без повышения, отзыв и одноразовые билеты', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-remote-api-'))
  const tokens = { alice: 'a'.repeat(43), bob: 'b'.repeat(43), carol: 'c'.repeat(43) }
  const service = await createShareServer({ directory, bootstrap: Object.entries(tokens).map(([user, token]) => ({ user, token })) })
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + service.server.address().port
  const call = (user, route, body, method = body === undefined ? 'GET' : 'POST') => fetch(base + '/v1/remote-servers' + route, { method, headers: { Authorization: 'Bearer ' + tokens[user], 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const created = await call('alice', '', { info: { name: 'Friends', gameVersion: '1.21.1', modloader: 'paper', javaPath: 'private-path', id: 'local-id' } })
  assert.equal(created.status, 201)
  const access = await created.json(), id = '/' + access.id
  assert.equal(access.info.javaPath, undefined)
  assert.equal(access.info.id, undefined)
  assert.equal((await call('bob', id)).status, 403)
  const requested = { ...serverPermissions(), start: true, readFiles: true }
  const { code } = await (await call('alice', id + '/invites', { permissions: requested })).json()
  assert.match(code, /^XNS-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/)
  const joined = await call('bob', '/join', { code: code.toLowerCase().replaceAll('-', ' ') })
  assert.equal(joined.status, 200)
  assert.deepEqual((await joined.json()).permissions, requested)
  assert.equal((await call('carol', '/join', { code })).status, 400)
  assert.equal((await call('bob', id + '/invites', { permissions: requested })).status, 403)
  assert.equal((await call('bob', id, undefined, 'DELETE')).status, 403)
  const ticket = await (await call('bob', id + '/ticket', {})).json()
  const redeemed = await call('bob', '/tickets/' + ticket.ticket, {})
  assert.equal(redeemed.status, 200)
  assert.equal((await redeemed.json()).user, 'bob')
  assert.equal((await call('bob', '/tickets/' + ticket.ticket, {})).status, 401)
  assert.equal((await call('alice', id + '/members/alice', { permissions: requested }, 'PATCH')).status, 403)
  await call('alice', id + '/members/bob', { permissions: { ...requested, invite: true } }, 'PATCH')
  assert.equal((await call('bob', id + '/invites', { permissions: { ...requested, stop: true } })).status, 403)
  const delegated = await (await call('bob', id + '/invites', { permissions: requested })).json()
  const stale = await (await call('bob', id + '/ticket', {})).json()
  await call('alice', id + '/members/bob', undefined, 'DELETE')
  assert.equal((await call('bob', '/tickets/' + stale.ticket, {})).status, 403)
  assert.equal((await call('carol', '/join', { code: delegated.code })).status, 403)
  assert.equal((await call('bob', '')).status, 200)
  assert.deepEqual(await (await call('bob', '')).json(), [])
  await call('alice', id, undefined, 'DELETE')
  assert.equal((await call('alice', id)).status, 400)
})
