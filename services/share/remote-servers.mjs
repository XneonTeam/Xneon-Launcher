import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ShareError, serverPermissions, validateServerPermissions } from '../../packages/xnlc-share/lib/index.js'
const hash = value => createHash('sha256').update(value).digest('hex')
const fail = (code, message) => { throw new ShareError(code, message) }
const token = () => randomBytes(32).toString('base64url')

export function createRemoteServers(db, clock) {
  db.exec(`CREATE TABLE IF NOT EXISTS remote_servers (id TEXT PRIMARY KEY, owner TEXT NOT NULL, info TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS remote_server_members (server_id TEXT NOT NULL, user_id TEXT NOT NULL, permissions TEXT NOT NULL, PRIMARY KEY(server_id,user_id));
    CREATE TABLE IF NOT EXISTS remote_server_invites (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, server_id TEXT NOT NULL, created_by TEXT NOT NULL, permissions TEXT NOT NULL, expires_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS remote_server_tickets (token_hash TEXT PRIMARY KEY, server_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`)
  const name = user => db.prepare('SELECT name FROM user_profiles WHERE user_id=?').get(user)?.name ?? user
  const server = id => db.prepare('SELECT * FROM remote_servers WHERE id=?').get(id) ?? fail('REMOTE_DELETED', 'Remote server access was disabled')
  const permissions = (row, user) => {
    if (row.owner === user) return serverPermissions(true)
    const member = db.prepare('SELECT permissions FROM remote_server_members WHERE server_id=? AND user_id=?').get(row.id, user)
    if (!member) fail('FORBIDDEN', 'Remote server membership required')
    return validateServerPermissions(JSON.parse(member.permissions))
  }
  const view = (row, user, details = false) => {
    const allowed = permissions(row, user)
    return { id: row.id, owner: row.owner, ownerName: name(row.owner), isOwner: row.owner === user, permissions: allowed, info: JSON.parse(row.info), ...(details ? {
      members: [{ id: row.owner, name: name(row.owner), owner: true, permissions: serverPermissions(true) }, ...db.prepare('SELECT * FROM remote_server_members WHERE server_id=?').all(row.id).map(member => ({ id: member.user_id, name: name(member.user_id), owner: false, permissions: validateServerPermissions(JSON.parse(member.permissions)) }))],
      invites: allowed.invite ? db.prepare('SELECT id,created_by,permissions,expires_at,uses,max_uses FROM remote_server_invites WHERE server_id=? AND expires_at>? AND uses<max_uses').all(row.id, clock()).filter(invite => row.owner === user || invite.created_by === user).map(invite => ({ id: invite.id, permissions: JSON.parse(invite.permissions), expiresAt: invite.expires_at, uses: invite.uses, maxUses: invite.max_uses })) : [],
    } : {}) }
  }
  const metadata = value => {
    if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || typeof value.gameVersion !== 'string' || value.gameVersion.length > 100 || typeof value.modloader !== 'string' || value.modloader.length > 100) fail('INPUT', 'Invalid remote server metadata')
    const result = {}
    for (const key of ['name', 'gameVersion', 'modloader', 'modloaderVersion', 'port', 'xmx', 'xms', 'extraJavaArgs', 'autoRestart', 'icon', 'relayEnabled', 'onlineMode', 'maxPlayers', 'createdAt', 'source', 'group']) if (value[key] !== undefined) result[key] = value[key]
    if (typeof result.icon !== 'string' || result.icon.length > 32768) delete result.icon
    if (JSON.stringify(result).length > 65536) fail('SIZE', 'Remote metadata exceeds limit')
    return result
  }
  const ownerOnly = (row, user) => { if (row.owner !== user) fail('FORBIDDEN', 'Only the server owner can manage members') }
  const subset = (requested, grantor) => {
    const result = validateServerPermissions(requested)
    if (Object.keys(result).some(key => result[key] && !grantor[key])) fail('FORBIDDEN', 'Invitation cannot grant additional permissions')
    return result
  }
  return {
    gc() {
      db.prepare('DELETE FROM remote_server_tickets WHERE expires_at<=?').run(clock())
      db.prepare('DELETE FROM remote_server_invites WHERE expires_at<=? OR uses>=max_uses').run(clock())
    },
    consumeTicket(value) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(value)) fail('UNAUTHORIZED', 'Invalid remote connection ticket')
      return db.transaction(() => {
        const ticket = db.prepare('SELECT * FROM remote_server_tickets WHERE token_hash=? AND expires_at>?').get(hash(value), clock())
        if (!ticket) fail('UNAUTHORIZED', 'Remote connection ticket expired')
        db.prepare('DELETE FROM remote_server_tickets WHERE token_hash=?').run(hash(value))
        const row = server(ticket.server_id)
        return { ...view(row, ticket.user_id), user: ticket.user_id }
      }).immediate()
    },
    async handle(req, user, body, send) {
      const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (parts[0] !== 'v1' || parts[1] !== 'remote-servers') return false
      const json = async () => JSON.parse((await body(req, 128 * 1024)).toString('utf8'))
      if (parts.length === 2 && req.method === 'GET') {
        send(db.prepare('SELECT DISTINCT s.* FROM remote_servers s LEFT JOIN remote_server_members m ON m.server_id=s.id WHERE s.owner=? OR m.user_id=? ORDER BY s.created_at DESC').all(user, user).map(row => view(row, user))); return true
      }
      if (parts.length === 2 && req.method === 'POST') {
        if (db.prepare('SELECT COUNT(*) AS n FROM remote_servers WHERE owner=?').get(user).n >= 100) fail('QUOTA', 'Remote server limit reached')
        const data = await json(), id = randomUUID()
        db.prepare('INSERT INTO remote_servers VALUES (?,?,?,?)').run(id, user, JSON.stringify(metadata(data.info)), clock())
        send(view(server(id), user, true), 201); return true
      }
      if (parts[2] === 'join' && req.method === 'POST') {
        const { code } = await json()
        const normalized = typeof code === 'string' ? code.trim().toUpperCase().replace(/[\s-]/g, '') : ''
        if (!/^XNS[A-HJ-NP-Z2-9]{20}$/.test(normalized)) fail('INVITE', 'Invalid server invitation code')
        const result = db.transaction(() => {
          const invite = db.prepare('SELECT * FROM remote_server_invites WHERE token_hash=? AND expires_at>? AND uses<max_uses').get(hash(normalized), clock())
          if (!invite) fail('INVITE', 'Server invitation is invalid or expired')
          const row = server(invite.server_id)
          // Отзыв права выдавать коды делает старые приглашения участника недействительными.
          const grantor = permissions(row, invite.created_by)
          if (!grantor.invite) fail('FORBIDDEN', 'Invitation issuer no longer has access')
          const requested = subset(JSON.parse(invite.permissions), grantor)
          if (row.owner !== user) db.prepare('INSERT OR REPLACE INTO remote_server_members VALUES (?,?,?)').run(row.id, user, JSON.stringify(requested))
          db.prepare('UPDATE remote_server_invites SET uses=uses+1 WHERE id=?').run(invite.id)
          return view(row, user, true)
        }).immediate()
        send(result); return true
      }
      const row = server(parts[2]), allowed = permissions(row, user)
      if (parts.length === 3 && req.method === 'GET') { send(view(row, user, true)); return true }
      if (parts.length === 3 && req.method === 'PATCH') {
        ownerOnly(row, user); const data = await json()
        db.prepare('UPDATE remote_servers SET info=? WHERE id=?').run(JSON.stringify(metadata(data.info)), row.id)
        send(view(server(row.id), user)); return true
      }
      if (parts.length === 3 && req.method === 'DELETE') {
        ownerOnly(row, user)
        db.transaction(() => { for (const table of ['remote_server_members', 'remote_server_invites', 'remote_server_tickets']) db.prepare(`DELETE FROM ${table} WHERE server_id=?`).run(row.id); db.prepare('DELETE FROM remote_servers WHERE id=?').run(row.id) }).immediate()
        send({ disabled: true }); return true
      }
      if (parts[3] === 'leave' && req.method === 'POST') {
        if (row.owner === user) fail('FORBIDDEN', 'Owner must disable remote access instead')
        db.prepare('DELETE FROM remote_server_members WHERE server_id=? AND user_id=?').run(row.id, user)
        send({ left: true }); return true
      }
      if (parts[3] === 'ticket' && req.method === 'POST') {
        db.prepare('DELETE FROM remote_server_tickets WHERE expires_at<=?').run(clock())
        const value = token()
        db.prepare('INSERT INTO remote_server_tickets VALUES (?,?,?,?)').run(hash(value), row.id, user, clock() + 60000)
        send({ ticket: value }); return true
      }
      if (parts[3] === 'members' && parts[4]) {
        ownerOnly(row, user)
        if (parts[4] === row.owner) fail('FORBIDDEN', 'Owner permissions cannot change')
        if (req.method === 'DELETE') db.prepare('DELETE FROM remote_server_members WHERE server_id=? AND user_id=?').run(row.id, parts[4])
        else if (req.method === 'PATCH') {
          const data = await json(), next = validateServerPermissions(data.permissions)
          if (!db.prepare('SELECT 1 FROM remote_server_members WHERE server_id=? AND user_id=?').get(row.id, parts[4])) fail('FORBIDDEN', 'Member not found')
          db.prepare('UPDATE remote_server_members SET permissions=? WHERE server_id=? AND user_id=?').run(JSON.stringify(next), row.id, parts[4])
        } else fail('COMMAND', 'Unsupported member operation')
        send(view(row, user, true)); return true
      }
      if (parts[3] === 'invites' && allowed.invite) {
        if (parts[4] && req.method === 'DELETE') {
          const invite = db.prepare('SELECT * FROM remote_server_invites WHERE server_id=? AND id=?').get(row.id, parts[4])
          if (invite && row.owner !== user && invite.created_by !== user) fail('FORBIDDEN', 'Cannot revoke another member invitation')
          db.prepare('DELETE FROM remote_server_invites WHERE server_id=? AND id=?').run(row.id, parts[4]); send(view(row, user, true)); return true
        }
        if (!parts[4] && req.method === 'POST') {
          const data = await json(), next = subset(data.permissions, allowed)
          const code = 'XNS-' + [...randomBytes(20)].map(byte => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte & 31]).join('').match(/.{4}/g).join('-')
          db.prepare('INSERT INTO remote_server_invites (id,token_hash,server_id,created_by,permissions,expires_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), hash(code.replace(/-/g, '')), row.id, user, JSON.stringify(next), clock() + 7 * 86400000)
          send({ code }); return true
        }
      }
      fail('FORBIDDEN', 'Remote server operation is not permitted')
    },
  }
}
