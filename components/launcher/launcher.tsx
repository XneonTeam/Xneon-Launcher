import { useState } from "react"
import { AccountsPage } from "./accounts-page"
import { InstancePage } from "./instance"
import { CloudPage } from "./cloud"
import { FriendsPage } from "./friends-page"
import { HomePage } from "./home-page"
import { LogsPage } from "./logs-page"
import { ModsPage } from "./mods"
import { ServersPage } from "./servers-page"
import { SettingsPage } from "./settings"
import { Sidebar, type TabId } from "./sidebar"
import { LaunchLogsProvider } from "@/src/LaunchLogsContext"

export function Launcher() {
  const [activeTab, setActiveTab] = useState<TabId>("home")

  return (
    <LaunchLogsProvider>
      <div className="flex h-full w-full overflow-hidden bg-background">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full p-4 overflow-hidden flex flex-col">
            {activeTab === "home" ? (
              <HomePage />
            ) : activeTab === "builds" ? (
              <InstancePage />
            ) : activeTab === "logs" ? (
              <LogsPage />
            ) : activeTab === "settings" ? (
              <SettingsPage />
            ) : activeTab === "accounts" ? (
              <AccountsPage />
            ) : activeTab === "mods" ? (
              <ModsPage />
            ) : activeTab === "friends" ? (
              <FriendsPage />
            ) : activeTab === "servers" ? (
              <ServersPage />
            ) : activeTab === "cloud" ? (
              <CloudPage />
            ) : null}
          </div>
        </main>

        <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-[radial-gradient(circle,oklch(0.65_0.22_40/0.08)_0%,transparent_70%)]" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-[radial-gradient(circle,oklch(0.6_0.25_80/0.08)_0%,transparent_70%)]" />
        </div>
      </div>
    </LaunchLogsProvider>
  )
}
