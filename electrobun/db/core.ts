import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { randomUUID } from "node:crypto"
import Database from "../platform/sqlite"
import type { Statement, SQLQueryBindings, Changes } from "bun:sqlite"
import { getLauncherDataRoot } from "../main/paths"
import { ensureDir } from "../main/utils/fs"

/**
 * SQLite-слой лаунчера. Раньше здесь был sql.js (WASM): вся БД держалась в памяти
 * и целиком перезаписывалась на диск через `export()` + `rename` при каждом
 * изменении. Теперь используется bun:sqlite — настоящий файл БД,
 * prepared statements, транзакции и WAL.
 *
 * Доступ к соединению есть только у main-процесса; renderer общается через IPC.
 */

/** Тип соединения bun:sqlite (в renderer не попадает никогда). */
export type SqliteDatabase = Database

function getDataDir(): string {
  return getLauncherDataRoot()
}

export const dbPath = path.join(getDataDir(), "data.db")
/** Файл, в который sql.js-версия писала «синхронный» слепок при выходе. */
export const legacyTmpDbPath = path.join(getDataDir(), "data.db.tmp")

const SQLITE_MAGIC = "SQLite format 3\u0000"

let dbInitialized = false
let initialization: Promise<void> | null = null
let database: SqliteDatabase | null = null

const statementCache = new Map<string, Statement<unknown, SQLQueryBindings[]>>()
/** Потолок кэша: SQL с динамическими `IN (?,?,…)` даёт разное число плейсхолдеров. */
const STATEMENT_CACHE_LIMIT = 200

export const inMemoryAccounts = new Map<string, unknown>()
export const inMemoryBuilds = new Map<string, unknown>()
export const inMemorySettings = new Map<string, string>()

export function isDbAvailable(): boolean {
  return database !== null
}

export function isDbFallbackMode(): boolean {
  return false
}

const warnedFallbackOperations = new Set<string>()

/**
 * Сообщает о попытке работы с хранилищем при недоступной БД.
 *
 * `accounts`/`builds`/`settings` в fallback-режиме держат данные в памяти, а
 * `ai`, `mc-servers`, `skins`, `cloud` просто ничего не делали — пользователь
 * молча терял историю чатов, серверы и скины. Логируем один раз на операцию,
 * чтобы не заливать консоль при каждом вызове.
 */
export function warnDbUnavailable(operation: string): void {
  if (warnedFallbackOperations.has(operation)) return
  warnedFallbackOperations.add(operation)
  console.error(`[DB] Хранилище недоступно (fallback-режим): операция «${operation}» пропущена — данные не сохраняются`)
}

export function getDatabase(): SqliteDatabase {
  if (!database) {
    throw new Error("Database is not initialized")
  }
  return database
}

function describeParams(params: unknown[]): string {
  // Значения могут содержать пароли, токены и личные данные аккаунтов.
  return params.map((p, i) => `${i + 1}: ${p === null ? "null" : typeof p}`).join(", ")
}

/**
 * better-sqlite3 принимает только number | string | bigint | Buffer | null —
 * `undefined` и `boolean` приводят к TypeError. Приводим их заранее и логируем,
 * чтобы коэрс не прятал ошибки в вызывающем коде.
 */
function normalizeParams(sql: string, params: unknown[]): SQLQueryBindings[] {
  for (let i = 0; i < params.length; i++) {
    const value = params[i]
    if (value === undefined) {
      console.error(`[DB] param ${i + 1} is undefined for: ${sql} — coerced to null`)
      params[i] = null
    } else if (typeof value === "boolean") {
      console.error(`[DB] param ${i + 1} is boolean for: ${sql} — coerced to ${value ? 1 : 0}`)
      params[i] = value ? 1 : 0
    } else if (typeof value === "bigint") {
      params[i] = Number(value)
    }
  }
  return params as SQLQueryBindings[]
}

/** Переиспользуем подготовленные выражения — они компилируются один раз. */
function prepareCached(sql: string): Statement<unknown, SQLQueryBindings[]> {
  const cached = statementCache.get(sql)
  if (cached) {
    return cached
  }

  const statement = getDatabase().prepare(sql)
  if (statementCache.size >= STATEMENT_CACHE_LIMIT) {
    // Схема/набор запросов изменились — старые выражения безопасно выбросить.
    statementCache.clear()
  }
  statementCache.set(sql, statement)
  return statement
}

function clearStatementCache(): void {
  statementCache.clear()
}

export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  try {
    const statement = prepareCached(sql)
    return statement.all(...normalizeParams(sql, [...params])) as T[]
  } catch (error) {
    console.error(`[DB] queryAll SQL error running: ${sql}`)
    console.error(`[DB] queryAll Params (${params.length}):`, describeParams(params))
    throw error
  }
}

export function run(sql: string, params: unknown[] = []): Changes {
  try {
    return prepareCached(sql).run(...normalizeParams(sql, [...params]))
  } catch (error) {
    console.error(`[DB] SQL error running: ${sql}`)
    console.error(`[DB] Params (${params.length}):`, describeParams(params))
    throw error
  }
}

/** Prepared statement, пригодный для повторного выполнения в цикле. */
export function prepare(sql: string): Statement<unknown, SQLQueryBindings[]> {
  return prepareCached(sql)
}

/**
 * Обёртка над `db.transaction()`: группа записей применяется атомарно
 * (BEGIN/COMMIT, при ошибке — ROLLBACK).
 */
export function transaction<T>(fn: () => T): T {
  if (!database) {
    throw new Error("Database is not initialized")
  }
  // better-sqlite3 использует SAVEPOINT для независимого вложенного отката.
  return database.transaction(fn)()
}

/** Выполнить набор записей одной транзакцией (immediate — меньше шансов на lock). */
export function transactionImmediate<T>(fn: () => T): T {
  if (!database) {
    throw new Error("Database is not initialized")
  }
  return database.transaction(fn).immediate()
}

function assertIntegrity(db: SqliteDatabase): void {
  const rows = db.query<{ quick_check: string }, []>("PRAGMA quick_check").all()
  if (rows.length !== 1 || rows[0].quick_check !== "ok") {
    throw new Error("SQLite integrity check failed")
  }
}

function verifyBackup(filename: string): void {
  const backup = new Database(filename, { readonly: true, fileMustExist: true })
  try {
    assertIntegrity(backup)
  } finally {
    backup.close()
  }
}

function backupDatabase(db: SqliteDatabase, version: number, schemaVersion: number): void {
  const backupBase = `${dbPath}.electrobun-v${version}-to-v${schemaVersion}`
  let backupPath = `${backupBase}.bak`
  if (fsSync.existsSync(backupPath)) {
    if (version === schemaVersion) {
      verifyBackup(backupPath)
      return
    }
    backupPath = `${backupBase}.${randomUUID()}.bak`
  }

  const temporary = `${backupPath}.${randomUUID()}.tmp`
  try {
    // SQLite читает согласованный снимок, включая подтверждённые записи из WAL.
    db.query("VACUUM INTO ?").run(temporary)
    verifyBackup(temporary)
    fsSync.renameSync(temporary, backupPath)
  } finally {
    fsSync.rmSync(temporary, { force: true })
  }
}

function applyPragmas(db: SqliteDatabase): void {
  // WAL: параллельные читатели не блокируются писателем, запись идёт в файл БД
  // построчно, а не полным слепком.
  //
  // `synchronous = NORMAL` вместо FULL — осознанный компромисс: в режиме WAL
  // fsync выполняется при чекпойнте, а не на каждом коммите. FULL превращал
  // каждый `run()` (а их на скане контента десятки тысяч — по одному на файл)
  // в отдельный fsync: запись одного мода стоила дороже его чтения. NORMAL
  // по-прежнему гарантирует целостность файла БД при падении процесса (данные
  // уже в WAL); теоретически теряются только последние транзакции при
  // отключении питания — для лаунчера это приемлемо.
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  db.pragma("cache_size = -16000")
  db.pragma("mmap_size = 268435456")
  db.pragma("journal_size_limit = 67108864")
}

export function initDatabaseCore(schemaVersion: number): Promise<void> {
  if (initialization) return initialization
  if (dbInitialized) return Promise.resolve()
  initialization = openDatabaseCore(schemaVersion).finally(() => { initialization = null })
  return initialization
}

async function openDatabaseCore(schemaVersion: number): Promise<void> {
  let db: SqliteDatabase | undefined
  try {
    const stat = await fs.stat(dbPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (stat) {
      const file = await fs.open(dbPath, "r")
      try {
        const header = Buffer.alloc(16)
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        if (bytesRead !== header.length || header.toString("latin1") !== SQLITE_MAGIC) {
          throw new Error("Invalid SQLite database header")
        }
      } finally {
        await file.close()
      }
      const probe = new Database(dbPath, { readonly: true, fileMustExist: true })
      try {
        probe.pragma("busy_timeout = 5000")
        assertIntegrity(probe)
        const version = Number(probe.pragma("user_version", { simple: true }))
        if (version > schemaVersion) throw new Error(`Unsupported database schema version: ${version}`)
        backupDatabase(probe, version, schemaVersion)
      } finally {
        probe.close()
      }
    } else {
      const entries = await fs.readdir(path.dirname(dbPath)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return []
        throw error
      })
      if (entries.some(name => /^data\.db[-.]/i.test(name))) {
        throw new Error("Database is missing but recovery files exist")
      }
      await fs.mkdir(path.dirname(dbPath), { recursive: true })
    }

    db = new Database(dbPath, { fileMustExist: Boolean(stat) })
    applyPragmas(db)
    database = db
    dbInitialized = true
  } catch (cause) {
    try { db?.close() } catch {}
    throw new Error(`Unable to open launcher database at ${dbPath}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

/** Пометить файл БД как созданный/мигрированный этой версией (маркер `user_version`). */
export function setUserVersion(version: number): void {
  if (!database) return
  database.pragma(`user_version = ${Math.max(0, Math.floor(version))}`)
}

/** Полный чекпойнт WAL в основной файл — вызывается при выходе приложения. */
export function flushDatabase(): void {
  if (!database) return
  try {
    database.pragma("wal_checkpoint(TRUNCATE)")
  } catch (error) {
    console.error("[DB] wal checkpoint failed:", error)
  }
}

/** Синхронный вариант для хуков `exit` / `will-quit`. */
export function flushDatabaseSync(): void {
  flushDatabase()
}

export function closeDatabase(): void {
  dbInitialized = false
  if (!database) return
  try {
    flushDatabase()
    clearStatementCache()
    database.close()
  } catch (error) {
    console.error("[DB] close failed:", error)
  } finally {
    database = null
  }
}

export function closeDatabaseForUpdate(): void {
  if (initialization || !database) throw new Error("Database is not ready for update.")
  const result = database.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>
  if (result[0]?.busy !== 0) throw new Error("Database WAL checkpoint is busy.")
  clearStatementCache()
  database.close()
  database = null
  dbInitialized = false
}

export function getLauncherDirectory(): Promise<string> {
  return ensureDir(getDataDir())
}
