import assert from 'node:assert/strict'
import { ModrinthSource } from '../../../packages/xnlc-share/lib/index.js'
import { hash } from '../../../packages/xnlc-share/tests/helpers.mjs'
const response = await fetch('https://api.modrinth.com/v2/project/AANobbMI/version', { headers: { 'User-Agent': 'XneonLauncher/ShareIntegration (support@xneon.org)' }, signal: AbortSignal.timeout(30000) })
assert.ok(response.ok)
const versions = await response.json(), version = versions[0], file = version.files.find(f => f.primary) ?? version.files[0]
const adapter = new ModrinthSource(fetch)
const reference = { provider: 'modrinth', projectId: version.project_id, versionId: version.id, fileId: file.hashes.sha512 }
const resolved = await adapter.resolve(reference), bytes = await adapter.download(resolved)
const hashes = { sha256: await hash.digest(bytes), sha512: await hash.digest(bytes, 'SHA-512') }
assert.equal(hashes.sha512, file.hashes.sha512)
const identified = await adapter.identify(hashes)
assert.equal(identified.source.versionId, reference.versionId)
console.log(JSON.stringify({ provider: 'modrinth', projectId: reference.projectId, versionId: reference.versionId, downloadedBytes: bytes.length, sha256: hashes.sha256, identified: true, uploadedJarBytes: 0 }))
