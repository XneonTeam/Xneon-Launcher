import { useCallback } from "react"
import { I18nextProvider } from "react-i18next"
import { ThemeRegistryProvider } from "@/components/launcher/settings/theme-store"
import { ActivityCenterProvider } from "./ActivityCenterContext"
import { Launcher } from '@/components/launcher/launcher'
import { LaunchLogsProvider } from "./LaunchLogsContext"
import { AccountsProvider } from './AccountsContext'
import { TitleBar } from './TitleBar'
import i18n from './i18n'
import { ShareEntryHandler } from '@/components/launcher/instance/shared/share-entry-handler'
import { ShareInstallProgress } from '@/components/launcher/instance/shared/share-install-progress'

export function App() {
  const notifyReady = useCallback(() => window.dispatchEvent(new Event('app:hydrated')), [])

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeRegistryProvider>
        <ActivityCenterProvider>
          <AccountsProvider>
            <LaunchLogsProvider>
              <div data-ui="app-div-1" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
                <TitleBar />
                <div data-ui="app-div-2" className="flex-1 overflow-hidden">
                  <Launcher onReady={notifyReady} />
                  <ShareEntryHandler />
                  <ShareInstallProgress />
                </div>
              </div>
            </LaunchLogsProvider>
          </AccountsProvider>
        </ActivityCenterProvider>
      </ThemeRegistryProvider>
    </I18nextProvider>
  )
}
