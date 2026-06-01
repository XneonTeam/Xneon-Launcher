import { ActivityCenterProvider } from "./ActivityCenterContext"
import { Launcher } from '@/components/launcher/launcher'
import { LaunchLogsProvider } from "./LaunchLogsContext"
import { AccountsProvider } from './AccountsContext'
import { TitleBar } from './TitleBar'

export function App() {
  return (
    <ActivityCenterProvider>
      <AccountsProvider>
        <LaunchLogsProvider>
          <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
            <TitleBar />
            <div className="flex-1 overflow-hidden">
              <Launcher />
            </div>
          </div>
        </LaunchLogsProvider>
      </AccountsProvider>
    </ActivityCenterProvider>
  )
}
