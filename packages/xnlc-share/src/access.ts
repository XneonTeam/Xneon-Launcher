export interface ShareAccount {
  type: string
  username: string
  isActive?: boolean
}

/** Достаточно любого сохранённого аккаунта, кроме offline; активность не обязательна. */
export function selectShareAccount<T extends ShareAccount>(accounts: readonly T[]): T | undefined {
  return accounts.find(account => account.type.toLowerCase() !== "offline" && account.isActive)
    ?? accounts.find(account => account.type.toLowerCase() !== "offline")
}
