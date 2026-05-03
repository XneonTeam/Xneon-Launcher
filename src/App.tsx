import { Launcher } from '@/components/launcher/launcher'
import { AccountsProvider } from './AccountsContext'
import { TitleBar } from './TitleBar'

export function App() {
  return (
    <AccountsProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />
        <div className="flex-1 overflow-hidden">
          <Launcher />
        </div>
      </div>
    </AccountsProvider>
  )
}
