/** Одноразовый перенос остановленного локального сервера, небольшими пакетами R2. */
export async function migrateInitialData(seed, db, objects, storage) {
  if (!seed || await storage.get('initial-data-imported')) return true
  const index = await storage.get('initial-data-index') ?? 0
  const end = Math.min(index + 24, seed.files.length)
  for (let i = index; i < end; i++) await objects.write(seed.files[i].hash, Buffer.from(seed.files[i].bytes, 'base64'))
  await storage.put('initial-data-index', end)
  if (end < seed.files.length) return false
  db.transaction(() => {
    for (const [table, rows] of seed.tables) for (const row of rows) {
      const columns = Object.keys(row)
      db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.map(column => '"' + column + '"').join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row))
    }
  })()
  await storage.put('initial-data-imported', true)
  return true
}
