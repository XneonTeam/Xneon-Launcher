import { useMemo, useState } from "react"
import { useAccounts } from "@/src/AccountsContext"
import { getAvatarUrl } from "@/lib/home-page-shared"
import { useHomeLaunch } from "@/src/hooks/use-home-launch"
import { useHomeVersions } from "@/src/hooks/use-home-versions"
import { HomeControls } from "./controls"
import { NewsSection } from "./news"

export function HomePage() {
  const { accounts, activeAccount, setActiveAccount } = useAccounts()
  const [selectedModLoader, setSelectedModLoader] = useState("vanilla")
  const [accountComboOpen, setAccountComboOpen] = useState(false)
  const { versions, versionsLoaded, selectedVersion, setSelectedVersion } = useHomeVersions(selectedModLoader)
  const account = activeAccount ?? accounts[0]
  const activeAvatarUrl = useMemo(() => account ? getAvatarUrl(account, account.username) : "", [account])
  const accountAvatarUrls = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, getAvatarUrl(a, a.username)])), [accounts])
  const { isRunning, launchUi, launchDetails, handlePlay } = useHomeLaunch({ account, selectedVersion, selectedModLoader })

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 overflow-hidden items-start">
      <HomeControls
        accounts={accounts}
        account={account}
        accountComboOpen={accountComboOpen}
        setAccountComboOpen={setAccountComboOpen}
        setActiveAccount={setActiveAccount}
        versions={versions}
        versionsLoaded={versionsLoaded}
        selectedVersion={selectedVersion}
        setSelectedVersion={setSelectedVersion}
        selectedModLoader={selectedModLoader}
        setSelectedModLoader={setSelectedModLoader}
        activeAvatarUrl={activeAvatarUrl}
        accountAvatarUrls={accountAvatarUrls}
        launchUi={launchUi}
        launchDetails={launchDetails}
        isRunning={isRunning}
        onPlay={handlePlay}
      />
      <div className="flex-1 overflow-hidden"><NewsSection /></div>
    </div>
  )
}
