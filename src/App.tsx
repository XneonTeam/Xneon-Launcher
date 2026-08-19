import { useEffect, useState } from "react"
import { ActivityCenterProvider } from "./ActivityCenterContext"
import { Launcher } from '@/components/launcher/launcher'
import { LaunchLogsProvider } from "./LaunchLogsContext"
import { AccountsProvider } from './AccountsContext'
import { TitleBar } from './TitleBar'
import { initI18n } from './i18n'

export function App() {
  const [modulesReady, setModulesReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void initI18n().then(() => {
      if (cancelled) return
      setModulesReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ActivityCenterProvider>
      <AccountsProvider>
        <LaunchLogsProvider>
          <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
            <TitleBar />
            <div className="flex-1 overflow-hidden">
              {modulesReady && <Launcher onReady={() => {}} />}
            </div>
          </div>
        </LaunchLogsProvider>
      </AccountsProvider>
    </ActivityCenterProvider>
  )
}
