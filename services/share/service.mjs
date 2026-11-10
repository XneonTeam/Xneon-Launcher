import { createHash, randomBytes, randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { createAuth } from './auth.mjs'
import { createRemoteServers } from './remote-servers.mjs'
import { inspectExternalObject } from '../../packages/xnlc-share/lib/index.js'
import { branchHistory, mergeBase } from '../../packages/xnlc-share/lib/index.js'
import { emptyRepository, mutateRepository, createCommit, validateManifest, validateExternal, stable, MAX_FILE_BYTES, ShareError } from '../../packages/xnlc-share/lib/index.js'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const hash = { digest: async bytes => digest(bytes) }
const token = () => randomBytes(32).toString('base64url')
const invitationCode = () => 'XNLC-' + [...randomBytes(20)].map(byte => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte & 31]).join('').match(/.{4}/g).join('-')
const error = (code, message) => { throw new ShareError(code, message) }
const parse = s => JSON.parse(s)
const encode = value => JSON.stringify(value)

export function createShareService({ db, objectStore, schema, bootstrap = [], clock = Date.now, quota = 512 * 1024 * 1024 }) {
  db.pragma('foreign_keys = ON')
  db.exec(schema)
  if (!db.pragma('table_info(branches)').some(column => column.name === 'base_commit')) db.exec('ALTER TABLE branches ADD COLUMN base_commit TEXT')
  db.transaction(() => {
    db.prepare("UPDATE repository_members SET role='editor' WHERE role IN ('contributor','maintainer')").run()
    db.prepare("UPDATE invitations SET role='editor' WHERE role IN ('contributor','maintainer')").run()
  })()
  const authenticate = createAuth(db, clock)
  const remoteServers = createRemoteServers(db, clock)
  for (const item of bootstrap) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(item.user) || !item.token || item.token.length < 32) error('CONFIG', 'Bootstrap requires a valid user and a token of at least 32 characters')
    db.prepare('INSERT OR IGNORE INTO users VALUES (?)').run(item.user)
    db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run(digest(item.token), item.user, clock() + 30 * 86400000)
  }
  function load(id) {
    const row = db.prepare('SELECT * FROM repositories WHERE id=?').get(id)
    if (!row) error('NOT_FOUND', 'Repository not found')
    const r = parse(row.metadata)
    r.commits = Object.fromEntries(db.prepare('SELECT id,data FROM commits WHERE repository_id=?').all(id).map(c => [c.id, parse(c.data)]))
    r.branches = Object.fromEntries(db.prepare('SELECT * FROM branches WHERE repository_id=?').all(id).map(b => [b.name, { head: b.head, owner: b.owner, protected: !!b.protected, ...(b.base_commit ? { base: b.base_commit } : {}) }]))
    for (const [name, branch] of Object.entries(r.branches)) if (name !== r.defaultBranch && !branch.base && r.branches[r.defaultBranch]) {
      branch.base = mergeBase(r, branch.head, r.branches[r.defaultBranch].head)
      db.prepare('UPDATE branches SET base_commit=? WHERE repository_id=? AND name=? AND base_commit IS NULL').run(branch.base, id, name)
    }
    r.members = Object.fromEntries(db.prepare('SELECT * FROM repository_members WHERE repository_id=?').all(id).map(m => [m.user_id, m.role]))
    return r
  }
  function permission(id, user, write = false, owner = false) {
    const repository = db.prepare('SELECT owner,state FROM repositories WHERE id=?').get(id)
    if (!repository && db.prepare('SELECT 1 FROM deleted_publications WHERE repository_id=?').get(id)) error('PUBLICATION_DELETED', 'Publication was deleted by its creator')
    if (!repository || repository.state === 'staging' && repository.owner !== user) error('FORBIDDEN', 'Repository access denied')
    const member = db.prepare('SELECT role FROM repository_members WHERE repository_id=? AND user_id=?').get(id, user)
    if (!member || write && member.role === 'viewer' || owner && member.role !== 'owner') error('FORBIDDEN', 'Repository access denied')
    return member.role
  }
  function save(r) {
    const { commits, branches, members, ...metadata } = r
    db.prepare('UPDATE repositories SET metadata=? WHERE id=?').run(encode(metadata), r.id)
    db.prepare('DELETE FROM repository_members WHERE repository_id=?').run(r.id)
    for (const [user, role] of Object.entries(members)) db.prepare('INSERT INTO repository_members VALUES (?,?,?)').run(r.id, user, role)
    for (const c of Object.values(commits)) {
      const m = c.snapshot.manifest
      db.prepare('INSERT OR IGNORE INTO manifests VALUES (?,?)').run(c.manifestHash, encode(m))
      db.prepare('INSERT OR IGNORE INTO snapshots VALUES (?,?,?)').run(c.snapshot.id, c.manifestHash, encode(c.snapshot))
      db.prepare('INSERT OR IGNORE INTO commits VALUES (?,?,?,?,?,?)').run(c.id, r.id, c.snapshot.id, c.author, c.createdAt, encode(c))
      for (const e of m.entries) db.prepare('INSERT OR IGNORE INTO manifest_entries VALUES (?,?,?,?,?,?)').run(c.manifestHash, e.path, e.sha256, e.source ? encode(e.source) : null, e.object ?? null, e.size)
    }
    db.prepare('DELETE FROM branches WHERE repository_id=?').run(r.id)
    for (const [name, b] of Object.entries(branches)) db.prepare('INSERT INTO branches (repository_id,name,head,owner,protected,base_commit) VALUES (?,?,?,?,?,?)').run(r.id, name, b.head, b.owner, +b.protected, b.base ?? null)
    db.prepare('DELETE FROM object_references WHERE repository_id=?').run(r.id)
    for (const c of Object.values(commits)) refs(r.id, c.id, c.snapshot.manifest)
    for (const [id, s] of Object.entries(r.stashes)) refs(r.id, 'stash:' + id, s.manifest)
    for (const pr of Object.values(r.pullRequests)) {
      db.prepare('INSERT OR REPLACE INTO pull_requests VALUES (?,?,?)').run(r.id, pr.id, encode(pr))
      pr.comments.forEach((c, i) => db.prepare('INSERT OR REPLACE INTO pull_request_comments VALUES (?,?,?,?)').run(r.id, pr.id, i, encode(c)))
    }
    for (const [tag, release] of Object.entries(r.releases)) {
      db.prepare('INSERT OR IGNORE INTO tags VALUES (?,?,?)').run(r.id, tag, release.commit)
      db.prepare('INSERT OR IGNORE INTO releases VALUES (?,?,?)').run(r.id, tag, encode(release))
    }
  }
  function refs(repo, owner, manifest) {
    for (const e of manifest.entries) if (e.object) {
      const object = db.prepare('SELECT * FROM objects WHERE hash=?').get(e.object)
      const authorized = db.prepare('SELECT 1 FROM object_references WHERE repository_id=? AND object_hash=? UNION SELECT 1 FROM uploads WHERE repository_id=? AND object_hash=? AND used=1').get(repo, e.object, repo, e.object)
      if (!object || object.size !== e.size || !authorized) error('OBJECT_MISSING', 'Required external object is missing or not authorized')
      db.prepare('INSERT OR IGNORE INTO object_references VALUES (?,?,?)').run(repo, owner, e.object)
    }
  }
  const buckets = new Map()
  function limit(user) {
    const minute = Math.floor(clock() / 60000), b = buckets.get(user)
    if (b?.minute === minute && b.count >= 1200) error('RATE_LIMIT', 'Too many requests')
    buckets.set(user, { minute, count: b?.minute === minute ? b.count + 1 : 1 })
    if (buckets.size > 10000) for (const [key, value] of buckets) if (value.minute !== minute) buckets.delete(key)
  }
  async function body(request, max) {
    const chunks = []; let size = 0
    for await (const chunk of request) { size += chunk.length; if (size > max) error('SIZE', 'Request body exceeds limit'); chunks.push(chunk) }
    return Buffer.concat(chunks)
  }
  function validateObject(bytes) {
    inspectExternalObject(bytes, data => new AdmZip(Buffer.from(data)).getEntries().map(entry => ({ name: entry.entryName, size: entry.header.size, directory: entry.isDirectory, read: () => entry.getData() })))
  }
  async function validateCommand(command, id, user) {
    if (!command || typeof command !== 'object' || typeof command.action !== 'string') error('COMMAND', 'Invalid command')
    if (command.action === 'push' || command.action === 'branch' && command.initial) {
      const c = command.action === 'push' ? command.commit : command.initial
      const manifest = validateManifest(c?.snapshot?.manifest)
      const repo = load(id)
      if (!Array.isArray(c.parents) || c.parents.length > 2 || c.parents.some(p => !repo.commits[p])) error('PARENTS', 'Invalid commit parents')
      const rebuilt = await createCommit({ repositoryId: id, author: user, manifest, message: c.message, description: c.description, parents: c.parents.map(p => repo.commits[p]), now: c.createdAt, type: c.type }, hash)
      if (stable(rebuilt) !== stable(c) || !Number.isFinite(Date.parse(c.createdAt)) || !['INITIAL','COMMIT','MERGE','REVERT'].includes(c.type)) error('INTEGRITY', 'Commit hash or snapshot is invalid')
    }
    if (command.action === 'stash') validateManifest(command.manifest)
    const manifest = command.action === 'push' ? command.commit.snapshot.manifest : command.action === 'branch' && command.initial ? command.initial.snapshot.manifest : command.action === 'stash' ? command.manifest : null
    if (manifest) for (const e of manifest.entries) if (e.object) {
      const bytes = await objectStore.read(e.object).catch(() => error('OBJECT_MISSING', 'Required external object is missing'))
      validateExternal(e.path, bytes)
      if (bytes.length !== e.size || digest(bytes) !== e.sha256) error('INTEGRITY', 'External object is corrupt')
    }
  }
  const handle = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(encode(value)) }
    try {
      const ticket = /^\/v1\/remote-servers\/tickets\/([A-Za-z0-9_-]+)$/.exec(new URL(req.url, 'http://localhost').pathname)
      if (ticket && req.method === 'POST') return send(remoteServers.consumeTicket(ticket[1]))
      if (await authenticate(req, body, send)) return
      const auth = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')
      const session = auth && db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(auth[1]), clock())
      if (!session) error('UNAUTHORIZED', 'Valid session required')
      const user = session.user_id; limit(user)
      if (await remoteServers.handle(req, user, body, send)) return
      const url = new URL(req.url, 'http://localhost'), parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (url.pathname === '/v1/auth/me' && req.method === 'GET') return send({ id: user, name: db.prepare('SELECT name FROM user_profiles WHERE user_id=?').get(user)?.name ?? user })
      if (url.pathname === '/v1/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(auth[1])); return send({ signedOut: true })
      }
      if (parts[0] === 'v1' && parts[1] === 'invites' && parts[2] && parts.length === 3 && req.method === 'GET') {
        const inv = db.prepare('SELECT * FROM invitations WHERE token_hash=?').get(digest(parts[2]))
        if (!inv || inv.revoked || inv.expires_at <= clock() || inv.uses >= inv.max_uses || inv.recipient && inv.recipient !== user) error('INVITE', 'Invitation is invalid or expired')
        const repo = load(inv.repository_id), head = repo.branches[repo.defaultBranch]?.head
        if (!head) error('NOT_READY', 'Instance has not been published')
        return send({ repositoryId: repo.id, branch: repo.defaultBranch, head, owner: db.prepare('SELECT name FROM user_profiles WHERE user_id=?').get(repo.owner)?.name ?? repo.owner, manifest: repo.commits[head].snapshot.manifest })
      }
      if (url.pathname === '/v1/repositories' && req.method === 'POST') {
        const count = db.prepare('SELECT COUNT(*) AS n FROM repositories WHERE owner=?').get(user).n
        if (count >= 100) error('QUOTA', 'Repository limit reached')
        const id = randomUUID(), r = emptyRepository(id, user)
        db.transaction(() => { db.prepare('INSERT INTO repositories VALUES (?,?,?,?,?)').run(id, user, 'staging', encode(r), clock()); save(r) }).immediate()
        return send({ id }, 201)
      }
      if (parts[0] === 'v1' && parts[1] === 'invites' && parts[2] && ['accept', 'decline'].includes(parts[3]) && req.method === 'POST') {
        const result = db.transaction(() => {
          const inv = db.prepare('SELECT * FROM invitations WHERE token_hash=?').get(digest(parts[2]))
          if (!inv || inv.revoked || inv.expires_at <= clock() || inv.uses >= inv.max_uses || inv.recipient && inv.recipient !== user) error('INVITE', 'Invitation is invalid or expired')
          if (parts[3] === 'decline') { if (inv.recipient === user) db.prepare('UPDATE invitations SET revoked=1 WHERE token_hash=?').run(inv.token_hash); return { declined: true } }
          db.prepare("INSERT INTO repository_members VALUES (?,?,?) ON CONFLICT(repository_id,user_id) DO UPDATE SET role=excluded.role WHERE repository_members.role<>'owner'").run(inv.repository_id, user, inv.role)
          db.prepare('UPDATE invitations SET uses=uses+1 WHERE token_hash=?').run(inv.token_hash)
          return { repositoryId: inv.repository_id }
        }).immediate(); return send(result)
      }
      if (parts[0] !== 'v1' || parts[1] !== 'repositories' || !parts[2]) error('NOT_FOUND', 'Route not found')
      const id = parts[2], role = permission(id, user)
      if (parts.length === 3 && req.method === 'DELETE') {
        permission(id, user, true, true)
        db.transaction(() => {
          for (const table of ['pull_request_comments', 'pull_requests', 'releases', 'tags', 'branches', 'object_references', 'uploads', 'invitations', 'events', 'repository_members', 'commits']) {
            db.prepare(`DELETE FROM ${table} WHERE repository_id=?`).run(id)
          }
          db.prepare('DELETE FROM repositories WHERE id=?').run(id)
          db.prepare('INSERT INTO deleted_publications VALUES (?,?)').run(id, clock())
        }).immediate()
        return send({ deleted: true })
      }
      if (parts.length === 3 && req.method === 'GET') return send(load(id))
      if (parts[3] === 'members' && req.method === 'GET') return send(Object.fromEntries(db.prepare('SELECT m.user_id,COALESCE(p.name,m.user_id) AS name FROM repository_members m LEFT JOIN user_profiles p ON p.user_id=m.user_id WHERE m.repository_id=?').all(id).map(row => [row.user_id, row.name])))
      if (parts[3] === 'commits' && req.method === 'GET') {
        const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get('offset')) || 0))
        const repo = load(id), branch = url.searchParams.get('branch') ?? repo.defaultBranch
        if (!Object.hasOwn(repo.branches, branch)) error('BRANCH', 'Branch not found')
        return send(branchHistory(repo, branch).slice(offset, offset + 50))
      }
      if (parts[3] === 'commands' && req.method === 'POST') {
        permission(id, user, true)
        const c = parse((await body(req, 8 * 1024 * 1024)).toString('utf8'))
        await validateCommand(c, id, user)
        const result = db.transaction(() => {
          const current = load(id)
          if (c.action === 'push' && current.commits[c.commit.id] && current.branches[c.branch]?.head === c.commit.id) return current
          const r = mutateRepository(current, user, c, new Date(clock()).toISOString())
          save(r)
          if (Object.keys(r.commits).length) db.prepare("UPDATE repositories SET state='published' WHERE id=?").run(id)
          db.prepare('INSERT INTO events(repository_id,actor,action,at) VALUES (?,?,?,?)').run(id, user, c.action, clock())
          return r
        }).immediate(); return send(result)
      }
      if (parts[3] === 'invites' && req.method === 'POST') {
        permission(id, user, true, true)
        if (!Object.keys(load(id).commits).length) error('NOT_READY', 'Publish the initial state before inviting members')
        const data = parse((await body(req, 4096)).toString('utf8'))
        if (data.revoke) { db.prepare('UPDATE invitations SET revoked=1 WHERE token_hash=? AND repository_id=?').run(digest(data.revoke), id); return send({ revoked: true }) }
        if (!['viewer','editor'].includes(data.role) || !Number.isSafeInteger(data.maxUses) || data.maxUses < 1 || data.maxUses > 100) error('INVITE', 'Invalid invitation settings')
        const expiresInDays = data.expiresInDays === undefined ? 7 : data.expiresInDays
        if (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) error('INVITE', 'Invitation duration must be between 1 and 365 days')
        if (data.recipient !== undefined) error('INVITE', 'Only invitation links are supported')
        let invite
        do { invite = invitationCode() } while (db.prepare('SELECT 1 FROM invitations WHERE token_hash=?').get(digest(invite)))
        const expires = clock() + expiresInDays * 86400000
        db.prepare('INSERT INTO invitations VALUES (?,?,?,?,?,0,?,0)').run(digest(invite), id, data.role, null, expires, data.maxUses)
        return send({ token: invite, expiresAt: expires, expiresInDays, maxUses: data.maxUses })
      }
      if (parts[3] === 'objects' && /^[a-f0-9]{64}$/.test(parts[4] ?? '')) {
        const object = parts[4]
        const canRead = () => db.prepare('SELECT 1 FROM object_references WHERE repository_id=? AND object_hash=? UNION SELECT 1 FROM uploads WHERE repository_id=? AND object_hash=? AND user_id=? AND used=1').get(id, object, id, object, user)
        if (parts[5] === 'exists' && req.method === 'GET') return send({ exists: !!canRead() && !!db.prepare('SELECT 1 FROM objects WHERE hash=?').get(object) })
        if (parts[5] === 'ticket' && req.method === 'POST') {
          permission(id, user, true)
          const data = parse((await body(req, 1024)).toString('utf8'))
          if (!Number.isSafeInteger(data.size) || data.size < 0 || data.size > MAX_FILE_BYTES) error('SIZE', 'Invalid object size')
          const used = db.prepare('SELECT COALESCE(SUM(size),0) AS size FROM uploads WHERE repository_id=? AND (used=1 OR expires_at>?)').get(id, clock()).size
          if (used + data.size > quota) error('QUOTA', 'Repository storage quota exceeded')
          const ticket = token(); db.prepare('INSERT INTO uploads VALUES (?,?,?,?,?,?,0)').run(digest(ticket), id, user, object, data.size, clock() + 300000)
          return send({ ticket, expiresIn: 300 })
        }
        if (req.method === 'PUT' && parts.length === 5) {
          permission(id, user, true)
          const t = db.prepare('SELECT * FROM uploads WHERE ticket_hash=? AND repository_id=? AND user_id=? AND object_hash=? AND expires_at>? AND used=0').get(digest(url.searchParams.get('ticket') ?? ''), id, user, object, clock())
          if (!t) error('UPLOAD', 'Upload ticket expired or already used')
          const bytes = await body(req, MAX_FILE_BYTES)
          if (bytes.length !== t.size || digest(bytes) !== object) error('INTEGRITY', 'Object checksum/size mismatch')
          validateObject(bytes)
          await objectStore.write(object, bytes)
          db.transaction(() => {
            const changed = db.prepare('UPDATE uploads SET used=1 WHERE ticket_hash=? AND used=0 AND expires_at>?').run(t.ticket_hash, clock()).changes
            if (!changed) error('UPLOAD', 'Upload ticket consumed')
            db.prepare('INSERT OR IGNORE INTO objects VALUES (?,?,?)').run(object, bytes.length, clock())
          }).immediate()
          return send({ hash: object, size: bytes.length })
        }
        if (req.method === 'GET' && parts.length === 5) {
          if (!canRead()) error('FORBIDDEN', 'Object access denied')
          const bytes = await objectStore.read(object)
          if (digest(bytes) !== object) error('INTEGRITY', 'Stored object is corrupt')
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }); res.end(bytes); return
        }
      }
      error('NOT_FOUND', 'Route not found')
    } catch (e) {
      const statuses = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, PUBLICATION_DELETED: 410, NON_FAST_FORWARD: 409, QUOTA: 413, SIZE: 413, RATE_LIMIT: 429 }
      const code = e instanceof ShareError ? e.code : e instanceof SyntaxError ? 'JSON' : 'INTERNAL'
      send({ error: { code, message: code === 'INTERNAL' ? 'Internal server error' : e.message } }, statuses[code] ?? (code === 'INTERNAL' ? 500 : 400))
    }
  }
  async function gc() {
    remoteServers.gc()
    // История и файлы очищаются отдельно от пользовательского запроса.
    db.transaction(() => {
      db.prepare('DELETE FROM snapshots WHERE NOT EXISTS (SELECT 1 FROM commits WHERE snapshot_id=snapshots.id)').run()
      db.prepare('DELETE FROM manifest_entries WHERE NOT EXISTS (SELECT 1 FROM snapshots WHERE manifest_hash=manifest_entries.manifest_hash)').run()
      db.prepare('DELETE FROM manifests WHERE NOT EXISTS (SELECT 1 FROM snapshots WHERE manifest_hash=manifests.hash)').run()
    }).immediate()
    // Льготный срок защищает незавершённые публикации; объекты с любыми ссылками сохраняются.
    const candidates = db.prepare('SELECT hash FROM objects WHERE created_at<? AND NOT EXISTS (SELECT 1 FROM object_references r WHERE r.object_hash=objects.hash) AND NOT EXISTS (SELECT 1 FROM uploads u WHERE u.object_hash=objects.hash AND u.expires_at>?)').all(clock() - 7 * 86400000, clock())
    let removed = 0
    for (const { hash } of candidates) db.transaction(() => {
      if (db.prepare('SELECT 1 FROM object_references WHERE object_hash=? UNION SELECT 1 FROM uploads WHERE object_hash=? AND expires_at>?').get(hash, hash, clock())) return
      try { objectStore.removeSync(hash) } catch (e) { if (e.code !== 'ENOENT') throw e }
      db.prepare('DELETE FROM objects WHERE hash=?').run(hash); removed++
    }).immediate()
    db.prepare('DELETE FROM uploads WHERE expires_at<? AND used=0').run(clock())
    return removed
  }
  return { handle, db, gc }
}
