import crypto from "node:crypto"
import type { DbAccount } from "@xnlc/types" with { "resolution-mode": "import" }
import { queryAll, run, prepare, transactionImmediate, isDbAvailable, inMemoryAccounts, requireTestDatabaseStorage } from "./core"
import { protectAccountSecret, readAccountSecret } from "./account-secrets"

export type { DbAccount }

function normalizeOfflineAccount(account: DbAccount): DbAccount {
  if (account.type !== "offline") {
    return account
  }

  const offlineAuth = createOfflineAuth(account.username)

  return {
    ...account,
    uuid: account.uuid ?? offlineAuth.uuid,
    accessToken: account.accessToken ?? offlineAuth.accessToken,
  }
}

function createOfflineAuth(username: string): { uuid: string; accessToken: string } {
  const data = `OfflinePlayer:${username}`
  const hash = crypto.createHash("md5").update(data, "utf8").digest()
  hash[6] = (hash[6]! & 0x0f) | 0x30
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.toString("hex")

  return {
    uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
    accessToken: "0",
  }
}

type AccountRow = {
  id: string
  type: string
  username: string
  isActive: number
  uuid: string | null
  accessToken: string | null
  refreshToken: string | null
  clientId: string | null
  skinUrl: string | null
  sortOrder?: number | null
  // Authlib-Injector
  serverId?: string | null
  serverUrl?: string | null
  serverName?: string | null
  yggClientToken?: string | null
  expiresAt?: number | null
  profiles?: string | null
}

export async function loadAccounts(): Promise<DbAccount[]> {
  if (!isDbAvailable()) {
    requireTestDatabaseStorage()
    return Array.from(inMemoryAccounts.values()).map((a) => normalizeOfflineAccount(a as DbAccount))
  }

  const rows = queryAll<AccountRow>("SELECT * FROM accounts ORDER BY sortOrder ASC, rowid ASC")
  if (!Array.isArray(rows)) return []

  // Обратимая миграция: при отказе шифрования исходное значение остаётся в БД.
  for (const row of rows) {
    for (const column of ["accessToken", "refreshToken", "yggClientToken"] as const) {
      const value = row[column]
      if (!value) continue
      try {
        const protectedValue = protectAccountSecret(value, true)
        if (protectedValue !== value) run(`UPDATE accounts SET ${column} = ? WHERE id = ? AND ${column} = ?`, [protectedValue, row.id, value])
      } catch { /* Недоступный keyring не уничтожает старую сессию. */ }
    }
  }

  return rows.map((row) => normalizeOfflineAccount({
    id: row.id,
    type: row.type as DbAccount["type"],
    username: row.username,
    isActive: row.isActive === 1,
    uuid: row.uuid ?? undefined,
    accessToken: readAccountSecret(row.accessToken),
    refreshToken: readAccountSecret(row.refreshToken),
    clientId: row.clientId ?? undefined,
    skinUrl: row.skinUrl ?? undefined,
    sortOrder: row.sortOrder ?? undefined,
    serverId: row.serverId ?? undefined,
    serverUrl: row.serverUrl ?? undefined,
    serverName: row.serverName ?? undefined,
    yggClientToken: readAccountSecret(row.yggClientToken),
    expiresAt: row.expiresAt ?? undefined,
    profiles: row.profiles ?? undefined,
  }))
}

function writeAccount(account: DbAccount): void {
  const normalizedAccount = normalizeOfflineAccount(account)

  if (!isDbAvailable()) {
    requireTestDatabaseStorage()
    if (normalizedAccount.isActive) {
      for (const [id, existing] of inMemoryAccounts.entries()) {
        inMemoryAccounts.set(id, { ...(existing as DbAccount), isActive: id === normalizedAccount.id })
      }
    }
    inMemoryAccounts.set(normalizedAccount.id, normalizedAccount)
    return
  }

  let existingRow: AccountRow | undefined
  if (normalizedAccount.id) {
      const rows = queryAll<AccountRow>(
        "SELECT type, username, isActive, uuid, accessToken, refreshToken, clientId, skinUrl, sortOrder, serverId, serverUrl, serverName, yggClientToken, expiresAt, profiles FROM accounts WHERE id = ?",
        [normalizedAccount.id],
      )
      existingRow = rows[0]
  }

  const accountParams: unknown[] = [
    normalizedAccount.id,
    normalizedAccount.type,
    normalizedAccount.username,
    normalizedAccount.isActive ? 1 : 0,
    normalizedAccount.uuid ?? null,
    protectAccountSecret(normalizedAccount.accessToken),
    normalizedAccount.refreshToken === undefined ? existingRow?.refreshToken ?? null : protectAccountSecret(normalizedAccount.refreshToken),
    normalizedAccount.clientId ?? existingRow?.clientId ?? null,
    normalizedAccount.skinUrl ?? existingRow?.skinUrl ?? null,
    normalizedAccount.sortOrder ?? existingRow?.sortOrder ?? 0,
    normalizedAccount.serverId ?? existingRow?.serverId ?? null,
    normalizedAccount.serverUrl ?? existingRow?.serverUrl ?? null,
    normalizedAccount.serverName ?? existingRow?.serverName ?? null,
    normalizedAccount.yggClientToken === undefined ? existingRow?.yggClientToken ?? null : protectAccountSecret(normalizedAccount.yggClientToken),
    normalizedAccount.expiresAt ?? existingRow?.expiresAt ?? null,
    normalizedAccount.profiles ?? existingRow?.profiles ?? null,
  ]
  for (let i = 0; i < accountParams.length; i++) {
    const v = accountParams[i]
    if (v === undefined || typeof v === "boolean" || typeof v === "bigint") {
      console.error(`[DB] saveAccount param ${i + 1} has unexpected type: ${typeof v}, coercing to null`)
      accountParams[i] = null
    }
  }
  run(`
    INSERT OR REPLACE INTO accounts (id, type, username, isActive, uuid, accessToken, refreshToken, clientId, skinUrl, sortOrder, serverId, serverUrl, serverName, yggClientToken, expiresAt, profiles)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, accountParams)
}

export async function saveAccount(account: DbAccount): Promise<void> {
  if (!isDbAvailable()) { writeAccount(account); return }
  transactionImmediate(() => {
    if (account.isActive) run("UPDATE accounts SET isActive = 0")
    writeAccount(account)
  })
}

/** Одноразовая миграция добавляет только отсутствующие ID и никогда не обновляет сессию. */
export function migrateLegacyAccounts(accounts: DbAccount[]): void {
  if (!isDbAvailable()) throw new Error("Account database is unavailable")
  transactionImmediate(() => {
    if (queryAll("SELECT value FROM settings WHERE key = ? AND value = 'true'", ["accounts.legacyImported"]).length) return
    let hasActive = queryAll("SELECT id FROM accounts WHERE isActive = 1 LIMIT 1").length > 0
    for (const account of accounts) {
      if (queryAll("SELECT id FROM accounts WHERE id = ?", [account.id]).length) continue
      const active = !hasActive && account.isActive === true
      writeAccount({ ...account, isActive: active })
      if (active) hasActive = true
    }
    run("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", ["accounts.legacyImported", "true"])
  })
}

export async function removeAccount(id: string): Promise<void> {
  if (!isDbAvailable()) {
    requireTestDatabaseStorage()
    inMemoryAccounts.delete(id)
    return
  }

  run("DELETE FROM accounts WHERE id = ?", [id])
}

export async function setActiveAccount(id: string): Promise<void> {
  if (!isDbAvailable()) throw new Error("Account database is unavailable")
  transactionImmediate(() => {
    if (!queryAll("SELECT id FROM accounts WHERE id = ?", [id]).length) throw new Error("Account not found")
    run("UPDATE accounts SET isActive = CASE WHEN id = ? THEN 1 ELSE 0 END", [id])
  })
}

export async function updateAccountDisplay(id: string, input: import("@xnlc/types").PublicAccount): Promise<void> {
  if (!isDbAvailable()) throw new Error("Account database is unavailable")
  // Отображаемые поля не проходят через upsert сессии.
  run("UPDATE accounts SET username = CASE WHEN type = 'offline' THEN ? ELSE username END, skinUrl = CASE WHEN type = 'offline' THEN ? ELSE skinUrl END WHERE id = ?", [input.username, input.skinUrl ?? null, id])
}

export async function reorderAccounts(ids: string[]): Promise<void> {
  if (!isDbAvailable()) {
    requireTestDatabaseStorage()
    const list = Array.from(inMemoryAccounts.values()) as DbAccount[]
    const sorted = list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    for (const account of sorted) {
      const index = ids.indexOf(account.id)
      if (index !== -1) inMemoryAccounts.set(account.id, { ...account, sortOrder: index })
    }
    return
  }

  // Один коммит на весь список вместо N отдельных записей.
  transactionImmediate(() => {
    const update = prepare("UPDATE accounts SET sortOrder = ? WHERE id = ?")
    for (let i = 0; i < ids.length; i++) {
      update.run(i, ids[i])
    }
  })
}
