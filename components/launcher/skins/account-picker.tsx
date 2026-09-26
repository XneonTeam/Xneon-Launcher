import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAccounts } from "@/src/AccountsContext"
import { ACCOUNT_TYPE_LABELS, getAvatarUrl } from "@/lib/home-page-shared"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"

/**
 * Блок аккаунта для левой панели скинов: текущий аккаунт и список тех, на кого
 * скин можно надеть.
 *
 * Показываем только Microsoft-аккаунты: Minecraft Services есть лишь у них, а у
 * остальных кнопка «Надеть» всё равно была бы недоступна.
 *
 * Разметку делили «Избранное» и каталог Laby — она была скопирована в оба
 * места слово в слово. `avatarVersion` сбрасывает кэш аватарки после смены
 * скина: тот же URL, но персонаж уже другой.
 */
export function SkinAccountPicker({ avatarVersion = 0 }: { avatarVersion?: number }) {
  const { t } = useTranslation()
  const { accounts, activeAccount, setActiveAccount } = useAccounts()
  const [open, setOpen] = useState(false)

  const account = activeAccount ?? accounts[0]
  const skinAccounts = useMemo(() => accounts.filter((a) => a.type === "microsoft"), [accounts])
  const avatarUrls = useMemo(
    () => Object.fromEntries(skinAccounts.map((a) => [a.id, getAvatarUrl(a, a.username)])),
    [skinAccounts],
  )
  const activeAvatarUrl = account
    ? `${getAvatarUrl(account, account.username)}${avatarVersion ? `&_v=${avatarVersion}` : ""}`
    : ""

  return (
    <div className="shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        className="w-full px-3.5 py-2.5 text-left transition-colors duration-200 hover:bg-muted/30"
        onClick={() => setOpen(true)}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("home.account", "Аккаунт")}
          </span>
          <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" size={14} strokeWidth={2} />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="size-8 shrink-0 overflow-hidden rounded-lg ring-2 ring-primary/20 ring-offset-2 ring-offset-card">
            {account ? (
              <CachedAvatar src={activeAvatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center bg-muted">
                <span className="text-[11px] font-bold text-muted-foreground">P</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground">{account?.username ?? "Player"}</p>
            <p className="text-[10px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[account?.type ?? "offline"]}</p>
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="px-5 pb-3 pt-5">
            <DialogTitle>{t("home.account", "Аккаунт")}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[400px] flex-col gap-1 overflow-y-auto px-3 pb-3">
            {skinAccounts.map((acc) => {
              const isActive = acc.id === account?.id
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => {
                    setActiveAccount(acc.id)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                    isActive ? "border-primary/25 bg-primary/15" : "border-transparent hover:bg-muted/60",
                  )}
                >
                  <div className="size-10 shrink-0 overflow-hidden rounded-lg">
                    <CachedAvatar src={avatarUrls[acc.id]} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{acc.username}</p>
                    <p className="text-[11px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}</p>
                  </div>
                  {isActive && <IconCheck className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />}
                </button>
              )
            })}
            {skinAccounts.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("skins.noMicrosoftAccounts", "Нет аккаунтов Microsoft")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}