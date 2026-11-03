import { CachedAvatar } from "@/components/ui/cached-avatar"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl } from "@/lib/home-page-shared"

export function ShareAuthor({ author, name, currentUser, size = "normal" }: { author: string; name: string; currentUser?: string; size?: "normal" | "large" }) {
  const { accounts, activeAccount, avatarVersion } = useAccounts()
  const account = author === currentUser && activeAccount
    ? activeAccount
    : accounts.find(account => account.username.toLowerCase() === name.toLowerCase())
  const src = account ? getAvatarUrl(account, account.username, avatarVersion) : getAvatarUrl({}, name)
  return <span className="flex min-w-0 items-center gap-2" title={name}>
    <CachedAvatar src={src} alt="" className={`${size === "large" ? "h-9 w-9 rounded-lg" : "h-6 w-6 rounded-md"} shrink-0 object-cover`} style={{ imageRendering: "pixelated" }} />
    <span className="truncate">{name}</span>
  </span>
}
