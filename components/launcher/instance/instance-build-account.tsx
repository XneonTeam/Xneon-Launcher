import { useRef, useState } from "react"
import { IconUser, IconUsers, IconCheck, IconChevronDown } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import { useAccounts } from "@/src/AccountsContext"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ModalTitleIcon } from "@/components/ui/modal-title-icon"
import { CachedAvatar } from "@/components/ui/cached-avatar"
import { ACCOUNT_TYPE_LABELS, getAvatarUrl } from "@/lib/home-page-shared"
import { cn } from "@/lib/utils"
import type { Build } from "./types"

export function InstanceBuildAccount({ build, updateBuild }: { build: Build; updateBuild(id: string, fields: Partial<Build>): void }) {
  const { t } = useTranslation()
  const { accounts, activeAccount, avatarVersion } = useAccounts()
  const [open, setOpen] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const selectedAccount = accounts.find(account => account.id === build.defaultAccountId)
  const selected = selectedAccount?.id ?? "active"
  const displayAccount = selectedAccount ?? activeAccount
  const choose = (id: string) => {
    updateBuild(build.id, { defaultAccountId: id === "active" ? undefined : id })
    setOpen(false)
  }
  const accountType = (account: typeof accounts[number]) => account.type === "authlib-injector" && account.serverName
    ? `${ACCOUNT_TYPE_LABELS[account.type]} · ${account.serverName}`
    : ACCOUNT_TYPE_LABELS[account.type] ?? account.type

  return <section className="rounded-3xl border border-border bg-card/40 p-6">
    <h3 className="flex items-center gap-2 text-lg font-semibold"><IconUser className="h-5 w-5 text-primary" strokeWidth={1.75} />{t("build.account.title")}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{t("build.account.description")}</p>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="mt-4 flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {displayAccount ? <CachedAvatar src={getAvatarUrl(displayAccount, displayAccount.username, avatarVersion)} alt="" className="size-9 shrink-0 rounded-lg object-cover" /> : <IconUsers className="size-9 shrink-0 p-2 text-primary" />}
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{selectedAccount?.username ?? t("build.account.active")}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{selectedAccount ? accountType(selectedAccount) : displayAccount ? `${displayAccount.username} · ${accountType(displayAccount)}` : t("skins.noAccounts")}</span></span>
      <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-window="instance-build-account-window" className="max-w-md gap-0 p-0" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus() }}>
        <DialogHeader className="px-5 pb-3 pt-5">
          <DialogTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2 outline-none"><ModalTitleIcon><IconUsers className="size-4" strokeWidth={1.75} /></ModalTitleIcon>{t("build.account.title")}</DialogTitle>
          <DialogDescription>{t("build.account.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[400px] flex-col gap-1 overflow-y-auto px-3 pb-3 pt-2">
          <button type="button" onClick={() => choose("active")} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:border-primary", selected === "active" ? "border-primary/25 bg-primary/15" : "border-transparent hover:bg-muted/60")}>
            <IconUsers className="size-10 shrink-0 rounded-lg bg-muted/50 p-2.5 text-primary" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t("build.account.active")}</span>{activeAccount && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{activeAccount.username} · {accountType(activeAccount)}</span>}</span>
            {selected === "active" && <IconCheck className="size-4 shrink-0 text-primary" />}
          </button>
          {accounts.map(account => <button key={account.id} type="button" onClick={() => choose(account.id)} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:border-primary", selected === account.id ? "border-primary/25 bg-primary/15" : "border-transparent hover:bg-muted/60")}>
            <CachedAvatar src={getAvatarUrl(account, account.username, avatarVersion)} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{account.username}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{accountType(account)}</span></span>
            {selected === account.id && <IconCheck className="size-4 shrink-0 text-primary" />}
          </button>)}
        </div>
      </DialogContent>
    </Dialog>
  </section>
}
