import crypto from "node:crypto"
import type { DbAccount } from "@xnlc/types" with { "resolution-mode": "import" }
import { queryAll, run, prepare, transactionImmediate, isDbAvailable, inMemoryAccounts } from "./core"

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
}

export function ensureInMemoryAccountDefaults() {
  // no-op: accounts have no defaults
}

export async function loadAccounts(): Promise<DbAccount[]> {
  if (!isDbAvailable()) {
    return Array.from(inMemoryAccounts.values()).map((a) => normalizeOfflineAccount(a as DbAccount))
  }

  const rows = queryAll<AccountRow>("SELECT * FROM accounts ORDER BY sortOrder ASC, rowid ASC")
  if (!Array.isArray(rows)) return []

  return rows.map((row) => normalizeOfflineAccount({
    id: row.id,
    type: row.type as DbAccount["type"],
    username: row.username,
    isActive: row.isActive === 1,
    uuid: row.uuid ?? undefined,
    accessToken: row.accessToken ?? undefined,
    refreshToken: row.refreshToken ?? undefined,
    clientId: row.clientId ?? undefined,
    skinUrl: row.skinUrl ?? undefined,
    sortOrder: row.sortOrder ?? undefined,
  }))
}

export async function saveAccount(account: DbAccount): Promise<void> {
  const normalizedAccount = normalizeOfflineAccount(account)

  if (!isDbAvailable()) {
    if (normalizedAccount.isActive) {
      for (const [id, existing] of inMemoryAccounts.entries()) {
        inMemoryAccounts.set(id, { ...(existing as DbAccount), isActive: id === normalizedAccount.id })
      }
    }
    inMemoryAccounts.set(normalizedAccount.id, normalizedAccount)
    return
  }

  const accountParams: unknown[] = [
    normalizedAccount.id,
    normalizedAccount.type,
    normalizedAccount.username,
    normalizedAccount.isActive ? 1 : 0,
    normalizedAccount.uuid ?? null,
    normalizedAccount.accessToken ?? null,
    normalizedAccount.refreshToken ?? null,
    normalizedAccount.clientId ?? null,
    normalizedAccount.skinUrl ?? null,
    normalizedAccount.sortOrder ?? 0,
  ]
  for (let i = 0; i < accountParams.length; i++) {
    const v = accountParams[i]
    if (v === undefined || typeof v === "boolean" || typeof v === "bigint") {
      console.error(`[DB] saveAccount param ${i + 1} for account ${normalizedAccount.id} has unexpected type: ${typeof v}, value: ${JSON.stringify(v)}, coercing to null`)
      accountParams[i] = null
    }
  }
  run(`
    INSERT OR REPLACE INTO accounts (id, type, username, isActive, uuid, accessToken, refreshToken, clientId, skinUrl, sortOrder)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, accountParams)
}

export async function removeAccount(id: string): Promise<void> {
  if (!isDbAvailable()) {
    inMemoryAccounts.delete(id)
    return
  }

  run("DELETE FROM accounts WHERE id = ?", [id])
}

export async function reorderAccounts(ids: string[]): Promise<void> {
  if (!isDbAvailable()) {
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
