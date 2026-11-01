import { CachedAvatar } from "@/components/ui/cached-avatar"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl } from "@/lib/home-page-shared"

export function ShareAuthor({ author, name, currentUser }: { author: string; name: string; currentUser?: string }) {
  const { accounts, activeAccount, avatarVersion } = useAccounts()
  const account = author === currentUser && activeAccount
    ? activeAccount
    : accounts.find(account => account.username.toLowerCase() === name.toLowerCase())
  const src = account ? getAvatarUrl(account, account.username, avatarVersion) : getAvatarUrl({}, name)
  return <span className="flex min-w-0 items-center gap-2" title={name}>
    <CachedAvatar src={src} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" style={{ imageRendering: "pixelated" }} />
    <span className="truncate">{name}</span>
  </span>
}
