import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import type { PublicAccount, DbAccount } from '@xnlc/types'

export type Account = PublicAccount
const FALLBACK: Account[] = [{ id: '1', type: 'offline', username: 'Player', isActive: true }]

export async function fetchAccounts(): Promise<Account[]> {
  const api = window.electrobunAPI
  if (!api) return FALLBACK
  const accounts = await api.loadAccounts()
  const raw = localStorage.getItem('xneon-launcher:accounts')
  if (raw) {
    // Main импортирует только отсутствующие ID и не принимает обратные снимки сессий.
    let legacy: unknown
    try { legacy = JSON.parse(raw) } catch { return accounts.length ? accounts : FALLBACK }
    if (!Array.isArray(legacy)) return accounts.length ? accounts : FALLBACK
    const supported = new Set(['offline', 'microsoft', 'elyby', 'xnskins', 'authlib-injector'])
    const entries: unknown[] = legacy
    const known = entries.filter((account): account is DbAccount => !!account && typeof account === 'object'
      && 'type' in account && typeof account.type === 'string' && supported.has(account.type))
    try { if (known.length) await api.importLegacyAccounts(known) }
    catch (error) {
      console.warn('[Accounts] Legacy migration retained for retry:', error)
      return accounts.length ? accounts : FALLBACK
    }
    const migrated = await api.loadAccounts()
    const persisted = new Set(migrated.map(account => `${account.type}:${account.id}`))
    // Удаляем только действительно перенесённые записи; будущие/неподдерживаемые
    // и не принятые main данные остаются восстановимыми, а не теряются молча.
    const remaining = entries.filter(account => !account || typeof account !== 'object' || !('type' in account) || !('id' in account)
      || !persisted.has(`${String(account.type)}:${String(account.id)}`))
    if (remaining.length) localStorage.setItem('xneon-launcher:accounts', JSON.stringify(remaining))
    else localStorage.removeItem('xneon-launcher:accounts')
    return migrated.length ? migrated : FALLBACK
  }
  return accounts.length ? accounts : FALLBACK
}

interface AccountsContextValue {
  accounts: Account[]
  addAccount: (account: Account) => void
  removeAccount: (id: string) => void
  setActiveAccount: (id: string) => void
  moveAccount: (id: string, direction: -1 | 1) => void
  activeAccount: Account | null
  accountsHydrated: boolean
  avatarVersion: number
  bumpAvatarVersion: () => void
  reloadAccounts: () => Promise<void>
}

const AccountsContext = createContext<AccountsContextValue | null>(null)

export function AccountsProvider({ children }: PropsWithChildren) {
  const [accountsHydrated, setAccountsHydrated] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>(FALLBACK)
  const [avatarVersion, setAvatarVersion] = useState(() => Date.now())
  const accountsRef = useRef(accounts)
  const writesRef = useRef<Promise<unknown>>(Promise.resolve())
  const loadRevision = useRef(0)

  const replace = useCallback((next: Account[]) => {
    accountsRef.current = next
    setAccounts(next)
  }, [])
  const reloadAccounts = useCallback(async () => {
    const revision = ++loadRevision.current
    const loaded = await fetchAccounts()
    if (revision === loadRevision.current) replace(loaded)
  }, [replace])
  const persist = useCallback((operation: () => Promise<unknown>) => {
    ++loadRevision.current
    writesRef.current = writesRef.current.then(operation).then(() => reloadAccounts()).catch(error => {
      console.warn('[Accounts] Persistence failed:', error)
      return reloadAccounts().catch(reloadError => console.warn('[Accounts] Reload failed:', reloadError))
    })
  }, [reloadAccounts])

  useEffect(() => {
    void reloadAccounts().catch(error => console.warn('[Accounts] Hydration failed:', error)).finally(() => setAccountsHydrated(true))
  }, [reloadAccounts])
  useEffect(() => {
    const refresh = () => { void writesRef.current.then(reloadAccounts).catch(error => console.warn('[Accounts] Reload failed:', error)) }
    const cloud = (event: Event) => { if ((event as CustomEvent).detail?.type === 'account') refresh() }
    window.addEventListener('launcher:agent-accounts-updated', refresh)
    window.addEventListener('cloud:imported', cloud)
    return () => {
      window.removeEventListener('launcher:agent-accounts-updated', refresh)
      window.removeEventListener('cloud:imported', cloud)
    }
  }, [reloadAccounts])

  const addAccount = useCallback((account: Account) => {
    const previous = accountsRef.current
    const active = account.isActive || previous.length === 0
    const next = previous.some(item => item.id === account.id)
      ? previous.map(item => item.id === account.id ? { ...item, ...account } : item)
      : [...previous, account]
    replace(active ? next.map(item => ({ ...item, isActive: item.id === account.id })) : next)
    persist(async () => { await window.electrobunAPI?.saveAccount(account) })
  }, [persist, replace])

  const removeAccount = useCallback((id: string) => {
    const target = accountsRef.current.find(item => item.id === id)
    const remaining = accountsRef.current.filter(item => item.id !== id)
    replace(target?.isActive ? remaining.map((item, index) => ({ ...item, isActive: index === 0 })) : remaining)
    persist(async () => {
      const api = window.electrobunAPI
      if (target?.type === 'authlib-injector') await api?.authlibInvalidate(id).catch(error => console.warn('[Accounts] Invalidate failed:', error))
      await api?.removeAccount(id)
      if (target?.isActive && remaining[0]) await api?.setActiveAccount(remaining[0].id)
    })
  }, [persist, replace])

  const setActiveAccount = useCallback((id: string) => {
    replace(accountsRef.current.map(item => ({ ...item, isActive: item.id === id })))
    persist(async () => { await window.electrobunAPI?.setActiveAccount(id) })
  }, [persist, replace])

  const moveAccount = useCallback((id: string, direction: -1 | 1) => {
    const next = [...accountsRef.current]
    const index = next.findIndex(item => item.id === id), target = index + direction
    if (index < 0 || target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    const ordered = next.map((item, sortOrder) => ({ ...item, sortOrder }))
    replace(ordered)
    persist(async () => { await window.electrobunAPI?.reorderAccounts(ordered.map(item => item.id)) })
  }, [persist, replace])

  const bumpAvatarVersion = useCallback(() => setAvatarVersion(Date.now()), [])
  const activeAccount = accounts.find(item => item.isActive) ?? accounts[0] ?? null
  const value = useMemo(() => ({ accounts, activeAccount, accountsHydrated, addAccount, removeAccount, setActiveAccount, moveAccount, avatarVersion, bumpAvatarVersion, reloadAccounts }),
    [accounts, activeAccount, accountsHydrated, addAccount, removeAccount, setActiveAccount, moveAccount, avatarVersion, bumpAvatarVersion, reloadAccounts])
  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>
}

export function useAccounts() {
  const context = useContext(AccountsContext)
  if (!context) throw new Error('useAccounts must be used inside AccountsProvider')
  return context
}
