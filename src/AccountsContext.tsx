import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'

export interface Account {
  id: string
  type: 'elyby' | 'xnskins' | 'microsoft' | 'offline'
  username: string
  isActive: boolean
  uuid?: string
  accessToken?: string
  refreshToken?: string
  clientId?: string
  skinUrl?: string
}

const FALLBACK: Account[] = [{ id: '1', type: 'offline', username: 'Player', isActive: true }]

async function fetchAccounts(): Promise<Account[]> {
  const validAccountTypes = ['elyby', 'xnskins', 'microsoft', 'offline'] as const
  const isValidType = (t: string): t is typeof validAccountTypes[number] =>
    validAccountTypes.includes(t as typeof validAccountTypes[number])

  try {
    if (window.electronAPI) {
      const dbAccounts = await window.electronAPI.loadAccounts()
      const validAccounts = dbAccounts.filter(a => isValidType(a.type))
      if (validAccounts.length > 0) {
        for (const a of dbAccounts) {
          if (!isValidType(a.type)) {
            await window.electronAPI?.removeAccount(a.id)
          }
        }
        return validAccounts.map(a => ({ ...a, isActive: a.isActive ?? false }))
      }
    }
  } catch {}
  try {
    const raw = localStorage.getItem('xneon-launcher:accounts')
    if (raw) {
      const parsed = JSON.parse(raw) as Account[]
      const validAccounts = parsed.filter(a => isValidType(a.type))
      for (const a of validAccounts) {
        await window.electronAPI?.saveAccount(a)
      }
      if (validAccounts.length > 0) return validAccounts
    }
  } catch {}
  return FALLBACK
}

interface AccountsContextValue {
  accounts: Account[]
  addAccount: (account: Account) => void
  removeAccount: (id: string) => void
  setActiveAccount: (id: string) => void
  activeAccount: Account | null
}

const AccountsContext = createContext<AccountsContextValue | null>(null)

export function AccountsProvider({ children }: PropsWithChildren) {
  const [accounts, setAccounts] = useState<Account[]>(FALLBACK)
  const accountsLoadedRef = useRef(false)
  const syncTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    void fetchAccounts().then((loadedAccounts) => {
      accountsLoadedRef.current = true
      setAccounts(loadedAccounts)
    })
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.type === "account") {
        void fetchAccounts().then(setAccounts)
      }
    }
    window.addEventListener("cloud:imported", handler)
    return () => window.removeEventListener("cloud:imported", handler)
  }, [])

  useEffect(() => {
    if (!accountsLoadedRef.current) return
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current)
    }
    syncTimeoutRef.current = window.setTimeout(() => {
      syncTimeoutRef.current = null
      accounts.forEach((account) => {
        void window.electronAPI?.saveAccount(account)
      })
    }, 150)
  }, [accounts])

  useEffect(() => () => {
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current)
    }
  }, [])

  const addAccount = useCallback((account: Account) => {
    setAccounts(prev => {
      const existing = prev.find(a => a.id === account.id)
      if (existing) {
        const shouldBeActive = account.isActive || existing.isActive
        const updated = prev.map(a => a.id === account.id
          ? { ...a, ...account, isActive: shouldBeActive }
          : { ...a, isActive: shouldBeActive ? false : a.isActive })
        return updated
      }

      const updated = [...prev, { ...account, isActive: prev.length === 0 || account.isActive }]
      if (account.isActive && prev.length > 0) {
        return updated.map(a => ({ ...a, isActive: a.id === account.id }))
      }

      return updated
    })
  }, [])

  const removeAccount = useCallback((id: string) => {
    setAccounts(prev => {
      const remaining = prev.filter(a => a.id !== id)
      const wasActive = prev.find(a => a.id === id)?.isActive
      if (wasActive && remaining.length > 0) {
        const updated = remaining.map((a, i) => ({ ...a, isActive: i === 0 }))
        void window.electronAPI?.removeAccount(id)
        return updated
      }
      void window.electronAPI?.removeAccount(id)
      return remaining
    })
  }, [])

  const setActiveAccount = useCallback((id: string) => {
    setAccounts(prev => {
      if (prev.some(a => a.id === id && a.isActive)) return prev
      return prev.map(a => ({ ...a, isActive: a.id === id }))
    })
  }, [])

  const activeAccount = useMemo(() => accounts.find(a => a.isActive) ?? accounts[0] ?? null, [accounts])
  const value = useMemo<AccountsContextValue>(() => ({
    accounts,
    addAccount,
    removeAccount,
    setActiveAccount,
    activeAccount,
  }), [accounts, addAccount, removeAccount, setActiveAccount, activeAccount])

  return (
    <AccountsContext.Provider value={value}>
      {children}
    </AccountsContext.Provider>
  )
}

export function useAccounts() {
  const ctx = useContext(AccountsContext)
  if (!ctx) throw new Error('useAccounts must be used inside AccountsProvider')
  return ctx
}
