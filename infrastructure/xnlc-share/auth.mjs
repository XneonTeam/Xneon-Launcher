import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto'
const digest = value => createHash('sha256').update(value).digest('hex')

export function createAuth(db, clock) {
  db.exec('CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id), name TEXT NOT NULL)')
  const attempts = new Map(), challenges = new Map()
  return async function authenticate(req, body, send) {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (!['/v1/auth/challenge', '/v1/auth/launcher'].includes(pathname) || req.method !== 'POST') return false
    const minute = Math.floor(clock() / 60000), ip = req.socket.remoteAddress
    const previous = attempts.get(ip), count = previous?.minute === minute ? previous.count + 1 : 1
    attempts.set(ip, { minute, count })
    for (const [key, value] of attempts) if (value.minute !== minute) attempts.delete(key)
    for (const [key, value] of challenges) if (value.expiresAt < clock()) challenges.delete(key)
    if (count > 60 || challenges.size >= 2000) { send({ error: { code: 'RATE_LIMIT', message: 'Too many authentication attempts' } }, 429); return true }
    const data = JSON.parse((await body(req, 4096)).toString('utf8'))
    let publicKey
    try {
      if (typeof data.publicKey !== 'string' || data.publicKey.length > 200) throw Error()
      publicKey = createPublicKey({ key: Buffer.from(data.publicKey, 'base64'), type: 'spki', format: 'der' })
      if (publicKey.asymmetricKeyType !== 'ed25519') throw Error()
    } catch { send({ error: { code: 'AUTH_KEY', message: 'Invalid launcher key' } }, 400); return true }
    const key = publicKey.export({ type: 'spki', format: 'der' }), user = 'launcher-' + digest(key).slice(0, 32)
    if (pathname.endsWith('/challenge')) {
      const id = randomBytes(24).toString('base64url'), nonce = randomBytes(32).toString('base64url')
      challenges.set(id, { user, nonce, expiresAt: clock() + 60000 })
      send({ id, nonce }); return true
    }
    const challenge = challenges.get(data.challengeId)
    challenges.delete(data.challengeId)
    let valid = false
    try { valid = !!challenge && challenge.user === user && challenge.expiresAt > clock() && typeof data.signature === 'string' && data.signature.length < 150 && verify(null, Buffer.from(`XNLC/Share\n${data.challengeId}\n${challenge.nonce}`), publicKey, Buffer.from(data.signature, 'base64')) } catch {}
    if (!valid) { send({ error: { code: 'UNAUTHORIZED', message: 'Launcher proof is invalid or expired' } }, 401); return true }
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) { send({ error: { code: 'AUTH_INPUT', message: 'Invalid account name' } }, 400); return true }
    const legacyToken = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')?.[1]
    const legacy = legacyToken && db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(legacyToken), clock())
    const mayMigrate = legacy && !legacy.user_id.startsWith('launcher-') && db.prepare("SELECT 1 FROM sqlite_master WHERE name='auth_credentials'").get() && db.prepare('SELECT 1 FROM auth_credentials WHERE user_id=?').get(legacy.user_id)
    const token = randomBytes(32).toString('base64url'), expiresAt = clock() + 30 * 86400000
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO users VALUES (?)').run(user)
      db.prepare('INSERT OR REPLACE INTO user_profiles VALUES (?,?)').run(user, name)
      if (mayMigrate) {
        for (const row of db.prepare('SELECT id,metadata FROM repositories WHERE owner=?').all(legacy.user_id)) {
          const metadata = JSON.parse(row.metadata); metadata.owner = user
          for (const stash of Object.values(metadata.stashes ?? {})) if (stash.author === legacy.user_id) stash.author = user
          db.prepare('UPDATE repositories SET owner=?,metadata=? WHERE id=?').run(user, JSON.stringify(metadata), row.id)
        }
        db.prepare('UPDATE OR IGNORE repository_members SET user_id=? WHERE user_id=?').run(user, legacy.user_id)
        db.prepare('DELETE FROM repository_members WHERE user_id=?').run(legacy.user_id)
        db.prepare('UPDATE branches SET owner=? WHERE owner=?').run(user, legacy.user_id)
        db.prepare('UPDATE invitations SET recipient=? WHERE recipient=?').run(user, legacy.user_id)
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(legacy.user_id)
      }
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), user, expiresAt)
    }).immediate()
    send({ user: { id: user, name }, token, expiresAt, ...(mayMigrate ? { migratedFrom: legacy.user_id } : {}) })
    return true
  }
}
