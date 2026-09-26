// ============================================================
// @xnlc/types — IPC Contracts
// Single source of truth for all IPC channel signatures
// ============================================================

import type {
  DbAccount,
  DbBuild,
  DbBuildLight,
  DbBuildMod,
  WorldInfo,
  DatapackInfo,
  ScreenshotInfo,
  AuthPayload,
  AuthSession,
  DeviceCodeStart,
  DeviceCodePoll,
  MinecraftNewsEntry,
  MinecraftVersionInfo,
  ImportableLauncherInstance,

  BuildExportCategory,
  CloudUploadCategory,

  JavaDetectResult,
  BuildIntentScanResult,
  ModpackImportResult,
  ImportProgress,
  ContentDownloadProgress,
  CleanupFn,
  McProfile,
  LibrarySkin,
  QuickPlayEntry,
  UpdateChannel,
  BuildContentUpdates,
  StatsOverview,
  StatsRange,
  StorageScanResult,
  StorageCleanTarget,
  StorageCleanResult,
} from "./domain-types.js"

import type {
  LabyCatalogPage,
  LabyImportResult,
  LabyOrder,
  LabyPlayer,
  LabySkin,
  LabyTag,
} from "./laby.js"

import type {
  ModContentType,
  ModSort,
  ModLoaderFilter,
  ModEnvironment,
  ModSearchResponse,
  ModDetails,
  ModVersion,
  ModDependency,
  JarDependencyInspection,
  ContentFileMetadata,
  ContentDropKind,
  ContentDropClassification,
  ModSearchResult,
  FTBVersionManifest,
} from "./mod-types.js"

import type {
  MinecraftLaunchParams,
  MinecraftProgress,
  MinecraftCloseInfo,
  JavaProgress,
} from "./launch-types.js"

import type {
  XnConnectState,
  XnConnectUsage,
  McFsEntry,
  ResolvedPlugin,
  McServerInfo,
  McServerState,
  McServerMetrics,
  McPlayerEntry,
  McServerDownloadProgress,
} from "./server-types.js"
import type { ServerStatusResult } from "@xnlc/servers"

// ── IPC Invoke Channel Map ──────────────────────────────────
// Maps channel name → { args: tuple of arguments, return: return type }

export interface IpcInvokeMap {
  // ── Window ──
  "window:is-maximized": { args: []; return: boolean }

  // ── Auth ──
  "auth:elyby-login": { args: []; return: AuthPayload }
  "auth:elyby-device-start": { args: []; return: DeviceCodeStart }
  "auth:elyby-device-poll": { args: [deviceCode: string]; return: DeviceCodePoll }
  "auth:xnskins-login": { args: []; return: AuthPayload }
  "auth:xnskins-device-start": { args: []; return: DeviceCodeStart }
  "auth:xnskins-device-poll": { args: [deviceCode: string]; return: DeviceCodePoll }
  "auth:microsoft-login": { args: []; return: AuthPayload }
  "auth:microsoft-device-start": { args: []; return: DeviceCodeStart }
  "auth:microsoft-device-poll": { args: [deviceCode: string]; return: DeviceCodePoll }

  // ── Fetch ──
  "fetch:minecraft-news": { args: []; return: MinecraftNewsEntry[] }

  // ── Database ──
  "db:load-accounts": { args: []; return: DbAccount[] }
  "db:save-account": { args: [account: DbAccount]; return: void }
  "db:remove-account": { args: [id: string]; return: void }
  "db:load-builds-light": { args: []; return: DbBuildLight[] }
  "db:load-build-content": { args: [buildId: string]; return: { mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; installedMods: Record<string, string> } | null }
  "build:fetch-missing-mods": { args: [buildName: string]; return: { success: boolean; downloaded?: number; failed?: number; missing?: number; error?: string } }
  "db:save-builds": { args: [builds: DbBuild[]]; return: void }
  "db:insert-build": { args: [build: DbBuild]; return: void }
  "db:update-build-fields": { args: [buildId: string, fields: Partial<DbBuild>]; return: void }
  "db:is-fallback-storage": { args: []; return: { isFallback: boolean } }
  "db:reorder-accounts": { args: [ids: string[]]; return: void }

  // ── Build / Intent ──
  "build:scan-intent-content": { args: [buildName: string]; return: BuildIntentScanResult }
  "build:get-intent-path": { args: [buildId: string]; return: string }
  "build:get-instances-root": { args: []; return: string }
  "common:pick-folder": { args: [title?: string]; return: string | null }
  "build:set-instances-root": { args: [newRoot: string]; return: { success: boolean; root?: string; error?: string } }
  "build:save-mod-to-intent": { args: [buildId: string, url: string, fileName: string]; return: string | null }
  "build:save-local-mod-to-intent": { args: [buildId: string, localFilePath: string]; return: string | null }
  "build:read-local-content-metadata": { args: [localFilePath: string]; return: ContentFileMetadata | null }
  "build:classify-drop-paths": { args: [paths: string[], kind: ContentDropKind]; return: ContentDropClassification }
  "build:save-content-to-intent": { args: [buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string]; return: string | null }
  "build:save-local-content-to-intent": { args: [buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string]; return: string | null }
  "build:delete-content-from-intent": { args: [buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string]; return: { success: boolean; error?: string } }
  "build:set-content-enabled": { args: [buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string, enabled: boolean]; return: { success: boolean; fileName?: string; error?: string } }
  "build:set-intent-path": { args: [buildId: string, intentPath: string]; return: void }
  "build:prune-loader-profiles": { args: [buildName: string, modLoader?: string, loaderVersion?: string]; return: { removed: string[]; kept: string[] } }
  "build:delete-intent": { args: [buildName: string]; return: { success: boolean; error?: string } }
  "build:import-modrinth": { args: [buildName: string, projectSlug: string, versionId?: string, targetBuildId?: string]; return: ModpackImportResult }
  "build:import-curseforge": { args: [buildName: string, modId: number, fileId: number, targetBuildId?: string]; return: ModpackImportResult }
  "build:import-ftb": { args: [buildName: string, modpackId: number, versionId: number, targetBuildId?: string]; return: ModpackImportResult }
  "build:open-and-import": { args: [nameOverride?: string]; return: ModpackImportResult & { name?: string; description?: string; icon?: string; source?: "modrinth" | "curseforge"; intentPath?: string } }
  "build:cancel-import": { args: []; return: { success: boolean } }
  "build:copy": { args: [buildName: string, newName: string]; return: { success: boolean; intentPath?: string; error?: string } }
  "build:rename-intent": { args: [oldName: string, newName: string]; return: { success: boolean; intentPath?: string; error?: string } }
  "build:export-zip": { args: [buildName: string, buildNameLabel: string, categories?: BuildExportCategory[]]; return: { success: boolean; path?: string; error?: string } }
  "build:export-modlist": { args: [buildName: string, buildNameLabel: string, format: "html" | "markdown" | "json" | "csv" | "plaintext"]; return: { success: boolean; path?: string; error?: string } }
  "build:move-intent-to-trash": { args: [dirName: string]; return: { success: boolean; trashName?: string; error?: string } }
  "build:restore-intent-from-trash": { args: [dirName: string, trashName: string]; return: { success: boolean; error?: string } }
  "build:purge-trash": { args: []; return: { success: boolean; error?: string } }
  "build:list-trash": { args: []; return: Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }> }
  "build:delete-trash-item": { args: [trashName: string]; return: { success: boolean; error?: string } }

  // ── Content Updates ──
  "build:check-content-updates": { args: [buildId: string, channel?: UpdateChannel]; return: BuildContentUpdates }
  "build:get-content-updates-cache": { args: []; return: Record<string, BuildContentUpdates> }
  "build:get-content-updates-counts": { args: []; return: Record<string, { mods: number; resourcepacks: number; shaders: number }> }
  "build:dismiss-content-update": { args: [buildId: string, itemId: string]; return: void }

  // ── Game Statistics ──
  "stats:overview": { args: [range?: StatsRange]; return: StatsOverview }

  // ── Storage / Disk Manager ──
  "storage:scan": { args: []; return: StorageScanResult }
  "storage:clean": { args: [target: StorageCleanTarget]; return: StorageCleanResult }

  // ── AI ──
  "ai:get-config": { args: []; return: { apiKey: string; endpoint: string; model: string } }
  "ai:save-config": { args: [config: { apiKey: string; endpoint: string; model: string }]; return: void }
  "ai:list-models": { args: [override?: { apiKey?: string; endpoint?: string }]; return: { success: boolean; models?: string[]; error?: string } }
  "ai:analyze-crash": { args: [logContent: string, sessionId?: string]; return: { success: boolean; analysis?: string; error?: string } }
  "ai:analyze-crash-stream": { args: [requestId: string, logContent: string]; return: { success: boolean; analysis?: string; error?: string } }
  "ai:chat-send": { args: [sessionId: string, userMessage: string]; return: { success: boolean; analysis?: string; error?: string } }
  "ai:chat-send-stream": { args: [requestId: string, sessionId: string, userMessage: string]; return: { success: boolean; analysis?: string; error?: string } }
  "ai:sessions-list": { args: []; return: Array<{ id: string; title: string; createdAt: number; updatedAt: number }> }
  "ai:sessions-create": { args: [id: string, title: string]; return: void }
  "ai:sessions-rename": { args: [id: string, title: string]; return: void }
  "ai:sessions-delete": { args: [id: string]; return: void }
  "ai:messages-list": { args: [sessionId: string]; return: Array<{ id: string; role: string; content: string; createdAt: number }> }

  // ── Launcher Import ──
  "launcher:discover-importable-instances": { args: []; return: ImportableLauncherInstance[] }
  "launcher:discover-from-path": { args: [source: string, customPath: string]; return: ImportableLauncherInstance[] }
  "launcher:import-gdlauncher-instances": { args: [ids: string[]]; return: { success: boolean; imported: number; error?: string } }
  "launcher:import-instances": { args: [ids: string[]]; return: { success: boolean; imported: number; error?: string } }

  // ── Mods (Modrinth) ──
  "mods:modrinth-search": { args: [query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, categories?: string[]]; return: ModSearchResponse }
  "mods:modrinth-details": { args: [slug: string]; return: ModDetails | null }
  "mods:modrinth-versions": { args: [slug: string]; return: ModVersion[] }
  "mods:modrinth-check-updates": { args: [hashes: string[], loaders?: string[], gameVersions?: string[]]; return: Record<string, ModVersion> }

  // ── Mods (CurseForge) ──
  "mods:curseforge-search": { args: [query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, categories?: string[]]; return: ModSearchResponse }
  "mods:curseforge-details": { args: [modId: number]; return: ModDetails | null }
  "mods:curseforge-download-url": { args: [fileId: number, modId: number]; return: string | null }
  "mods:curseforge-featured": { args: [gameVersion?: string]; return: { popular: ModSearchResult[]; trending: ModSearchResult[] } }
  "mods:curseforge-changelog": { args: [modId: number, fileId: number]; return: string }
  "mods:curseforge-description": { args: [modId: number]; return: string }
  "mods:resolve-dependencies": { args: [version: ModVersion, source: "modrinth" | "curseforge"]; return: ModDependency[] }
  "mods:inspect-jar-dependencies": { args: [url: string, source: "modrinth" | "curseforge"]; return: JarDependencyInspection }
  "mods:check-loader-requirements": { args: [buildName: string, modLoader?: string, loaderVersion?: string]; return: { loaderId: string; loaderVersion?: string; checked: number; issues: Array<{ fileName: string; modName?: string; modId?: string; loaderId: string; requirement: string; buildLoaderVersion?: string; satisfied: boolean; reason?: string }> } }
  // ── Mods (FTB / Feed The Beast) ──
  "mods:ftb-search": { args: [query: string, page?: number, options?: { sortBy?: ModSort; categories?: string[]; gameVersion?: string; loader?: string }]; return: ModSearchResponse }
  "mods:ftb-catalog-facets": { args: []; return: { categories: string[]; gameVersions: string[]; loaders: string[] } }
  "mods:ftb-details": { args: [id: number]; return: ModDetails | null }
  "mods:ftb-version": { args: [id: number, versionId: number]; return: FTBVersionManifest | null }
  "mods:ftb-changelog": { args: [id: number, versionId: number]; return: string }

  // ── Mods (Categories & Tags) ──
  "mods:modrinth-categories": { args: []; return: any[] }
  "mods:curseforge-categories": { args: []; return: (import("./mod-types.js").ModCategory)[] }
  "mods:modrinth-loaders": { args: []; return: string[] }
  "mods:modrinth-game-versions": { args: []; return: string[] }

  // ── Minecraft ──
  "minecraft:get-versions": { args: []; return: MinecraftVersionInfo[] }
  "minecraft:get-latest-release": { args: []; return: string | null }
  "minecraft:get-latest-snapshot": { args: []; return: string | null }
  "minecraft:get-fabric-game-versions": { args: []; return: { version: string; stable: boolean }[] }
  "minecraft:get-fabric-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-fabric-supported": { args: []; return: string[] }
  "minecraft:get-liteloader-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-liteloader-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-liteloader-supported": { args: []; return: string[] }
  "minecraft:get-quilt-game-versions": { args: []; return: { version: string; stable: boolean }[] }
  "minecraft:get-quilt-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-quilt-supported": { args: []; return: string[] }
  "minecraft:get-optifine-versions": { args: [mcVersion: string]; return: { filename: string; isPreview: boolean }[] }
  "minecraft:get-optifine-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-optifine-supported": { args: []; return: string[] }
  "minecraft:get-neoforge-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-neoforge-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-neoforge-supported": { args: []; return: string[] }
  "minecraft:get-forge-versions": { args: [mcVersion: string]; return: { version: string; stable: boolean }[] }
  "minecraft:get-forge-recommended": { args: [mcVersion: string]; return: string | null }
  "minecraft:get-forge-supported": { args: []; return: string[] }
  "minecraft:get-custom-versions": { args: []; return: string[] }
  "minecraft:get-paper-versions": { args: [mcVersion: string]; return: { value: string; label: string; stable?: boolean; recommended?: boolean }[] }
  "minecraft:get-paper-supported": { args: []; return: string[] }
  "minecraft:get-purpur-versions": { args: [mcVersion: string]; return: { value: string; label: string; stable?: boolean; recommended?: boolean }[] }
  "minecraft:get-purpur-supported": { args: []; return: string[] }
  "minecraft:get-folia-versions": { args: [mcVersion: string]; return: { value: string; label: string; stable?: boolean; recommended?: boolean }[] }
  "minecraft:get-folia-supported": { args: []; return: string[] }
  "minecraft:get-velocity-versions": { args: [velocityVersion: string]; return: { value: string; label: string; stable?: boolean; recommended?: boolean }[] }
  "minecraft:get-velocity-supported": { args: []; return: string[] }
  "minecraft:get-waterfall-versions": { args: [mcVersion: string]; return: { value: string; label: string; stable?: boolean; recommended?: boolean }[] }
  "minecraft:get-waterfall-supported": { args: []; return: string[] }
  "minecraft:get-sponge-versions": { args: [spongeType: string, mcVersion: string]; return: { value: string; label: string; stable?: boolean; recommended?: boolean }[] }
  "minecraft:get-sponge-supported": { args: [spongeType?: string]; return: string[] }
  "minecraft:set-offline-auth": { args: [username: string]; return: AuthSession | null }
  "minecraft:get-game-dir": { args: []; return: string }
  "minecraft:get-auth": { args: []; return: AuthSession | null }
  "minecraft:launch": { args: [params: MinecraftLaunchParams]; return: { success: boolean; error?: string } }
  "minecraft:stop": { args: []; return: void }
  "minecraft:is-running": { args: []; return: boolean }

  // ── Settings ──
  "settings:get": { args: [key: string]; return: string | undefined }
  "settings:set": { args: [key: string, value: string]; return: void }

  // ── Content ──
  "content:install-remote": { args: [contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string]; return: { success: boolean; filePath?: string; error?: string } }

  // ── Worlds ──
  "worlds:list": { args: [buildName: string]; return: WorldInfo[] }
  "worlds:rename": { args: [buildName: string, folder: string, newName: string]; return: { success: boolean; error?: string } }
  "worlds:delete": { args: [buildName: string, folder: string]; return: { success: boolean; error?: string } }
  "worlds:set-icon": { args: [buildName: string, folder: string, dataUrl: string]; return: { success: boolean; error?: string } }
  "worlds:list-datapacks": { args: [buildName: string, folder: string]; return: DatapackInfo[] }
  "worlds:install-datapack-remote": { args: [buildName: string, folder: string, url: string, fileName: string]; return: { success: boolean; path?: string; error?: string } }
  "worlds:install-datapack-local": { args: [buildName: string, folder: string, localFilePath: string]; return: { success: boolean; path?: string; error?: string } }
  "worlds:delete-datapack": { args: [buildName: string, folder: string, fileName: string]; return: { success: boolean; error?: string } }
  "worlds:import-zip": { args: [buildName: string, localFilePath: string, newName?: string]; return: { success: boolean; folder?: string; error?: string } }
  "worlds:import-remote": { args: [buildName: string, url: string, preferredName?: string]; return: { success: boolean; folder?: string; error?: string } }
  "worlds:copy": { args: [buildName: string, folder: string, newName: string]; return: { success: boolean; folder?: string; error?: string } }
  "worlds:reset-icon": { args: [buildName: string, folder: string]; return: { success: boolean; error?: string } }

  // ── Screenshots ──
  "screenshots:list": { args: [buildName: string]; return: ScreenshotInfo[] }
  "screenshots:get": { args: [buildName: string, fileName: string]; return: string | null }
  "screenshots:delete": { args: [buildName: string, fileName: string]; return: { success: boolean; error?: string } }
  "screenshots:rename": { args: [buildName: string, fileName: string, newName: string]; return: { success: boolean; error?: string } }

  // ── Shell ──
  "shell:open-external": { args: [url: string]; return: void }
  "shell:open-launcher-folder": { args: []; return: void }
  "shell:open-path": { args: [dirPath: string]; return: void }

  // ── Servers ──
  "servers:list": { args: [buildName: string]; return: Array<{ name: string; ip: string }> }
  "servers:write-dat": { args: [buildName: string, servers: Array<{ name: string; ip: string }>]; return: { success: boolean; error?: string } }
  "servers:ping": { args: [address: string]; return: ServerStatusResult }

  // ── Quick Play ──
  "quickplay:list": { args: [buildName?: string, gameDir?: string]; return: QuickPlayEntry[] }
  "quickplay:clear": { args: [buildName?: string, gameDir?: string]; return: void }
  "quickplay:remove": { args: [buildName: string | undefined, gameDir: string | undefined, entry: QuickPlayEntry]; return: void }

  // ── Updater ──
  "update:check": { args: []; return: { available: boolean; version?: string; error?: string } }
  "update:download": { args: []; return: { success: boolean; error?: string } }
  "update:install": { args: []; return: void }
  "update:info": { args: []; return: { version: string | null; downloaded: boolean } }

  // ── Misc (без доменного префикса — историческое имя канала) ──
  "read-local-file": { args: [filePath: string]; return: string | null }

  // ── Logs ──
  "logs:share-to-mclogs": { args: [content: string]; return: { success: boolean; url?: string; error?: string } }

  // ── Skins ──
  // `skins:*` — «Избранное», локальные скины и активный скин аккаунта;
  // `laby:*` — каталог Laby. Оба набора обслуживает `@xnlc/skins`.
  "skins:get-profile": { args: [accountId?: string]; return: McProfile | null }
  "skins:delete-skin": { args: [accountId?: string]; return: boolean }
  "skins:set-cape": { args: [params: { capeId: string | null; accountId?: string }]; return: boolean }
  "skins:list-library": { args: [accountId: string]; return: LibrarySkin[] }
  "skins:save-to-library": { args: [params: { filePath: string; name: string; variant: "classic" | "slim"; accountId: string; capeId?: string | null }]; return: LibrarySkin | null }
  "skins:delete-from-library": { args: [id: string]; return: boolean }
  "skins:update-variant": { args: [params: { id: string; variant: "classic" | "slim"; capeId?: string | null; name?: string }]; return: boolean }
  "skins:apply-library-skin": { args: [params: { skinId: string; accountId: string }]; return: boolean }

  // ── Laby (открытый каталог скинов, https://laby.net) ──
  // Метаданные тянет main: API v3 не отдаёт CORS-заголовки. Текстуры и
  // рендеры, наоборот, доступны рендереру напрямую с CDN.
  "laby:catalog": { args: [params: { page: number; size?: number; order?: LabyOrder; tags?: string[] | null; query?: string | null }]; return: LabyCatalogPage }
  "laby:tags": { args: [locale?: string]; return: LabyTag[] }
  "laby:similar": { args: [params: { hash: string; tags: string[]; slim: boolean }]; return: LabySkin[] }
  // Поиск игрока: по точному нику (`uniqueId` → `textures`). Частичный поиск
  // Laby закрыл проверкой 428, поэтому подсказок при вводе нет.
  "laby:player": { args: [username: string]; return: LabyPlayer | null }
  "laby:save-to-library": { args: [params: { hash: string; accountId: string; name?: string; slim?: boolean }]; return: LabyImportResult }
  "laby:apply": { args: [params: { hash: string; accountId: string; name?: string; slim?: boolean }]; return: LabyImportResult }

  // ── Java ──
  "java:detect": { args: [force?: boolean]; return: JavaDetectResult[] }
  "java:pick-file": { args: []; return: string | null }

  // ── Cloud (third-party providers) ──
  "cloud:list-providers": { args: []; return: Array<{ id: string; name: string }> }
  "cloud:connect": { args: [providerId: string, authData?: Record<string, string>]; return: { success: boolean; provider?: string; error?: string } }
  "cloud:is-connected": { args: [providerId: string]; return: boolean }
  "cloud:disconnect": { args: [providerId: string]; return: { success: boolean; error?: string } }
  "cloud:list-files": { args: [providerId: string, folderPath?: string]; return: { success: boolean; files?: Array<{ id: string; name: string; size: number; modifiedAt?: string; path: string; isDir: boolean; category?: string }>; error?: string } }
  "cloud:upload-file": { args: [providerId: string, localPath: string, remotePath: string]; return: { success: boolean; id?: string; name?: string; error?: string } }
  "cloud:download-file": { args: [providerId: string, remotePath: string, localPath: string]; return: { success: boolean; localPath?: string; error?: string } }
  "cloud:delete-file": { args: [providerId: string, remotePath: string]; return: { success: boolean; error?: string } }
  "cloud:get-quota": { args: [providerId: string]; return: { used: number; total: number } | null }
  "cloud:upload-build": { args: [providerId: string, buildName: string, uploadId?: string, categories?: CloudUploadCategory[]]; return: { success: boolean; id?: string; name?: string; error?: string } }
  "cloud:upload-server": { args: [providerId: string, serverId: string, serverName: string, uploadId?: string, categories?: CloudUploadCategory[]]; return: { success: boolean; id?: string; name?: string; error?: string } }
  "cloud:upload-account": { args: [providerId: string, account: { id: string; type: string; username: string; uuid?: string }]; return: { success: boolean; id?: string; name?: string; error?: string } }
  "cloud:download-and-import": { args: [providerId: string, remotePath: string, fileType: string, selectedCategories?: CloudUploadCategory[]]; return: { success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } } }

  // ── XN-Connect Relay ──
  "xn-connect:authorize": { args: []; return: boolean }
  "xn-connect:start": { args: [serverId: string]; return: XnConnectState }
  "xn-connect:stop": { args: [serverId: string]; return: void }
  "xn-connect:status": { args: [serverId: string]; return: XnConnectState }
  "xn-connect:usage": { args: []; return: XnConnectUsage | null }

  // ── MC Server (управление) ──
  "mc-server:list": { args: []; return: McServerInfo[] }
  "mc-server:get": { args: [id: string]; return: McServerInfo | null }
  "mc-server:create": { args: [data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string }]; return: McServerInfo }
  "mc-server:analyze-jar": { args: [jarPath: string]; return: { minecraftVersion: string | null; loaderId: string | null; loaderLabel: string | null; modId: string | null; mainClass: string | null; error?: string } }
  "mc-server:update": { args: [id: string, update: Record<string, unknown>]; return: void }
  "mc-server:delete": { args: [id: string]; return: void }
  "mc-server:restore": { args: [id: string]; return: void }
  "mc-server:list-trash": { args: []; return: McServerInfo[] }
  "mc-server:purge-trash": { args: [deleteTunnel?: boolean]; return: void }
  "mc-server:permanent-delete": { args: [id: string, deleteTunnel?: boolean]; return: void }
  "mc-server:export-zip": { args: [id: string, serverName: string, categories?: string[]]; return: { success: boolean; path?: string; error?: string } }
  "mc-server:duplicate": { args: [id: string]; return: McServerInfo | null }
  "mc-server:start": { args: [id: string]; return: void }
  "mc-server:stop": { args: [id: string]; return: void }
  "mc-server:kill": { args: [id: string]; return: void }
  "mc-server:send-command": { args: [id: string, command: string]; return: void }
  "mc-server:status": { args: [id: string]; return: McServerState }
  "mc-server:metrics": { args: [id: string]; return: McServerMetrics }
  "mc-server:metrics-subscribe": { args: [id: string]; return: void }
  "mc-server:metrics-unsubscribe": { args: [id: string]; return: void }
  "mc-server:logs": { args: [id: string]; return: string[] }
  "mc-server:open-folder": { args: [id: string]; return: void }
  "mc-server:read-properties": { args: [id: string]; return: Record<string, string> | null }
  "mc-server:write-properties": { args: [id: string, properties: Record<string, string>]; return: void }
  "mc-server:get-whitelist": { args: [id: string]; return: McPlayerEntry[] }
  "mc-server:add-whitelist": { args: [id: string, username: string]; return: void }
  "mc-server:remove-whitelist": { args: [id: string, uuid: string]; return: void }
  "mc-server:get-ops": { args: [id: string]; return: McPlayerEntry[] }
  "mc-server:add-op": { args: [id: string, username: string]; return: void }
  "mc-server:remove-op": { args: [id: string, uuid: string]; return: void }
  "mc-server:get-banned": { args: [id: string]; return: McPlayerEntry[] }
  "mc-server:ban-player": { args: [id: string, username: string]; return: void }
  "mc-server:unban-player": { args: [id: string, uuid: string]; return: void }
  "mc-server:get-banned-ips": { args: [id: string]; return: McPlayerEntry[] }
  "mc-server:ban-ip": { args: [id: string, ip: string]; return: void }
  "mc-server:unban-ip": { args: [id: string, ip: string]; return: void }
  "mc-server:get-addresses": { args: [id: string]; return: { local: string; public: string | null; custom: string } | null }
  "mc-server:check-eula": { args: [id: string]; return: boolean }
  "mc-server:accept-eula": { args: [id: string]; return: void }

  // ── Server Files ──
  "mc-server:fs-list": { args: [id: string, relativePath: string]; return: McFsEntry[] }
  "mc-server:fs-read": { args: [id: string, relativePath: string]; return: string | null }
  "mc-server:fs-write": { args: [id: string, relativePath: string, content: string]; return: void }
  "mc-server:fs-delete": { args: [id: string, relativePath: string]; return: void }
  "mc-server:fs-rename": { args: [id: string, oldPath: string, newPath: string]; return: void }
  "mc-server:fs-mkdir": { args: [id: string, relativePath: string]; return: void }
  "mc-server:fs-stat": { args: [id: string, relativePath: string]; return: McFsEntry | null }
  "mc-server:fs-download": { args: [id: string, relativePath: string, url: string, fileName: string]; return: { success: boolean; filePath?: string; error?: string } }
  "mc-server:resolve-installed": { args: [id: string, relativePath: string]; return: ResolvedPlugin[] }
  "mc-server:install-pack": {
    args: [params: { source: "modrinth" | "curseforge"; projectSlug?: string; versionId?: string; modId?: number; fileId?: number; name?: string; icon?: string; port?: number; xmx?: number; xms?: number; extraJavaArgs?: string; javaPath?: string; relayEnabled?: boolean; onlineMode?: boolean; maxPlayers?: number }]
    return: McServerInfo
  }
}

// ── IPC Event Channel Map ───────────────────────────────────
// Maps channel name → payload type (for subscribe/on listeners)

export interface IpcEventMap {
  "minecraft:progress": MinecraftProgress
  "minecraft:java-progress": JavaProgress
  "minecraft:debug": string
  "minecraft:data": string
  "minecraft:download-progress": MinecraftProgress
  "minecraft:close": MinecraftCloseInfo
  "auth:progress": string
  "import:progress": ImportProgress
  "build:export-progress": { current: number; total: number }
  "content:download-progress": ContentDownloadProgress
  "cloud:upload-progress": { id: string; percent: number; stage: "zip" | "upload" }
  "mc-server:download-progress": McServerDownloadProgress
  "mc-server:log": { id: string; line: string }
  "mc-server:state-change": { id: string; state: McServerState }
  "xn-connect:usage-updated": XnConnectUsage
  "xn-connect:state": { serverId: string; state: XnConnectState }
  "xn-connect:log": { serverId: string; line: string }
  "xn-connect:auth-state": { state: XnConnectState }
  "ai:stream-chunk": { requestId: string; content: string }
  "ai:stream-done": { requestId: string; fullText: string }
  "ai:stream-error": { requestId: string; error: string }
  "update:status": { status: string; version?: string; releaseDate?: string; releaseNotes?: string; error?: string }
  "update:progress": { percent: number; transferred: number; total: number }
  "cli:launch-build": string
  "stats:updated": {}
}

// ── Explicit ElectronAPI ────────────────────────────────────
// The IpcInvokeMap above serves as the canonical channel registry.
// The ElectronAPIExplicit below is derived from it and used by preload.ts and electron.d.ts.

export interface ElectronAPIExplicit {
  minimize: () => void
  maximize: () => void
  close: () => void
  restore: () => void
  isMaximized: () => Promise<boolean>
  loginElyBy: () => Promise<AuthPayload>
  loginXnSkins: () => Promise<AuthPayload>
  loginMicrosoft: () => Promise<AuthPayload>
  startXnSkinsDeviceCode: () => Promise<DeviceCodeStart>
  pollXnSkinsDeviceCode: (deviceCode: string) => Promise<DeviceCodePoll>
  startElyByDeviceCode: () => Promise<DeviceCodeStart>
  pollElyByDeviceCode: (deviceCode: string) => Promise<DeviceCodePoll>
  startMicrosoftDeviceCode: () => Promise<DeviceCodeStart>
  pollMicrosoftDeviceCode: (deviceCode: string) => Promise<DeviceCodePoll>
  fetchMinecraftNews: () => Promise<MinecraftNewsEntry[]>
  loadAccounts: () => Promise<DbAccount[]>
  saveAccount: (account: DbAccount) => Promise<void>
  removeAccount: (id: string) => Promise<void>
  loadBuildsLight: () => Promise<DbBuildLight[]>
  loadBuildContent: (buildId: string) => Promise<{ mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; installedMods: Record<string, string> } | null>
  fetchMissingBuildMods: (buildName: string) => Promise<{ success: boolean; downloaded?: number; failed?: number; missing?: number; error?: string }>
  saveBuilds: (builds: DbBuild[]) => Promise<void>
  insertBuild: (build: DbBuild) => Promise<void>
  updateBuildFields: (buildId: string, fields: Partial<DbBuild>) => Promise<void>
  dbIsFallbackStorage: () => Promise<{ isFallback: boolean }>
  reorderAccounts: (ids: string[]) => Promise<void>
  scanBuildIntentContent: (buildName: string) => Promise<BuildIntentScanResult>
  discoverImportableInstances: () => Promise<ImportableLauncherInstance[]>
  discoverFromPath: (source: string, customPath: string) => Promise<ImportableLauncherInstance[]>
  importGdLauncherInstances: (ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>
  importLauncherInstances: (ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>
  modsModrinthSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, categories?: string[], environment?: ModEnvironment) => Promise<ModSearchResponse>
  modsModrinthDetails: (slug: string) => Promise<ModDetails | null>
  modsModrinthVersions: (slug: string) => Promise<ModVersion[]>
  modsCurseforgeSearch: (query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, categories?: string[], environment?: ModEnvironment) => Promise<ModSearchResponse>
  modsCurseforgeDetails: (modId: number) => Promise<ModDetails | null>
  modsCurseforgeDownloadUrl: (fileId: number, modId: number) => Promise<string | null>
  modsCurseforgeFeatured: (gameVersion?: string) => Promise<{ popular: ModSearchResult[]; trending: ModSearchResult[] }>
  modsResolveDependencies: (version: ModVersion, source: "modrinth" | "curseforge") => Promise<ModDependency[]>
  modsInspectJarDependencies: (url: string, source: "modrinth" | "curseforge") => Promise<JarDependencyInspection>
  modsFtbSearch: (query: string, page?: number, options?: { sortBy?: ModSort; categories?: string[]; gameVersion?: string; loader?: string }) => Promise<ModSearchResponse>
  modsFtbCatalogFacets: () => Promise<{ categories: string[]; gameVersions: string[]; loaders: string[] }>
  modsFtbDetails: (id: number) => Promise<ModDetails | null>
  modsFtbVersion: (id: number, versionId: number) => Promise<FTBVersionManifest | null>
  modsFtbChangelog: (id: number, versionId: number) => Promise<string>
  modsModrinthCategories: () => Promise<any[]>
  modsCurseforgeCategories: () => Promise<any[]>
  modsModrinthLoaders: () => Promise<string[]>
  modsModrinthGameVersions: () => Promise<string[]>
  getMinecraftVersions: () => Promise<MinecraftVersionInfo[]>
  getLatestRelease: () => Promise<string | null>
  getLatestSnapshot: () => Promise<string | null>
  getFabricGameVersions: () => Promise<{ version: string; stable: boolean }[]>
  getFabricVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getFabricSupported: () => Promise<string[]>
  getLiteLoaderVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getLiteLoaderRecommended: (mcVersion: string) => Promise<string | null>
  getLiteLoaderSupported: () => Promise<string[]>
  getQuiltGameVersions: () => Promise<{ version: string; stable: boolean }[]>
  getQuiltVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getQuiltSupported: () => Promise<string[]>
  getOptifineVersions: (mcVersion: string) => Promise<{ filename: string; isPreview: boolean }[]>
  getOptifineRecommended: (mcVersion: string) => Promise<string | null>
  getOptifineSupported: () => Promise<string[]>
  getNeoForgeVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getNeoForgeRecommended: (mcVersion: string) => Promise<string | null>
  getNeoForgeSupported: () => Promise<string[]>
  getForgeVersions: (mcVersion: string) => Promise<{ version: string; stable: boolean }[]>
  getForgeRecommended: (mcVersion: string) => Promise<string | null>
  getForgeSupported: () => Promise<string[]>
  getCustomVersions: () => Promise<string[]>
  setOfflineAuth: (username: string) => Promise<AuthSession | null>
  getGameDir: () => Promise<string>
  getAuth: () => Promise<AuthSession | null>
  launchMinecraft: (params: MinecraftLaunchParams) => Promise<{ success: boolean; error?: string }>
  stopMinecraft: () => Promise<void>
  isMinecraftRunning: () => Promise<boolean>
  onMinecraftProgress: (callback: (progress: MinecraftProgress) => void) => CleanupFn
  onMinecraftJavaProgress: (callback: (progress: JavaProgress) => void) => CleanupFn
  onMinecraftDebug: (callback: (message: string) => void) => CleanupFn
  onMinecraftData: (callback: (message: string) => void) => CleanupFn
  onMinecraftDownloadStatus: (callback: (progress: MinecraftProgress) => void) => CleanupFn
  onMinecraftClose: (callback: (info: MinecraftCloseInfo) => void) => CleanupFn
  onAuthProgress: (callback: (msg: string) => void) => CleanupFn
  onCliLaunchBuild: (callback: (buildName: string) => void) => CleanupFn
  getSetting: (key: string) => Promise<string | undefined>
  setSetting: (key: string, value: string) => Promise<void>
  getBuildIntentPath: (buildId: string) => Promise<string>
  getInstancesRoot: () => Promise<string>
  pickFolder: (title?: string) => Promise<string | null>
  setInstancesRoot: (newRoot: string) => Promise<{ success: boolean; root?: string; error?: string }>
  saveModToIntent: (buildId: string, url: string, fileName: string) => Promise<string | null>
  saveLocalModToIntent: (buildId: string, localFilePath: string) => Promise<string | null>
  readLocalContentMetadata: (localFilePath: string) => Promise<ContentFileMetadata | null>
  classifyDropPaths: (paths: string[], kind: ContentDropKind) => Promise<ContentDropClassification>
  saveContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => Promise<string | null>
  saveLocalContentToIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", localFilePath: string) => Promise<string | null>
  deleteContentFromIntent: (buildId: string, contentType: "mod" | "resourcepack" | "shader", fileName: string) => Promise<{ success: boolean; error?: string }>
  setBuildIntentPath: (buildId: string, intentPath: string) => Promise<void>
  deleteBuildIntent: (buildName: string) => Promise<{ success: boolean; error?: string }>
  installContentFile: (contentType: "mod" | "resourcepack" | "shader", url: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  importModrinthModpack: (buildName: string, projectSlug: string, versionId?: string, targetBuildId?: string) => Promise<ModpackImportResult>
  importCurseforgeModpack: (buildName: string, modId: number, fileId: number, targetBuildId?: string) => Promise<ModpackImportResult>
  importFtbModpack: (buildName: string, modpackId: number, versionId: number, targetBuildId?: string) => Promise<ModpackImportResult>
  openAndImportModpack: (nameOverride?: string) => Promise<ModpackImportResult & { name?: string; description?: string; icon?: string; source?: "modrinth" | "curseforge"; intentPath?: string }>
  cancelImportModpack: () => Promise<{ success: boolean }>
  onImportProgress: (callback: (progress: ImportProgress) => void) => CleanupFn
  onBuildExportProgress: (callback: (progress: { current: number; total: number }) => void) => CleanupFn
  onContentDownloadProgress: (callback: (progress: ContentDownloadProgress) => void) => CleanupFn
  openExternal: (url: string) => Promise<void>
  openLauncherFolder: () => Promise<void>
  openPath: (dirPath: string) => Promise<void>
  shareToMclogs: (content: string) => Promise<{ success: boolean; url?: string; error?: string }>
  detectJavaInstallations: (force?: boolean) => Promise<JavaDetectResult[]>
  pickJavaFile: () => Promise<string | null>
  listWorlds: (buildName: string) => Promise<WorldInfo[]>
  renameWorld: (buildName: string, folder: string, newName: string) => Promise<{ success: boolean; error?: string }>
  deleteWorld: (buildName: string, folder: string) => Promise<{ success: boolean; error?: string }>
  setWorldIcon: (buildName: string, folder: string, dataUrl: string) => Promise<{ success: boolean; error?: string }>
  listWorldDatapacks: (buildName: string, folder: string) => Promise<DatapackInfo[]>
  installDatapackRemote: (buildName: string, folder: string, url: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  installDatapackLocal: (buildName: string, folder: string, localFilePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
  deleteWorldDatapack: (buildName: string, folder: string, fileName: string) => Promise<{ success: boolean; error?: string }>
  listScreenshots: (buildName: string) => Promise<ScreenshotInfo[]>
  getScreenshot: (buildName: string, fileName: string) => Promise<string | null>
  deleteScreenshot: (buildName: string, fileName: string) => Promise<{ success: boolean; error?: string }>
  renameScreenshot: (buildName: string, fileName: string, newName: string) => Promise<{ success: boolean; error?: string }>
  listServers: (buildName: string) => Promise<Array<{ name: string; ip: string }>>
  writeServersDat: (buildName: string, servers: Array<{ name: string; ip: string }>) => Promise<{ success: boolean; error?: string }>
  copyBuild: (buildName: string, newName: string) => Promise<{ success: boolean; intentPath?: string; error?: string }>
  exportBuildZip: (buildName: string, label: string, categories?: BuildExportCategory[]) => Promise<{ success: boolean; path?: string; error?: string }>
  exportBuildModlist: (buildName: string, label: string, format: "html" | "markdown" | "json" | "csv" | "plaintext") => Promise<{ success: boolean; path?: string; error?: string }>
  moveBuildIntentToTrash: (dirName: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; trashName?: string; error?: string }>
  restoreBuildIntentFromTrash: (dirName: string, trashName: string) => Promise<{ success: boolean; build?: Record<string, unknown>; error?: string }>
  purgeBuildTrash: () => Promise<{ success: boolean; error?: string }>
  listTrashBuilds: () => Promise<Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }>>
  deleteTrashItem: (trashName: string) => Promise<{ success: boolean; error?: string }>
  checkBuildContentUpdates: (buildId: string, channel?: UpdateChannel) => Promise<BuildContentUpdates>
  getContentUpdatesCache: () => Promise<Record<string, BuildContentUpdates>>
  getContentUpdatesCounts: () => Promise<Record<string, { mods: number; resourcepacks: number; shaders: number }>>
  dismissContentUpdate: (buildId: string, itemId: string) => Promise<void>
  getStatsOverview: (range?: StatsRange) => Promise<StatsOverview>
  onStatsUpdated: (callback: () => void) => CleanupFn
  scanStorage: () => Promise<StorageScanResult>
  cleanStorage: (target: StorageCleanTarget) => Promise<StorageCleanResult>
  skinsGetProfile: (accountId?: string) => Promise<McProfile | null>
  skinsDeleteSkin: (accountId?: string) => Promise<boolean>
  skinsSetCape: (capeId: string | null, accountId?: string) => Promise<boolean>
  xnConnectUsage: () => Promise<XnConnectUsage | null>
  onXnConnectUsage: (callback: (usage: XnConnectUsage) => void) => CleanupFn
}

// ── ElectronAPI (full merged bridge surface) ─────────────────
// Single type for window.electronAPI: the base contract plus every
// launcher-specific method that historically lived in src/electron.d.ts.

export interface ElectronAPIExtra {
  getAiConfig: () => Promise<{ apiKey: string; endpoint: string; model: string }>
  saveAiConfig: (config: { apiKey: string; endpoint: string; model: string }) => Promise<void>
  listAiModels: (override?: { apiKey?: string; endpoint?: string }) => Promise<{ success: boolean; models?: string[]; error?: string }>
  analyzeCrash: (logContent: string, sessionId: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  analyzeCrashStream: (requestId: string, logContent: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  aiChatSend: (sessionId: string, userMessage: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  aiChatSendStream: (requestId: string, sessionId: string, userMessage: string) => Promise<{ success: boolean; analysis?: string; error?: string }>
  aiListSessions: () => Promise<Array<{ id: string; title: string; createdAt: number; updatedAt: number }>>
  aiCreateSession: (id: string, title: string) => Promise<void>
  aiRenameSession: (id: string, title: string) => Promise<void>
  aiDeleteSession: (id: string) => Promise<void>
  aiListMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; createdAt: number }>>
  onAiStreamChunk: (callback: (data: { requestId: string; content: string }) => void) => () => void
  onAiStreamDone: (callback: (data: { requestId: string; fullText: string }) => void) => () => void
  onAiStreamError: (callback: (data: { requestId: string; error: string }) => void) => () => void
  getTotalMemory: () => Promise<number>
  reorderAccounts: (ids: string[]) => Promise<void>
  getInstancesRoot: () => Promise<string>
  pickFolder: (title?: string) => Promise<string | null>
  setInstancesRoot: (newRoot: string) => Promise<{ success: boolean; root?: string; error?: string }>
  cloudListProviders: () => Promise<Array<{ id: string; name: string }>>
  cloudConnect: (providerId: string, authData?: Record<string, string>) => Promise<{ success: boolean; provider?: string; error?: string }>
  cloudIsConnected: (providerId: string) => Promise<boolean>
  cloudDisconnect: (providerId: string) => Promise<{ success: boolean; error?: string }>
  cloudListFiles: (providerId: string, folderPath?: string) => Promise<{ success: boolean; files?: Array<{ id: string; name: string; size: number; modifiedAt?: string; path: string; isDir: boolean; category?: string }>; error?: string }>
  cloudUploadFile: (providerId: string, localPath: string, remotePath: string) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>
  cloudDownloadFile: (providerId: string, remotePath: string, localPath: string) => Promise<{ success: boolean; localPath?: string; error?: string }>
  cloudDeleteFile: (providerId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>
  cloudGetQuota: (providerId: string) => Promise<{ used: number; total: number } | null>
  cloudUploadBuild: (providerId: string, buildName: string, uploadId?: string, categories?: CloudUploadCategory[]) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>
  cloudUploadServer: (providerId: string, serverId: string, serverName: string, uploadId?: string, categories?: CloudUploadCategory[]) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>
  onContentDownloadProgress: (callback: (progress: ContentDownloadProgress) => void) => () => void
  onCloudUploadProgress: (callback: (data: { id: string; percent: number; stage: "zip" | "upload" }) => void) => () => void
  getFilePath: (file: File) => string
  cloudUploadAccount: (providerId: string, account: { id: string; type: string; username: string; uuid?: string }) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>
  cloudDownloadAndImport: (providerId: string, remotePath: string, fileType: string, selectedCategories?: string[]) => Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }>
  listWorlds: (buildName: string) => Promise<WorldInfo[]>
  renameWorld: (buildName: string, folder: string, newName: string) => Promise<{ success: boolean; error?: string }>
  copyWorld: (buildName: string, folder: string, newName: string) => Promise<{ success: boolean; folder?: string; error?: string }>
  importWorldZip: (buildName: string, localFilePath: string, newName?: string) => Promise<{ success: boolean; folder?: string; error?: string }>
  importWorldRemote: (buildName: string, url: string, preferredName?: string) => Promise<{ success: boolean; folder?: string; error?: string }>
  deleteWorld: (buildName: string, folder: string) => Promise<{ success: boolean; error?: string }>
  setWorldIcon: (buildName: string, folder: string, dataUrl: string) => Promise<{ success: boolean; error?: string }>
  resetWorldIcon: (buildName: string, folder: string) => Promise<{ success: boolean; error?: string }>
  listWorldDatapacks: (buildName: string, folder: string) => Promise<DatapackInfo[]>
  installDatapackRemote: (buildName: string, folder: string, url: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  installDatapackLocal: (buildName: string, folder: string, localFilePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
  deleteWorldDatapack: (buildName: string, folder: string, fileName: string) => Promise<{ success: boolean; error?: string }>
  listScreenshots: (buildName: string) => Promise<ScreenshotInfo[]>
  getScreenshot: (buildName: string, fileName: string) => Promise<string | null>
  deleteScreenshot: (buildName: string, fileName: string) => Promise<{ success: boolean; error?: string }>
  renameScreenshot: (buildName: string, fileName: string, newName: string) => Promise<{ success: boolean; error?: string }>
  listServers: (buildName: string) => Promise<Array<{ name: string; ip: string }>>
  writeServersDat: (buildName: string, servers: Array<{ name: string; ip: string }>) => Promise<{ success: boolean; error?: string }>
  pingServer: (address: string) => Promise<ServerStatusResult>
  quickPlayList: (buildName?: string, gameDir?: string) => Promise<QuickPlayEntry[]>
  quickPlayClear: (buildName?: string, gameDir?: string) => Promise<void>
  quickPlayRemove: (buildName: string | undefined, gameDir: string | undefined, entry: QuickPlayEntry) => Promise<void>
  copyBuild: (buildName: string, newName: string) => Promise<{ success: boolean; intentPath?: string; error?: string }>
  renameBuildIntent: (oldName: string, newName: string) => Promise<{ success: boolean; intentPath?: string; error?: string }>
  exportBuildZip: (buildName: string, label: string, categories?: BuildExportCategory[]) => Promise<{ success: boolean; path?: string; error?: string }>
  exportBuildModlist: (buildName: string, label: string, format: "html" | "markdown" | "json" | "csv" | "plaintext") => Promise<{ success: boolean; path?: string; error?: string }>
  moveBuildIntentToTrash: (dirName: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; trashName?: string; error?: string }>
  restoreBuildIntentFromTrash: (dirName: string, trashName: string) => Promise<{ success: boolean; build?: Record<string, unknown>; error?: string }>
  purgeBuildTrash: () => Promise<{ success: boolean; error?: string }>
  listTrashBuilds: () => Promise<Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }>>
  deleteTrashItem: (trashName: string) => Promise<{ success: boolean; error?: string }>
  setContentEnabled: (buildName: string, contentType: "mod" | "resourcepack" | "shader", fileName: string, enabled: boolean) => Promise<{ success: boolean; fileName?: string; error?: string }>
  onCliLaunchBuild: (callback: (buildName: string) => void) => () => void
  updateCheck: () => Promise<{ available: boolean; version?: string; error?: string }>
  updateDownload: () => Promise<{ success: boolean; error?: string }>
  updateInstall: () => Promise<void>
  updateInfo: () => Promise<{ version: string | null; downloaded: boolean }>
  onUpdateStatus: (callback: (status: { status: string; version?: string; releaseDate?: string; releaseNotes?: string; error?: string }) => void) => () => void
  onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void
  skinsGetProfile: (accountId?: string) => Promise<McProfile | null>
  skinsDeleteSkin: (accountId?: string) => Promise<boolean>
  skinsSetCape: (capeId: string | null, accountId?: string) => Promise<boolean>
  skinsListLibrary: (accountId: string) => Promise<LibrarySkin[]>
  skinsSaveToLibrary: (filePath: string, name: string, variant: "classic" | "slim", accountId: string, capeId?: string | null) => Promise<LibrarySkin | null>
  skinsDeleteFromLibrary: (id: string) => Promise<boolean>
  skinsUpdateVariant: (id: string, variant: "classic" | "slim", capeId?: string | null, name?: string) => Promise<boolean>
  skinsApplyLibrarySkin: (skinId: string, accountId: string) => Promise<boolean>
  labyCatalog: (page: number, size?: number, order?: LabyOrder, tags?: string[] | null, query?: string | null) => Promise<LabyCatalogPage>
  labyTags: (locale?: string) => Promise<LabyTag[]>
  labySimilar: (hash: string, tags: string[], slim: boolean) => Promise<LabySkin[]>
  labyPlayer: (username: string) => Promise<LabyPlayer | null>
  labySaveToLibrary: (hash: string, accountId: string, name?: string, slim?: boolean) => Promise<LabyImportResult>
  labyApply: (hash: string, accountId: string, name?: string, slim?: boolean) => Promise<LabyImportResult>
  readLocalFile: (filePath: string) => Promise<string | null>
  mcServerList: () => Promise<McServerInfo[]>
  mcServerGet: (id: string) => Promise<McServerInfo | null>
  mcServerCreate: (data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string }) => Promise<McServerInfo>
  mcServerInstallPack: (params: { source: "modrinth" | "curseforge"; projectSlug?: string; versionId?: string; modId?: number; fileId?: number; name?: string; icon?: string; port?: number; xmx?: number; xms?: number; extraJavaArgs?: string; javaPath?: string; relayEnabled?: boolean; onlineMode?: boolean; maxPlayers?: number }) => Promise<McServerInfo>
  mcServerAnalyzeJar: (jarPath: string) => Promise<{ minecraftVersion: string | null; loaderId: string | null; loaderLabel: string | null; modId: string | null; mainClass: string | null; error?: string }>
  mcServerUpdate: (id: string, update: Record<string, unknown>) => Promise<void>
  mcServerDelete: (id: string) => Promise<void>
  mcServerRestore: (id: string) => Promise<void>
  mcServerListTrash: () => Promise<McServerInfo[]>
  mcServerPurgeTrash: (deleteTunnel?: boolean) => Promise<void>
  mcServerPermanentDelete: (id: string, deleteTunnel?: boolean) => Promise<void>
  mcServerExportZip: (id: string, serverName: string, categories?: string[]) => Promise<{ success: boolean; path?: string; error?: string }>
  mcServerDuplicate: (id: string) => Promise<McServerInfo | null>
  mcServerStart: (id: string) => Promise<void>
  mcServerStop: (id: string) => Promise<void>
  mcServerKill: (id: string) => Promise<void>
  mcServerSendCommand: (id: string, command: string) => Promise<void>
  mcServerStatus: (id: string) => Promise<McServerState>
  mcServerMetrics: (id: string) => Promise<McServerMetrics>
  /** Подписка на push-метрики сервера (вместо поллинга из renderer). */
  mcServerMetricsSubscribe: (id: string) => Promise<void>
  mcServerMetricsUnsubscribe: (id: string) => Promise<void>
  onMcServerMetrics: (callback: (data: { id: string; metrics: McServerMetrics }) => void) => CleanupFn
  mcServerLogs: (id: string) => Promise<string[]>
  mcServerOpenFolder: (id: string) => Promise<void>
  mcServerReadProperties: (id: string) => Promise<Record<string, string> | null>
  mcServerWriteProperties: (id: string, properties: Record<string, string>) => Promise<void>
  mcServerGetWhitelist: (id: string) => Promise<McPlayerEntry[]>
  mcServerAddWhitelist: (id: string, username: string) => Promise<void>
  mcServerRemoveWhitelist: (id: string, uuid: string) => Promise<void>
  mcServerGetOps: (id: string) => Promise<McPlayerEntry[]>
  mcServerAddOp: (id: string, username: string) => Promise<void>
  mcServerRemoveOp: (id: string, uuid: string) => Promise<void>
  mcServerGetBanned: (id: string) => Promise<McPlayerEntry[]>
  mcServerBanPlayer: (id: string, username: string) => Promise<void>
  mcServerUnbanPlayer: (id: string, uuid: string) => Promise<void>
  mcServerGetBannedIps: (id: string) => Promise<McPlayerEntry[]>
  mcServerBanIp: (id: string, ip: string) => Promise<void>
  mcServerUnbanIp: (id: string, ip: string) => Promise<void>
  mcServerGetAddresses: (id: string) => Promise<{ local: string; public: string | null; custom: string } | null>
  mcServerCheckEula: (id: string) => Promise<boolean>
  mcServerAcceptEula: (id: string) => Promise<void>

  // ── Server Files ──
  mcServerFsList: (id: string, relativePath: string) => Promise<McFsEntry[]>
  mcServerFsRead: (id: string, relativePath: string) => Promise<string | null>
  mcServerFsWrite: (id: string, relativePath: string, content: string) => Promise<void>
  mcServerFsDelete: (id: string, relativePath: string) => Promise<void>
  mcServerFsRename: (id: string, oldPath: string, newPath: string) => Promise<void>
  mcServerFsMkdir: (id: string, relativePath: string) => Promise<void>
  mcServerFsStat: (id: string, relativePath: string) => Promise<McFsEntry | null>
  mcServerFsDownload: (id: string, relativePath: string, url: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  mcServerResolveInstalled: (id: string, relativePath: string) => Promise<Array<{ name: string; sha1: string; projectId?: string; versionId?: string }>>

  // ── XN-Connect Relay ──
  xnConnectAuthorize: () => Promise<boolean>
  xnConnectStart: (serverId: string) => Promise<XnConnectState>
  xnConnectStop: (serverId: string) => Promise<void>
  xnConnectStatus: (serverId: string) => Promise<XnConnectState>
  xnConnectUsage: () => Promise<XnConnectUsage | null>
  onXnConnectState: (callback: (data: { serverId: string; state: XnConnectState }) => void) => () => void
  onXnConnectLog: (callback: (data: { serverId: string; line: string }) => void) => () => void
  onXnConnectAuthState: (callback: (data: { state: XnConnectState }) => void) => () => void
  onXnConnectUsage: (callback: (usage: XnConnectUsage) => void) => () => void

  onMcServerLog: (callback: (data: { id: string; line: string }) => void) => () => void
  onMcServerStateChange: (callback: (data: { id: string; state: McServerState }) => void) => () => void
  onMcServerDownloadProgress: (callback: (data: { id: string; progress: { phase: string; percent?: number; bytesTotal?: number; bytesDownloaded?: number; message: string } }) => void) => () => void
  getPaperVersions: (mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>
  getPurpurVersions: (mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>
  getFoliaVersions: (mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>
  getPaperSupported: () => Promise<string[]>
  getPurpurSupported: () => Promise<string[]>
  getFoliaSupported: () => Promise<string[]>
  getVelocitySupported: () => Promise<string[]>
  getVelocityVersions: (velocityVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>
  getWaterfallSupported: () => Promise<string[]>
  getWaterfallVersions: (mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>
  getSpongeSupported: (spongeType?: string) => Promise<string[]>
  getSpongeVersions: (spongeType: string, mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>
  modsCurseforgeChangelog: (modId: number, fileId: number) => Promise<string>
  modsCurseforgeDescription: (modId: number) => Promise<string>
  modsModrinthCheckUpdates: (hashes: string[], loaders?: string[], gameVersions?: string[]) => Promise<Record<string, ModVersion>>
}

// Legacy cloud-контракты (`cloudLogin`/`cloudGetFiles`/… token-based) удалены:
// хендлеров и preload-методов для них не было, а имена конфликтовали с новым
// provider-API в ElectronAPIExtra. Omit-хирургия больше не нужна.
export type ElectronAPI = ElectronAPIExplicit & ElectronAPIExtra
