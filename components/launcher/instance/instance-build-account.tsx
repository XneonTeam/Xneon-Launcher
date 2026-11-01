import { IconUser } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import { useAccounts } from "@/src/AccountsContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Build } from "./types"

export function InstanceBuildAccount({ build, updateBuild }: { build: Build; updateBuild(id: string, fields: Partial<Build>): void }) {
  const { t } = useTranslation()
  const { accounts } = useAccounts()
  const selected = accounts.some(account => account.id === build.defaultAccountId) ? build.defaultAccountId : "active"
  return <section className="rounded-3xl border border-border bg-card/40 p-6">
    <h3 className="flex items-center gap-2 text-lg font-semibold"><IconUser className="h-5 w-5 text-primary" strokeWidth={1.75} />{t("build.account.title")}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{t("build.account.description")}</p>
    <Select value={selected} onValueChange={value => updateBuild(build.id, { defaultAccountId: value === "active" ? undefined : value })}>
      <SelectTrigger aria-label={t("build.account.title")} className="mt-4 w-full rounded-xl border-border bg-muted/40"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="active">{t("build.account.active")}</SelectItem>{accounts.map(account => <SelectItem key={account.id} value={account.id}>{account.username}</SelectItem>)}</SelectContent>
    </Select>
  </section>
}
