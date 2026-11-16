import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'

const directory = path.resolve(process.argv[2] || '.share-data')
const target = path.resolve(process.argv[3] || '.tmp/share-initial-data.mjs')
const db = new Database(path.join(directory, 'share.db'), { readonly: true })
// Порядок вставки сохраняет внешние ключи; старые bearer-сессии не переносятся.
const tables = ['users', 'user_profiles', 'repositories', 'manifests', 'manifest_entries', 'snapshots', 'commits', 'branches', 'objects', 'repository_members', 'object_references', 'uploads', 'invitations', 'pull_requests', 'pull_request_comments', 'tags', 'releases', 'events', 'deleted_publications']
const data = db.transaction(() => tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]))()
db.close()
const files = []
for (const row of data.find(([table]) => table === 'objects')[1]) {
  const bytes = await fs.readFile(path.join(directory, 'objects', row.hash))
  if (bytes.length !== row.size || createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new Error('Local object integrity check failed')
  files.push({ hash: row.hash, bytes: bytes.toString('base64') })
}
await fs.mkdir(path.dirname(target), { recursive: true })
await fs.writeFile(target, 'export default ' + JSON.stringify({ tables: data, files }) + '\n')
console.log(JSON.stringify({ repositories: data.find(([table]) => table === 'repositories')[1].length, objects: files.length }))
