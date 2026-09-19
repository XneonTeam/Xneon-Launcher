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
export type NewsEntry = import("@xnlc/types").MinecraftNewsEntry
export type MinecraftVersionOption = { version: string; stable: boolean; type: string }
export type VersionVisibility = { showSnapshot: boolean; showBeta: boolean; showAlpha: boolean }

export const MOD_LOADERS = [
  { id: "vanilla", name: "Vanilla", color: "bg-gray-500" },
  { id: "forge", name: "Forge", color: "bg-red-600" },
  { id: "fabric", name: "Fabric", color: "bg-yellow-600" },
  { id: "liteloader", name: "LiteLoader", color: "bg-cyan-500" },
  { id: "quilt", name: "Quilt", color: "bg-purple-500" },
  { id: "neoforge", name: "NeoForge", color: "bg-orange-500" },
  { id: "optifine", name: "OptiFine", color: "bg-green-500" },
  { id: "instance", name: "Instance", color: "bg-blue-500" },
] as const
export const NEWS_CARD_STYLE: CSSProperties = { contain: "layout paint" }
export const NEWS_SCROLL_STYLE: CSSProperties = { contain: "layout paint", overscrollBehavior: "contain" }
export const NEWS_GRID_GAP = 12
export const NEWS_CARD_TEXT_HEIGHT = 140
export const NEWS_GRID_OVERSCAN_ROWS = 3
export const LAUNCH_RE = /launching|starting|started|spawn|запуск/i

/**
 * Игра реально поднялась: окно создано, звук и атласы инициализированы.
 * Раньше тут было `/render|game|world|player/i` — слишком широко, из-за чего
 * лаунчер объявлял «игра запущена», когда процесс только-только стартовал.
 */
export const GAME_READY_RE = /Sound engine started|OpenAL initialized|Created: \d+x\d+x\d+ .*-atlas|Narrator library for .* successfully loaded/i

/**
 * Страховка на случай нестандартной сборки, которая не печатает маркеры выше:
 * через это время живой процесс всё равно считается запущенной игрой, иначе
 * кнопка навсегда осталась бы в состоянии «Запускается...».
 */
export const GAME_READY_FALLBACK_MS = 45_000
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
  // force-cache lets Chromium serve the manifest from its HTTP cache instead of
  // re-downloading it on every start when the IPC fallback path is used.
  const response = await fetch(MOJANG_VERSION_MANIFEST_URL, { cache: "force-cache" })
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

/** Переводчик из react-i18next: этапы запуска должны быть локализованы. */
export type StageTranslate = (key: string, options?: Record<string, unknown>) => string

/**
 * Фазы установки из main-процесса (`installationPhase`). Отдельная фаза
 * `removing-previous-loader` приходит, когда перед запуском удаляется профиль
 * прежнего загрузчика — иначе при смене версии пользователь видел только
 * «устанавливается загрузчик» и не понимал, куда делся старый.
 */
const INSTALLATION_PHASE_KEYS: Record<string, string> = {
  "downloading-vanilla": "launchStage.downloadingVanilla",
  "downloading-installer": "launchStage.downloadingInstaller",
  "extracting-installer": "launchStage.extractingInstaller",
  "removing-previous-loader": "launchStage.removingPreviousLoader",
  "installing-loader": "launchStage.installingLoader",
  "downloading-libraries": "launchStage.downloadingLibraries",
  "downloading-assets": "launchStage.downloadingAssets",
  "downloading-client": "launchStage.downloadingClient",
  "installing": "launchStage.installing",
}

/** Этапы обычной загрузки, которые приходят в `type` у прогресса. */
const STAGE_KEYS: Record<string, string> = {
  libraries: "launchStage.downloadingLibraries",
  assets: "launchStage.downloadingAssets",
  game: "launchStage.downloadingGame",
}

export function getStageLabel(stage: string | undefined, installationPhase: string | undefined, t: StageTranslate) {
  const key = installationPhase
    ? INSTALLATION_PHASE_KEYS[installationPhase]
    : stage
      ? STAGE_KEYS[stage]
      : undefined
  return t(key ?? "launchStage.preparing")
}
