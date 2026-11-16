import type { DbAccount, PublicAccount } from "@xnlc/types"
import { dbHelpers } from "../db"
import { migrateLegacyAccounts, setActiveAccount, updateAccountDisplay } from "../db/accounts"
import { rpcRegistry } from "../platform/ipc"
const supportedAccountTypes = new Set(["offline", "microsoft", "elyby", "xnskins", "authlib-injector"])

export async function loadPublicAccounts(): Promise<PublicAccount[]> {
  // Неизвестные записи старых/будущих версий остаются в БД, но не ломают UI.
  return (await dbHelpers.loadAccounts()).filter(account => supportedAccountTypes.has(account.type)).map(publicAccount)
}

export function registerAccountHandlers(): void {
  rpcRegistry.handle("db:load-accounts", loadPublicAccounts)
  rpcRegistry.handle("db:save-account", async (_event, account) => saveAccountDisplay(account))
  rpcRegistry.handle("db:set-active-account", async (_event, id) => setActiveAccount(id))
  rpcRegistry.handle("db:import-legacy-accounts", async (_event, accounts) => importLegacyAccounts(accounts))
  rpcRegistry.handle("db:remove-account", async (_event, id) => dbHelpers.removeAccount(id))
  rpcRegistry.handle("db:reorder-accounts", async (_event, ids) => {
    if (!Array.isArray(ids) || ids.length > 128 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw new Error("Invalid account order")
    await dbHelpers.reorderAccounts(ids)
  })
}

export function publicAccount(account: DbAccount): PublicAccount {
  // Только allowlist, не деструктуризация с rest: новое секретное поле не уйдёт в UI.
  return { id: account.id, type: account.type, username: account.username, isActive: account.isActive,
    uuid: account.uuid, skinUrl: account.skinUrl, sortOrder: account.sortOrder,
    serverId: account.serverId, serverUrl: account.serverUrl, serverName: account.serverName, expiresAt: account.expiresAt }
}

export async function saveAuthenticatedAccount(type: DbAccount["type"], payload: Omit<DbAccount, "type" | "isActive">): Promise<PublicAccount> {
  const accounts = await dbHelpers.loadAccounts()
  const previous = accounts.find(account => account.id === payload.id)
  const account = { ...payload, type, isActive: previous?.isActive ?? !accounts.some(account => supportedAccountTypes.has(account.type)) }
  await dbHelpers.saveAccount(account)
  return publicAccount(account)
}

export async function saveAccountDisplay(input: PublicAccount): Promise<void> {
  if (!input || typeof input.id !== "string" || typeof input.username !== "string" || !input.id || input.id.length > 512 || input.username.length > 256) throw new Error("Invalid account")
  const secretKeys = ["accessToken", "refreshToken", "yggClientToken", "clientToken", "profiles"]
  if (secretKeys.some(key => key in input)) throw new Error("Session fields cannot be written from renderer")
  const accounts = await dbHelpers.loadAccounts()
  const previous = accounts.find(account => account.id === input.id)
  if (!previous) {
    if (input.type !== "offline") throw new Error("Authenticated account must be created in main")
    await dbHelpers.saveAccount({ id: input.id, type: "offline", username: input.username,
      isActive: input.isActive === true || !accounts.some(account => supportedAccountTypes.has(account.type)), skinUrl: input.skinUrl })
  } else {
    await updateAccountDisplay(input.id, input)
  }
  if (input.isActive === true) await setActiveAccount(input.id)
}

/** Одноразовый перенос localStorage: существующие ID и их сессии всегда авторитетны. */
export async function importLegacyAccounts(accounts: DbAccount[]): Promise<void> {
  if (!Array.isArray(accounts) || accounts.length > 128) throw new Error("Invalid legacy accounts")
  for (const account of accounts) {
    if (!account || typeof account.id !== "string" || !account.id || account.id.length > 512 || typeof account.username !== "string" || account.username.length > 256
      || !["offline", "microsoft", "elyby", "xnskins", "authlib-injector"].includes(account.type)) throw new Error("Invalid legacy account")
    if (account.isActive !== undefined && typeof account.isActive !== "boolean") throw new Error("Invalid legacy active flag")
    for (const key of ["sortOrder", "expiresAt"] as const) if (account[key] !== undefined && (typeof account[key] !== "number" || !Number.isFinite(account[key]))) throw new Error("Invalid legacy account number")
    for (const key of ["id", "username", "uuid", "accessToken", "refreshToken", "clientId", "skinUrl", "serverId", "serverUrl", "serverName", "yggClientToken", "profiles"] as const) {
      if (account[key] !== undefined && (typeof account[key] !== "string" || account[key]!.length > 1024 * 1024)) throw new Error("Invalid legacy account field")
    }
  }
  migrateLegacyAccounts(accounts)
}

/** Старые облачные копии содержали только метаданные. Уже существующая сессия авторитетна. */
export async function restoreAccountMetadata(input: { id: string; type: string; username: string; uuid?: string }): Promise<PublicAccount> {
  if (typeof input.id !== "string" || !input.id || typeof input.username !== "string"
    || !["offline", "microsoft", "elyby", "xnskins", "authlib-injector"].includes(input.type)) throw new Error("Invalid account metadata")
  const previous = (await dbHelpers.loadAccounts()).find(account => account.id === input.id)
  if (previous) return publicAccount(previous)
  const account: DbAccount = { id: input.id, type: input.type as DbAccount["type"], username: input.username, uuid: typeof input.uuid === "string" ? input.uuid : undefined, isActive: false }
  await dbHelpers.saveAccount(account)
  return publicAccount(account)
}
