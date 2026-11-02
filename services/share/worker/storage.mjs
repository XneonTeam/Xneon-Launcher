import { createHash } from 'node:crypto'

const marker = '@xnlc-json:'
const chunkSize = 128 * 1024

/** Синхронный порт SQLite; крупный JSON разбивается на строки меньше лимита Durable Objects. */
export class DurableSqlite {
  constructor(storage) {
    this.storage = storage
    this.sql = storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS share_json_chunks (id TEXT NOT NULL, ordinal INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(id,ordinal))')
  }
  encode(value) {
    if (typeof value !== 'string' || Buffer.byteLength(value) <= chunkSize) return value
    const bytes = Buffer.from(value), id = createHash('sha256').update(bytes).digest('hex')
    for (let offset = 0; offset < bytes.length; offset += chunkSize) this.sql.exec('INSERT OR IGNORE INTO share_json_chunks VALUES (?,?,?)', id, offset / chunkSize, bytes.subarray(offset, offset + chunkSize))
    return marker + id
  }
  decode(row) {
    if (!row) return row
    for (const key of ['data', 'metadata']) if (typeof row[key] === 'string' && row[key].startsWith(marker)) {
      const id = row[key].slice(marker.length)
      const chunks = [...this.sql.exec('SELECT data FROM share_json_chunks WHERE id=? ORDER BY ordinal', id)]
      if (!chunks.length) throw new Error('Stored JSON chunks are missing')
      row[key] = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data))).toString('utf8')
    }
    return row
  }
  exec(sql) { this.sql.exec(sql) }
  pragma(sql) { return /^foreign_keys\s*=/i.test(sql) ? [] : [...this.sql.exec('PRAGMA ' + sql)] }
  prepare(sql) {
    return {
      all: (...values) => [...this.sql.exec(sql, ...values)].map(row => this.decode(row)),
      get: (...values) => this.decode(this.sql.exec(sql, ...values).next().value),
      run: (...values) => {
        [...this.sql.exec(sql, ...values.map(value => this.encode(value)))]
        return this.sql.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid').one()
      },
    }
  }
  transaction(callback) {
    const run = (...args) => this.storage.transactionSync(() => callback(...args))
    run.immediate = run
    return run
  }
  collectJson() {
    this.sql.exec(`DELETE FROM share_json_chunks WHERE '${marker}' || id NOT IN (
      SELECT metadata FROM repositories WHERE metadata LIKE '${marker}%'
      UNION SELECT data FROM commits WHERE data LIKE '${marker}%'
      UNION SELECT data FROM snapshots WHERE data LIKE '${marker}%'
      UNION SELECT data FROM manifests WHERE data LIKE '${marker}%'
      UNION SELECT data FROM pull_requests WHERE data LIKE '${marker}%'
      UNION SELECT data FROM pull_request_comments WHERE data LIKE '${marker}%'
      UNION SELECT data FROM releases WHERE data LIKE '${marker}%'
    )`)
  }
}

export class R2ObjectStore {
  constructor(bucket, db) {
    this.bucket = bucket; this.db = db
    db.exec('CREATE TABLE IF NOT EXISTS share_r2_deletions (hash TEXT PRIMARY KEY)')
  }
  async read(hash) {
    const object = await this.bucket.get(hash)
    if (!object) throw Object.assign(new Error('Object not found'), { code: 'ENOENT' })
    return Buffer.from(await object.arrayBuffer())
  }
  async write(hash, bytes) {
    // Ключ является SHA-256 содержимого: повторная запись тех же байтов безопасна.
    await this.bucket.put(hash, bytes, { httpMetadata: { contentType: 'application/octet-stream' } })
  }
  removeSync(hash) { this.db.prepare('INSERT OR IGNORE INTO share_r2_deletions VALUES (?)').run(hash) }
  async flush(db) {
    for (const { hash } of db.prepare('SELECT hash FROM share_r2_deletions').all()) {
      // Проверка после транзакции не удаляет объект, если транзакция откатилась.
      if (!db.prepare('SELECT 1 FROM objects WHERE hash=?').get(hash)) await this.bucket.delete(hash)
      db.prepare('DELETE FROM share_r2_deletions WHERE hash=?').run(hash)
    }
  }
}
