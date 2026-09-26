import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import Database from "better-sqlite3"
import { getLauncherDataRoot } from "../main/paths"
import { ensureDir } from "../main/utils/fs"

/**
 * SQLite-слой лаунчера. Раньше здесь был sql.js (WASM): вся БД держалась в памяти
 * и целиком перезаписывалась на диск через `export()` + `rename` при каждом
 * изменении. Теперь используется better-sqlite3 (Node-API) — настоящий файл БД,
 * prepared statements, транзакции и WAL.
 *
 * Доступ к соединению есть только у main-процесса; renderer общается через IPC.
 */

/** Тип соединения better-sqlite3 (в renderer не попадает никогда). */
export type SqliteDatabase = Database.Database

/** Формат файла БД, который пишет эта версия. Хранится в `PRAGMA user_version`. */
export const DB_FORMAT_VERSION = 1

function getDataDir(): string {
  return getLauncherDataRoot()
}

export const dbPath = path.join(getDataDir(), "data.db")
/** Файл, в который sql.js-версия писала «синхронный» слепок при выходе. */
export const legacyTmpDbPath = path.join(getDataDir(), "data.db.tmp")

const SQLITE_MAGIC = "SQLite format 3\u0000"

let dbInitialized = false
let dbAvailable = true
let dbFallbackMode = false
let database: SqliteDatabase | null = null
let lastOpenError: string | null = null

const statementCache = new Map<string, Database.Statement<unknown[], unknown>>()
/** Потолок кэша: SQL с динамическими `IN (?,?,…)` даёт разное число плейсхолдеров. */
const STATEMENT_CACHE_LIMIT = 200

export const inMemoryAccounts = new Map<string, unknown>()
export const inMemoryBuilds = new Map<string, unknown>()
export const inMemorySettings = new Map<string, string>()

export function isDbAvailable(): boolean {
  return dbAvailable
}

export function isDbFallbackMode(): boolean {
  return dbFallbackMode
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

export function getDatabaseLastError(): string | null {
  return lastOpenError
}

export function getDatabase(): SqliteDatabase {
  if (!database) {
    throw new Error("Database is not initialized")
  }
  return database
}

function describeParams(params: unknown[]): string {
  return params.map((p, i) => `${i + 1}: ${typeof p} = ${JSON.stringify(p)}`).join(", ")
}

/**
 * better-sqlite3 принимает только number | string | bigint | Buffer | null —
 * `undefined` и `boolean` приводят к TypeError. Приводим их заранее и логируем,
 * чтобы коэрс не прятал ошибки в вызывающем коде.
 */
function normalizeParams(sql: string, params: unknown[]): unknown[] {
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
  return params
}

/** Переиспользуем подготовленные выражения — они компилируются один раз. */
function prepareCached(sql: string): Database.Statement<unknown[], unknown> {
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
    if (!statement.reader) {
      // PRAGMA/DDL без результирующего набора — нечего возвращать.
      return []
    }
    return statement.all(...normalizeParams(sql, [...params])) as T[]
  } catch (error) {
    console.error(`[DB] queryAll SQL error running: ${sql}`)
    console.error(`[DB] queryAll Params (${params.length}):`, describeParams(params))
    throw error
  }
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  try {
    return prepareCached(sql).run(...normalizeParams(sql, [...params]))
  } catch (error) {
    console.error(`[DB] SQL error running: ${sql}`)
    console.error(`[DB] Params (${params.length}):`, describeParams(params))
    throw error
  }
}

/** Prepared statement, пригодный для повторного выполнения в цикле. */
export function prepare(sql: string): Database.Statement<unknown[], unknown> {
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
  if (database.inTransaction) {
    // Вложенный вызов — просто продолжаем внешнюю транзакцию.
    return fn()
  }
  return database.transaction(fn)()
}

/** Выполнить набор записей одной транзакцией (immediate — меньше шансов на lock). */
export function transactionImmediate<T>(fn: () => T): T {
  if (!database) {
    throw new Error("Database is not initialized")
  }
  if (database.inTransaction) {
    return fn()
  }
  return database.transaction(fn).immediate()
}

function hasSqliteHeader(filePath: string): boolean {
  try {
    const fd = fsSync.openSync(filePath, "r")
    try {
      const header = Buffer.alloc(16)
      const read = fsSync.readSync(fd, header, 0, 16, 0)
      return read === 16 && header.toString("latin1") === SQLITE_MAGIC
    } finally {
      fsSync.closeSync(fd)
    }
  } catch {
    return false
  }
}

function fileSizeSync(filePath: string): number {
  try {
    return fsSync.statSync(filePath).size
  } catch {
    return -1
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

/**
 * Одноразовое резервное копирование «старой» БД sql.js перед первым открытием
 * через better-sqlite3. Файл sql.js — обычный SQLite, поэтому данные читаются
 * как есть; копия нужна, чтобы пользователь мог откатиться.
 */
function backupLegacyDatabaseIfNeeded(): void {
  try {
    if (!fsSync.existsSync(dbPath) || fileSizeSync(dbPath) <= 0) return

    const backupPath = `${dbPath}.sqljs-backup.bak`
    if (fsSync.existsSync(backupPath)) return

    let version = 0
    let readable = false
    try {
      const probe = new Database(dbPath, { readonly: true, fileMustExist: true })
      try {
        const row = probe.pragma("user_version", { simple: true })
        version = typeof row === "number" ? row : Number(row ?? 0)
        readable = true
      } finally {
        probe.close()
      }
    } catch (error) {
      console.error("[DB] legacy probe failed:", error)
    }

    // user_version >= DB_FORMAT_VERSION — файл уже открывался better-sqlite3.
    if (readable && version < DB_FORMAT_VERSION) {
      fsSync.copyFileSync(dbPath, backupPath)
      console.log(`[DB] legacy sql.js database backed up to ${backupPath}`)
    }
  } catch (error) {
    console.error("[DB] legacy backup failed:", error)
  }
}

/**
 * Если основной файл БД отсутствует или пуст, а рядом лежит `data.db.tmp`
 * (слепок, который писал sql.js при выходе), поднимаем его как рабочую БД.
 */
function recoverLegacyTmpFile(): void {
  try {
    if (!fsSync.existsSync(legacyTmpDbPath) || fileSizeSync(legacyTmpDbPath) <= 0) return
    if (fsSync.existsSync(dbPath) && fileSizeSync(dbPath) > 0) {
      // Основной файл на месте — временный слепок только мешает.
      return
    }
    if (!hasSqliteHeader(legacyTmpDbPath)) return
    fsSync.renameSync(legacyTmpDbPath, dbPath)
    console.log("[DB] recovered database from legacy data.db.tmp snapshot")
  } catch (error) {
    console.error("[DB] legacy tmp recovery failed:", error)
  }
}

/** Повреждённый файл не удаляем: уводим в сторону и стартуем с чистой БД. */
function quarantineUnreadableDatabase(): void {
  try {
    if (!fsSync.existsSync(dbPath) || fileSizeSync(dbPath) <= 0) return
    if (hasSqliteHeader(dbPath)) return
    const quarantinePath = `${dbPath}.corrupt-${Date.now()}.bak`
    fsSync.renameSync(dbPath, quarantinePath)
    console.error(`[DB] database file is not a SQLite database, moved to ${quarantinePath}`)
  } catch (error) {
    console.error("[DB] quarantine failed:", error)
  }
}

export async function initDatabaseCore(): Promise<void> {
  if (dbInitialized) return
  dbInitialized = true

  await fs.mkdir(path.dirname(dbPath), { recursive: true }).catch(() => {})

  try {
    recoverLegacyTmpFile()
    quarantineUnreadableDatabase()
    backupLegacyDatabaseIfNeeded()

    const db = new Database(dbPath)
    applyPragmas(db)
    database = db

    dbAvailable = true
    dbFallbackMode = false
    lastOpenError = null

    const version = db.prepare("SELECT sqlite_version() AS v").get() as { v?: string } | undefined
    console.log(`[DB] better-sqlite3 (SQLite ${version?.v ?? "?"}) opened at ${dbPath}`)
  } catch (error) {
    dbAvailable = false
    dbFallbackMode = true
    lastOpenError = error instanceof Error ? error.message : String(error)
    console.error("[DB] Falling back to in-memory storage:", error)
    try {
      database?.close()
    } catch {}
    database = null
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

export function getLauncherDirectory(): Promise<string> {
  return ensureDir(getDataDir())
}
