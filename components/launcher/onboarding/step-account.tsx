import { cn } from "@/lib/utils"
import { IconCheck, IconLoader2, IconUserMinus } from "@tabler/icons-react"
import { MicrosoftIcon, ElyByIcon, XnSkinsIcon } from "./icons"
import type { OnboardingCopy } from "./translations"

type StepAccountProps = {
  copy: OnboardingCopy
  accounts: Account[]
  anyLoginLoading: boolean
  getAvatarUrl: (account: Account, username: string) => string
  setActiveAccount: (id: string) => void
  onProviderLogin: (provider: "elyby" | "xnskins" | "microsoft") => void
  onOpenOffline: () => void
}

type ProviderCard = {
  id: "microsoft" | "elyby" | "xnskins"
  title: string
  description: string
  active: boolean
  accent: string
  color: string
}

type Account = {
  id: string
  type: string
  username: string
  isActive: boolean
}

export function StepAccount({ copy, accounts, anyLoginLoading, getAvatarUrl, setActiveAccount, onProviderLogin, onOpenOffline }: StepAccountProps) {
  const providerCards: ProviderCard[] = [
    {
      id: "microsoft", title: "Microsoft",
      description: "Official Mojang / Microsoft sign-in.",
      active: false, accent: "from-sky-500/20 to-cyan-400/5", color: "#2563EB",
    },
    {
      id: "elyby", title: "Ely.By",
      description: "Sign in with an Ely.By account.",
      active: false, accent: "from-emerald-500/20 to-lime-400/5", color: "#217e5c",
    },
    {
      id: "xnskins", title: "XN Skins",
      description: "Sign in with XN Skins support.",
      active: false, accent: "from-fuchsia-500/20 to-orange-400/5", color: "#f97316",
    },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {providerCards.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled={anyLoginLoading}
            onClick={() => onProviderLogin(provider.id)}
            className={cn(
              "relative overflow-hidden rounded-xl border border-border bg-muted/30 p-4 text-left transition-all duration-200 hover:border-primary/50 hover:bg-muted/50",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            <div
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${provider.color}20`, color: provider.color }}
            >
              {provider.id === "microsoft" ? <MicrosoftIcon className="h-6 w-6" />
                : provider.id === "elyby" ? <ElyByIcon className="h-6 w-6" />
                : <XnSkinsIcon className="h-6 w-6" />}
            </div>
            <div className="font-medium text-foreground">{provider.title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{provider.description}</div>
            {provider.active && <IconLoader2 className="absolute right-4 top-4 h-5 w-5 animate-spin text-primary" strokeWidth={2} />}
          </button>
        ))}

        <button
          type="button"
          onClick={onOpenOffline}
          className={cn(
            "relative overflow-hidden rounded-xl border border-border bg-muted/30 p-4 text-left transition-all duration-200 hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: "#75757520", color: "#757575" }}>
            <IconUserMinus className="h-6 w-6" />
          </div>
          <div className="font-medium text-foreground">{copy.accountOfflineTitle}</div>
          <div className="mt-1 text-sm text-muted-foreground">{copy.accountOfflinePlaceholder}</div>
        </button>
      </div>

      {accounts.length > 0 && (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className={cn(
                "flex items-center gap-4 rounded-xl border p-4 transition-all duration-200",
                account.isActive
                  ? "border-primary bg-primary/10 shadow-[0_0_15px_var(--glow-primary)]"
                  : "border-border bg-muted/30 hover:border-primary/50"
              )}
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                <img src={getAvatarUrl(account, account.username)} alt="" className="h-full w-full object-cover"
                  onError={(e) => {
                    const t = e.currentTarget
                    if (!t.dataset.retried) { t.dataset.retried = "1"; t.src = "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft" }
                    else { t.style.display = "none" }
                  }} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{account.username}</span>
                  {account.isActive && (
                    <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                      {copy.accountSelected}
                    </span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">{account.type}</span>
              </div>

              {!account.isActive && (
                <button
                  type="button"
                  onClick={() => setActiveAccount(account.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
                >
                  <IconCheck className="h-4 w-4" strokeWidth={1.75} />
                  {copy.accountSelect}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
