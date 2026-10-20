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

  const skinAccounts = useMemo(() => accounts.filter((a) => a.type !== "elyby" && a.type !== "offline"), [accounts])
  const account = (activeAccount && activeAccount.type !== "elyby" && activeAccount.type !== "offline" ? activeAccount : skinAccounts[0]) ?? null
  const avatarUrls = useMemo(
    () => Object.fromEntries(skinAccounts.map((a) => [a.id, getAvatarUrl(a, a.username, avatarVersion)])),
    [skinAccounts, avatarVersion],
  )
  const activeAvatarUrl = account
    ? getAvatarUrl(account, account.username, avatarVersion)
    : ""

  return (
    <div data-ui="skins-account-picker-div-1" data-component="skin-account-picker" className="shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button data-ui="skins-account-picker-button-1"
        type="button"
        className="w-full px-3.5 py-2.5 text-left transition-colors duration-200 hover:bg-muted/30"
        onClick={() => setOpen(true)}
      >
        <div data-ui="skins-account-picker-div-2" className="mb-1 flex items-center justify-between">
          <span data-ui="skins-account-picker-span-1" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("home.account", "Аккаунт")}
          </span>
          <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" size={14} strokeWidth={2} />
        </div>
        <div data-ui="skins-account-picker-div-3" className="flex items-center gap-2.5">
          <div data-ui="skins-account-picker-div-4" className="size-8 shrink-0 overflow-hidden rounded-lg ring-2 ring-primary/20 ring-offset-2 ring-offset-card">
            {account ? (
              <CachedAvatar src={activeAvatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div data-ui="skins-account-picker-div-5" className="grid h-full w-full place-items-center bg-muted">
                <span data-ui="skins-account-picker-span-2" className="text-[11px] font-bold text-muted-foreground">P</span>
              </div>
            )}
          </div>
          <div data-ui="skins-account-picker-div-6" className="min-w-0 flex-1">
            <p data-ui="skins-account-picker-p-1" className="truncate text-[13px] font-semibold text-foreground">{account?.username ?? "Player"}</p>
            <p data-ui="skins-account-picker-p-2" className="text-[10px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[account?.type ?? "offline"]}</p>
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-window="skins-account-picker-window-1" className="max-w-md gap-0 p-0">
          <DialogHeader className="px-5 pb-3 pt-5">
            <DialogTitle>{t("home.account", "Аккаунт")}</DialogTitle>
          </DialogHeader>
          <div data-ui="skins-account-picker-div-7" className="flex max-h-[400px] flex-col gap-1 overflow-y-auto px-3 pb-3">
            {skinAccounts.map((acc) => {
              const isActive = acc.id === account?.id
              return (
                <button data-ui="skins-account-picker-button-2"
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
                  <div data-ui="skins-account-picker-div-8" className="size-10 shrink-0 overflow-hidden rounded-lg">
                    <CachedAvatar src={avatarUrls[acc.id]} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div data-ui="skins-account-picker-div-9" className="min-w-0 flex-1">
                    <p data-ui="skins-account-picker-p-3" className="truncate text-sm font-medium text-foreground">{acc.username}</p>
                    <p data-ui="skins-account-picker-p-4" className="text-[11px] text-muted-foreground">{ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}</p>
                  </div>
                  {isActive && <IconCheck className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />}
                </button>
              )
            })}
            {skinAccounts.length === 0 && (
              <p data-ui="skins-account-picker-p-5" className="py-4 text-center text-sm text-muted-foreground">
                {t("skins.noAccounts", "Нет добавленных аккаунтов")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}