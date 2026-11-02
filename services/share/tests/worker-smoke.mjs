import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { ShareApiClient, ShareSystem, MAX_FILE_BYTES, branchHistory } from '../../../packages/xnlc-share/lib/index.js'
import { MemoryFiles, hash, metadata, text, manifest } from '../../../packages/xnlc-share/tests/helpers.mjs'

export async function workerSmoke(base) {
  const call = (route, token, body, method = body === undefined ? 'GET' : 'POST') => fetch(base + '/v1' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  async function login(name) {
    const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const response = await call('/auth/challenge', null, { publicKey })
    assert.equal(response.status, 200, await response.clone().text())
    const challenge = await response.json()
    const proof = { publicKey, challengeId: challenge.id, signature: sign(null, Buffer.from(`XNLC/Share\n${challenge.id}\n${challenge.nonce}`), keys.privateKey).toString('base64'), name }
    const result = await call('/auth/launcher', null, proof)
    assert.equal(result.status, 200, await result.clone().text())
    assert.equal((await call('/auth/launcher', null, proof)).status, 401)
    return result.json()
  }
  const owner = await login('Share deployment check'), reader = await login('Share deployment reader')
  const remote = new ShareApiClient(base, async () => owner.token, fetch)
  const remoteReader = new ShareApiClient(base, async () => reader.token, fetch)
  const files = new MemoryFiles({ 'config/test.json5': '{ enabled: true, }', 'config/test.jexl': 'true', 'config/large.txt': 'x'.repeat(1024 * 1024) })
  files.data.set('servers.dat', Uint8Array.of(10, 0, 0, 0))
  files.data.set('saves/Verification/level.dat', gzipSync(Uint8Array.of(10, 0, 0, 0)))
  files.data.set('saves/Verification/region/r.0.0.mca', new Uint8Array(8192))
  files.data.set('options.txt', text('renderDistance:12'))
  const launchSettings = { javaOverride: true, memoryMin: '1G', memoryMax: '6G', javaArgs: '-XX:+UseG1GC', java: { path: 'C:/Java/bin/java.exe', major: 21 }, windowOverride: true, windowWidth: 1600, windowHeight: 900, account: { type: 'microsoft', username: 'ShareTest' }, serverOverride: true, server: 'play.example.org', serverPort: '25565', group: 'Verification', preLaunchCommand: 'echo before', postLaunchCommand: 'echo after', wrapperCommand: '', customEnv: 'PACK_MODE=fast' }
  const meta = { ...metadata, name: 'Deployment verification', icon: 'data:image/png;base64,' + Buffer.alloc(140000, 1).toString('base64'), coverImage: '', launchSettings }
  const transferEvents = []
  const make = (disk, client) => new ShareSystem({ files: disk, remote: client, hash, sources: [], now: () => new Date().toISOString(), progress: event => transferEvents.push(event) })
  const system = make(files, remote)
  let id
  try {
    id = await remote.create()
    const first = await system.publish((await system.scan(meta)).manifest, owner.user.id, 'Deployment verification', id)
    assert.ok(transferEvents.some(event => event.stage === 'upload' && event.done > 0 && event.done < 1))
    assert.equal((await call(`/repositories/${id}`, reader.token)).status, 403)
    const oversized = await call(`/repositories/${id}/objects/${'a'.repeat(64)}/ticket`, owner.token, { size: MAX_FILE_BYTES + 1 })
    assert.equal(oversized.status, 413)
    const invitation = await (await call(`/repositories/${id}/invites`, owner.token, { role: 'viewer', maxUses: 1 })).json()
    assert.match(invitation.token, /^XNLC-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/)
    const invitePreview = await (await call(`/invites/${invitation.token}`, reader.token)).json()
    assert.equal(invitePreview.manifest.instance.icon, meta.icon)
    assert.deepEqual(invitePreview.manifest.instance.launchSettings, launchSettings)
    assert.equal((await call(`/invites/${invitation.token}/accept`, reader.token, {})).status, 200)
    const installed = new MemoryFiles(), installer = make(installed, remoteReader)
    await installer.apply(id, await installer.preview(id, 'main', null, manifest()))
    assert.deepEqual(await installed.read('config/large.txt'), await files.read('config/large.txt'))
    for (const file of ['servers.dat', 'saves/Verification/level.dat', 'saves/Verification/region/r.0.0.mca', 'options.txt']) assert.deepEqual(Uint8Array.from(await installed.read(file)), Uint8Array.from(await files.read(file)))
    await assert.rejects(remoteReader.mutate(id, { action: 'branch', name: 'denied', from: first.commit.id }), { code: 'FORBIDDEN' })
    await system.createBranch(id, 'feature', 'main', owner.user.id)
    files.data.set('config/test.json5', text('{ enabled: false, }'))
    files.data.set('servers.dat', Uint8Array.of(10, 0, 0, 1))
    files.data.set('saves/Verification/level.dat', gzipSync(Uint8Array.of(10, 0, 0, 1)))
    const nextMeta = { ...meta, name: 'Updated deployment verification', description: 'Updated description', launchSettings: { ...launchSettings, memoryMax: '8G', windowWidth: 1920 } }
    const next = await system.push(id, 'feature', first.commit.id, (await system.scan(nextMeta)).manifest, owner.user.id, 'Change config')
    await system.command(id, { action: 'pr', id: 'verification', title: 'Deployment test', description: '', source: 'feature', target: 'main' })
    await system.command(id, { action: 'comment', id: 'verification', text: 'Verified' })
    const merge = await system.mergePreview(id, 'main', 'feature')
    const merged = await system.mergeBranches(id, 'main', 'feature', merge.current, owner.user.id, 'Merge test', {}, 'verification', merge.incoming)
    assert.equal(merged.pullRequests.verification.state, 'merged')
    assert.equal(merged.pullRequests.verification.merge.targetHead, first.commit.id)
    assert.equal(merged.pullRequests.verification.merge.commit, next.commit.id)
    assert.deepEqual((await system.mergePreview(id, 'main', 'feature', {}, 'verification')).diff, merge.diff)
    assert.equal(merged.commits[merged.branches.main.head].snapshot.manifest.instance.launchSettings.memoryMax, '8G')
    assert.equal(merged.commits[merged.branches.main.head].snapshot.manifest.instance.name, nextMeta.name)
    assert.equal(merged.commits[merged.branches.main.head].snapshot.manifest.instance.description, nextMeta.description)
    assert.equal(branchHistory(merged, 'feature').length, 2)
    await installer.apply(id, await installer.preview(id, 'main', first.commit.id, await installer.observe(meta, first.commit.snapshot.manifest)))
    assert.deepEqual(await installed.read('config/test.json5'), text('{ enabled: false, }'))
    for (const file of ['servers.dat', 'saves/Verification/level.dat']) assert.deepEqual(Uint8Array.from(await installed.read(file)), Uint8Array.from(await files.read(file)))
    const independent = await system.createBranch(id, 'independent', 'main', owner.user.id, true)
    assert.equal(branchHistory(independent, 'independent').length, 1)
    assert.equal(independent.branches.main.head, next.commit.id)
    await system.command(id, { action: 'deleteBranch', name: 'feature' })
    assert.deepEqual((await system.mergePreview(id, 'main', 'feature', {}, 'verification')).diff, merge.diff)
    return { auth: true, publication: true, launchSettings: true, largeMetadata: true, r2UploadDownload: true, uploadProgress: true, invitationCode: true, roles: true, update: true, branches: true, pullRequest: true, limit32MiB: true }
  } finally {
    if (id) {
      const deleted = await call(`/repositories/${id}`, owner.token, undefined, 'DELETE')
      assert.equal(deleted.status, 200, await deleted.text())
      assert.equal((await call(`/repositories/${id}`, reader.token)).status, 410)
    }
    await call('/auth/logout', owner.token, {})
    await call('/auth/logout', reader.token, {})
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2]
  if (!base) throw new Error('Usage: node worker-smoke.mjs <base-url>')
  console.log(JSON.stringify(await workerSmoke(base), null, 2))
}
