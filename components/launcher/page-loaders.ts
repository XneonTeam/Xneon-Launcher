import { createPageLoader } from "@/lib/page-loader"

export const serverDetailLoader = createPageLoader(() => import("./server-detail-page").then(m => ({ default: m.ServerDetailPage })))

export const pageLoaders = {
  builds: createPageLoader(() => import("./instance").then(m => ({ default: m.InstancePage }))),
  settings: createPageLoader(() => import("./settings").then(m => ({ default: m.SettingsPage }))),
  // Как у сборок: код карточки готов до появления доступного для клика списка.
  // Прогрев загружает только модули, без запросов данных и монтирования страницы.
  servers: createPageLoader(() => Promise.all([import("./servers-page"), serverDetailLoader()]).then(([m]) => ({ default: m.ServersPage }))),
  accounts: createPageLoader(() => import("./accounts-page").then(m => ({ default: m.AccountsPage }))),
  logs: createPageLoader(() => import("./logs-page").then(m => ({ default: m.LogsPage }))),
  stats: createPageLoader(() => import("./stats-page").then(m => ({ default: m.StatsPage }))),
  skins: createPageLoader(() => import("./skins-page").then(m => ({ default: m.SkinsPage }))),
  agent: createPageLoader(() => import("./agent/agent-page").then(m => ({ default: m.AgentPage }))),
  cloud: createPageLoader(() => import("./cloud").then(m => ({ default: m.CloudPage }))),
}

export function preloadPage(tab: string): Promise<unknown> {
  return Object.hasOwn(pageLoaders, tab) ? pageLoaders[tab as keyof typeof pageLoaders]().catch(() => {}) : Promise.resolve()
}

/** Только JS частых разделов, без монтирования, IPC и фоновых эффектов страниц. */
export function warmFrequentPages(): () => void {
  if (!window.requestIdleCallback) return () => {}
  const pages = ["builds", "settings", "servers"]
  let cancelled = false
  let idle = 0
  const next = () => {
    if (cancelled || pages.length === 0) return
    idle = window.requestIdleCallback(() => {
      if (!cancelled) void preloadPage(pages.shift()!).then(next)
    })
  }
  next()
  return () => { cancelled = true; window.cancelIdleCallback(idle) }
}
