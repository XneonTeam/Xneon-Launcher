import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createShareServer } from '../server.mjs'
import { ShareApiClient, ShareSystem } from '../../../packages/xnlc-share/lib/index.js'
import { MemoryFiles, metadata, hash } from '../../../packages/xnlc-share/tests/helpers.mjs'

test('Автоматическая сессия: подпись лаунчера, защита от replay, приглашение только по ссылке', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-auth-'))
  const service = await createShareServer({ directory })
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + service.server.address().port
  const call = (route, body, token) => fetch(base + '/v1' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const key = generateKeyPairSync('ed25519')
  const publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const challenge = await (await call('/auth/challenge', { publicKey })).json()
  const proof = { publicKey, challengeId: challenge.id, signature: sign(null, Buffer.from(`XNLC/Share\n${challenge.id}\n${challenge.nonce}`), key.privateKey).toString('base64'), name: 'Alice' }
  const alice = await (await call('/auth/launcher', proof)).json()
  assert.ok(alice.token); assert.equal(alice.user.name, 'Alice')
  assert.equal((await call('/auth/launcher', proof)).status, 401)
  assert.equal((await call('/auth/me', undefined, alice.token)).status, 200)
  assert.equal(service.db.prepare("SELECT 1 FROM sqlite_master WHERE name='auth_credentials'").get(), undefined)
  assert.equal((await call('/auth/register', { username: 'x', password: 'not-needed-password' })).status, 401)
  const again = await (await call('/auth/challenge', { publicKey })).json()
  const otherKey = generateKeyPairSync('ed25519')
  assert.equal((await call('/auth/launcher', { ...proof, challengeId: again.id, signature: sign(null, Buffer.from(`XNLC/Share\n${again.id}\n${again.nonce}`), otherKey.privateKey).toString('base64') })).status, 401)
  const resumed = await (await call('/auth/challenge', { publicKey })).json()
  const relogin = await (await call('/auth/launcher', { ...proof, challengeId: resumed.id, signature: sign(null, Buffer.from(`XNLC/Share\n${resumed.id}\n${resumed.nonce}`), key.privateKey).toString('base64') })).json()
  assert.equal(relogin.user.id, alice.user.id)
  const remote = new ShareApiClient(base, async () => alice.token, fetch)
  const s = new ShareSystem({ files: new MemoryFiles({ 'config/a.json': '{}' }), hash, remote, sources: [], now: () => new Date().toISOString() })
  const published = await s.publish((await s.scan(metadata)).manifest, alice.user.id)
  const bobKey = generateKeyPairSync('ed25519'), bobPublic = bobKey.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const bChallenge = await (await call('/auth/challenge', { publicKey: bobPublic })).json()
  const bob = await (await call('/auth/launcher', { publicKey: bobPublic, challengeId: bChallenge.id, signature: sign(null, Buffer.from(`XNLC/Share\n${bChallenge.id}\n${bChallenge.nonce}`), bobKey.privateKey).toString('base64'), name: 'Bob' })).json()
  assert.equal((await call(`/repositories/${published.repository.id}/invites`, { role: 'viewer', maxUses: 1, recipient: 'Bob' }, alice.token)).status, 400)
  const invite = await (await call(`/repositories/${published.repository.id}/invites`, { role: 'viewer', maxUses: 1 }, alice.token)).json()
  assert.equal((await call('/invitations', undefined, bob.token)).status, 404)
  assert.equal((await call(`/invites/${invite.token}`, undefined, bob.token)).status, 200)
  assert.equal((await call(`/repositories/${published.repository.id}`, undefined, bob.token)).status, 403)
  assert.equal((await call(`/invites/${invite.token}/accept`, {}, bob.token)).status, 200)
  const members = await (await call(`/repositories/${published.repository.id}/members`, undefined, alice.token)).json()
  assert.equal(members[alice.user.id], 'Alice'); assert.equal(members[bob.user.id], 'Bob')
})

test('Переход со старого входа сохраняет репозиторий и доступ при наличии старой сессии', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xnlc-auth-migration-')), token = 'a'.repeat(43)
  const service = await createShareServer({ directory, bootstrap: [{ user: 'old-user', token }] })
  service.db.exec('CREATE TABLE auth_credentials (user_id TEXT PRIMARY KEY, salt TEXT, password_hash TEXT)')
  service.db.prepare('INSERT INTO auth_credentials VALUES (?,?,?)').run('old-user', 'old', 'unused')
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + service.server.address().port
  const remote = new ShareApiClient(base, async () => token, fetch), s = new ShareSystem({ files: new MemoryFiles(), hash, remote, sources: [], now: () => new Date().toISOString() })
  const published = await s.publish((await s.scan(metadata)).manifest, 'old-user')
  const pair = generateKeyPairSync('ed25519'), publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const post = (endpoint, body) => fetch(base + '/v1/auth/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) })
  const challenge = await (await post('challenge', { publicKey })).json()
  const result = await (await post('launcher', { publicKey, name: 'Player', challengeId: challenge.id, signature: sign(null, Buffer.from(`XNLC/Share\n${challenge.id}\n${challenge.nonce}`), pair.privateKey).toString('base64') })).json()
  assert.equal(result.migratedFrom, 'old-user')
  const next = new ShareApiClient(base, async () => result.token, fetch), repo = await next.get(published.repository.id)
  assert.equal(repo.owner, result.user.id); assert.equal(repo.branches.main.owner, result.user.id)
  assert.equal(repo.members[result.user.id], 'owner')
  assert.ok(repo.commits[published.commit.id])
})
