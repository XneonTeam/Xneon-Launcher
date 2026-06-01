import type { CSSProperties } from "react"

export type AccountWithAvatar = { uuid?: string; type?: string }
export type LaunchPhase = "idle" | "installing" | "launching"
export type LaunchUiState = {
  isLaunching: boolean
  status: string
  progress: number | null
  phase: LaunchPhase
  downloadedBytes: number | null
  totalBytes: number | null
  currentFile: number | null
  totalFiles: number | null
  currentFileName: string | null
}
export type NewsEntry = {
  id: string
  title: string
  tag?: string
  category?: string
  date: string
  text?: string
  readMoreLink?: string
  playPageImage?: { url?: string }
  newsPageImage?: { url?: string }
  newsType?: string[]
}
export type MinecraftVersionOption = { version: string; stable: boolean; type: string }
export type VersionVisibility = { showSnapshot: boolean; showBeta: boolean; showAlpha: boolean }

export const MOD_LOADERS = [
  { id: "vanilla", name: "Vanilla", icon: "V", color: "bg-gray-500" },
  { id: "forge", name: "Forge", icon: "F", color: "bg-red-600" },
  { id: "fabric", name: "Fabric", icon: "Fb", color: "bg-yellow-600" },
  { id: "liteloader", name: "LiteLoader", icon: "L", color: "bg-cyan-500" },
  { id: "quilt", name: "Quilt", icon: "Q", color: "bg-purple-500" },
  { id: "neoforge", name: "NeoForge", icon: "Nf", color: "bg-orange-500" },
  { id: "optifine", name: "OptiFine", icon: "O", color: "bg-green-500" },
  { id: "instance", name: "Instance", icon: "I", color: "bg-blue-500" },
] as const
export const NEWS_CARD_STYLE: CSSProperties = { contain: "layout paint" }
export const NEWS_SCROLL_STYLE: CSSProperties = { contain: "layout paint", overscrollBehavior: "contain" }
export const NEWS_GRID_GAP = 12
export const NEWS_CARD_TEXT_HEIGHT = 140
export const NEWS_GRID_OVERSCAN_ROWS = 3
export const FALLBACK_RELEASE_VERSIONS = ["1.21.4", "1.21.1", "1.21", "1.20.4", "1.20.2", "1.19.4", "1.18.2", "1.16.5", "1.12.2"]
export const VERSIONS: string[] = FALLBACK_RELEASE_VERSIONS
export const LAUNCH_RE = /launching|starting|started|spawn|запуск/i
export const RUNNING_RE = /render|game|world|player/i
export const INITIAL_LAUNCH_UI_STATE: LaunchUiState = {
  isLaunching: false,
  status: "",
  progress: null,
  phase: "idle",
  downloadedBytes: null,
  totalBytes: null,
  currentFile: null,
  totalFiles: null,
  currentFileName: null,
}
export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  elyby: "Ely.By",
  xnskins: "XN Skins",
  xneon: "XN Skins",
  microsoft: "Microsoft",
  offline: "Offline",
}

type MojangManifestResponse = { versions?: Array<{ id: string; type: string }> }
const MOJANG_VERSION_MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"

export const getAvatarUrl = (account: AccountWithAvatar, username: string) => {
  const isElyBy = account.type === "elyby"
  const value = isElyBy ? username : (account.uuid || username)
  const params = new URLSearchParams()
  if (isElyBy) params.set("skin_type", "ely")
  else if (account.type === "xnskins") params.set("skin_type", "xneon")
  else if (account.type === "microsoft") params.set("skin_type", "microsoft")
  else if (account.type === "offline") return "https://mcskinapi-three.vercel.app/avatar/Steve?skin_type=microsoft"
  return params.has("skin_type")
    ? `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}?${params.toString()}`
    : `https://mcskinapi-three.vercel.app/avatar/${encodeURIComponent(value)}`
}

export function formatDate(raw: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(raw))
  } catch {
    return raw
  }
}

export async function fetchVersionsFromRenderer(): Promise<MinecraftVersionOption[]> {
  const response = await fetch(MOJANG_VERSION_MANIFEST_URL, { cache: "no-store" })
  if (!response.ok) throw new Error(`Failed to fetch Mojang manifest: ${response.status}`)
  const data = await response.json() as MojangManifestResponse
  return (data.versions ?? []).map((version) => ({
    version: version.id,
    stable: version.type === "release",
    type: version.type,
  }))
}

export function filterMinecraftVersions(
  versions: MinecraftVersionOption[],
  { showSnapshot, showBeta, showAlpha }: VersionVisibility
): string[] {
  return versions
    .filter((version) =>
      version.type === "release" ||
      (version.type === "snapshot" && showSnapshot) ||
      (version.type === "old_beta" && showBeta) ||
      (version.type === "old_alpha" && showAlpha)
    )
    .map((version) => version.version)
}

export function getStageLabel(stage?: string, installationPhase?: string) {
  if (installationPhase) {
    switch (installationPhase) {
      case "downloading-vanilla": return "Скачивается Minecraft..."
      case "downloading-installer": return "Скачивается установщик..."
      case "extracting-installer": return "Распаковывается установщик..."
      case "installing-loader": return "Устанавливается мод-лоадер..."
      case "downloading-libraries": return "Скачиваются библиотеки..."
      case "downloading-assets": return "Скачиваются ресурсы..."
      case "downloading-client": return "Скачивается клиент игры..."
      case "installing": return "Установка..."
      default: return "Подготовка запуска..."
    }
  }
  switch (stage) {
    case "libraries": return "Скачиваются библиотеки..."
    case "assets": return "Скачиваются ресурсы..."
    case "game": return "Скачиваются файлы игры..."
    default: return "Подготовка запуска..."
  }
}
