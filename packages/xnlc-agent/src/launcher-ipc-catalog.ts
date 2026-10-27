// Сгенерировано scripts/gen-agent-ipc-catalog.mjs из IPC-контрактов и preload.
import type { ElectronAPI } from "@xnlc/types"
export interface LauncherCapability { method: keyof ElectronAPI; signature: string; parameters: Array<{name:string;optional:boolean;type:string}>; channels:string[]; event:boolean; callable:boolean }
export const LAUNCHER_CAPABILITIES: LauncherCapability[] = [
  {
    "method": "startupThemeSnapshot",
    "signature": "string | null",
    "parameters": [],
    "channels": [
      "startup:theme-cache"
    ],
    "event": false,
    "callable": false
  },
  {
    "method": "startupReady",
    "signature": "() => Promise<void>",
    "parameters": [],
    "channels": [
      "startup:ready"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "minimize",
    "signature": "() => void",
    "parameters": [],
    "channels": [],
    "event": false,
    "callable": true
  },
  {
    "method": "maximize",
    "signature": "() => void",
    "parameters": [],
    "channels": [],
    "event": false,
    "callable": true
  },
  {
    "method": "close",
    "signature": "() => void",
    "parameters": [],
    "channels": [],
    "event": false,
    "callable": true
  },
  {
    "method": "restore",
    "signature": "() => void",
    "parameters": [],
    "channels": [],
    "event": false,
    "callable": true
  },
  {
    "method": "loginElyBy",
    "signature": "() => Promise<AuthPayload>",
    "parameters": [],
    "channels": [
      "auth:elyby-login"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "startElyByDeviceCode",
    "signature": "() => Promise<DeviceCodeStart>",
    "parameters": [],
    "channels": [
      "auth:elyby-device-start"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pollElyByDeviceCode",
    "signature": "(deviceCode: string) => Promise<DeviceCodePoll>",
    "parameters": [
      {
        "name": "deviceCode",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "auth:elyby-device-poll"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "loginXnSkins",
    "signature": "() => Promise<AuthPayload>",
    "parameters": [],
    "channels": [
      "auth:xnskins-login"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "startXnSkinsDeviceCode",
    "signature": "() => Promise<DeviceCodeStart>",
    "parameters": [],
    "channels": [
      "auth:xnskins-device-start"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pollXnSkinsDeviceCode",
    "signature": "(deviceCode: string) => Promise<DeviceCodePoll>",
    "parameters": [
      {
        "name": "deviceCode",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "auth:xnskins-device-poll"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "loginMicrosoft",
    "signature": "() => Promise<AuthPayload>",
    "parameters": [],
    "channels": [
      "auth:microsoft-login"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "startMicrosoftDeviceCode",
    "signature": "() => Promise<DeviceCodeStart>",
    "parameters": [],
    "channels": [
      "auth:microsoft-device-start"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pollMicrosoftDeviceCode",
    "signature": "(deviceCode: string) => Promise<DeviceCodePoll>",
    "parameters": [
      {
        "name": "deviceCode",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "auth:microsoft-device-poll"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibListServers",
    "signature": "() => Promise<AuthlibInjectorServerSummary[]>",
    "parameters": [],
    "channels": [
      "authlib:list-servers"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibProbeServer",
    "signature": "(url: string) => Promise<AuthlibProbeOutcome>",
    "parameters": [
      {
        "name": "url",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "authlib:probe-server"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibAddServer",
    "signature": "(server: AuthlibInjectorServer) => Promise<AuthlibAddServerOutcome>",
    "parameters": [
      {
        "name": "server",
        "optional": false,
        "type": "AuthlibInjectorServer"
      }
    ],
    "channels": [
      "authlib:add-server"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibRemoveServer",
    "signature": "(id: string) => Promise<AuthlibRemoveServerResult>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "authlib:remove-server"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibRefreshServer",
    "signature": "(id: string) => Promise<AuthlibInjectorServerSummary | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "authlib:refresh-server"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibLogin",
    "signature": "(serverId: string, username: string, password: string, profileId?: string) => Promise<AuthlibLoginOutcome>",
    "parameters": [
      {
        "name": "serverId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "username",
        "optional": false,
        "type": "string"
      },
      {
        "name": "password",
        "optional": false,
        "type": "string"
      },
      {
        "name": "profileId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "authlib:login"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibEnsureSession",
    "signature": "(accountId: string) => Promise<AuthlibSessionOutcome>",
    "parameters": [
      {
        "name": "accountId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "authlib:ensure-session"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibInvalidate",
    "signature": "(accountId: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "accountId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "authlib:invalidate"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "authlibGetProfileTextures",
    "signature": "(serverId: string, uuid: string) => Promise<YggdrasilProfileWithTextures | null>",
    "parameters": [
      {
        "name": "serverId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "uuid",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "authlib:get-profile-textures"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onAuthlibLoginProgress",
    "signature": "(callback: (progress: AuthlibLoginProgress) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: AuthlibLoginProgress) => void"
      }
    ],
    "channels": [
      "authlib:login-progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "fetchMinecraftNews",
    "signature": "() => Promise<MinecraftNewsEntry[]>",
    "parameters": [],
    "channels": [
      "fetch:minecraft-news"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "fetchLauncherNews",
    "signature": "(url?: string) => Promise<LauncherNewsEntry[]>",
    "parameters": [
      {
        "name": "url",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "fetch:launcher-news"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "loadAccounts",
    "signature": "() => Promise<DbAccount[]>",
    "parameters": [],
    "channels": [
      "db:load-accounts"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveAccount",
    "signature": "(account: DbAccount) => Promise<void>",
    "parameters": [
      {
        "name": "account",
        "optional": false,
        "type": "DbAccount"
      }
    ],
    "channels": [
      "db:save-account"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "removeAccount",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "db:remove-account"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "loadBuildsLight",
    "signature": "() => Promise<DbBuildLight[]>",
    "parameters": [],
    "channels": [
      "db:load-builds-light"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "loadBuildContent",
    "signature": "(buildId: string) => Promise<{ mods: unknown[]; resourcepacks: unknown[]; shaders: unknown[]; installedMods: Record<string, string> } | null>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "db:load-build-content"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "fetchMissingBuildMods",
    "signature": "(buildName: string) => Promise<{ success: boolean; downloaded?: number; failed?: number; missing?: number; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:fetch-missing-mods"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveBuilds",
    "signature": "(builds: DbBuild[]) => Promise<void>",
    "parameters": [
      {
        "name": "builds",
        "optional": false,
        "type": "DbBuild[]"
      }
    ],
    "channels": [
      "db:save-builds"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "insertBuild",
    "signature": "(build: DbBuild) => Promise<void>",
    "parameters": [
      {
        "name": "build",
        "optional": false,
        "type": "DbBuild"
      }
    ],
    "channels": [
      "db:insert-build"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "updateBuildFields",
    "signature": "(buildId: string, fields: Partial<DbBuild>) => Promise<void>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fields",
        "optional": false,
        "type": "Partial<DbBuild>"
      }
    ],
    "channels": [
      "db:update-build-fields"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "dbIsFallbackStorage",
    "signature": "() => Promise<{ isFallback: boolean }>",
    "parameters": [],
    "channels": [
      "db:is-fallback-storage"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "reorderAccounts",
    "signature": "(ids: string[]) => Promise<void>",
    "parameters": [
      {
        "name": "ids",
        "optional": false,
        "type": "string[]"
      }
    ],
    "channels": [
      "db:reorder-accounts"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "scanBuildIntentContent",
    "signature": "(buildName: string) => Promise<BuildIntentScanResult>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:scan-intent-content"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "discoverImportableInstances",
    "signature": "() => Promise<ImportableLauncherInstance[]>",
    "parameters": [],
    "channels": [
      "launcher:discover-importable-instances"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "discoverFromPath",
    "signature": "(source: string, customPath: string) => Promise<ImportableLauncherInstance[]>",
    "parameters": [
      {
        "name": "source",
        "optional": false,
        "type": "string"
      },
      {
        "name": "customPath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "launcher:discover-from-path"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importGdLauncherInstances",
    "signature": "(ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>",
    "parameters": [
      {
        "name": "ids",
        "optional": false,
        "type": "string[]"
      }
    ],
    "channels": [
      "launcher:import-gdlauncher-instances"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importLauncherInstances",
    "signature": "(ids: string[]) => Promise<{ success: boolean; imported: number; error?: string }>",
    "parameters": [
      {
        "name": "ids",
        "optional": false,
        "type": "string[]"
      }
    ],
    "channels": [
      "launcher:import-instances"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "copyBuild",
    "signature": "(buildName: string, newName: string) => Promise<{ success: boolean; intentPath?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "newName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:copy"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "renameBuildIntent",
    "signature": "(oldName: string, newName: string) => Promise<{ success: boolean; intentPath?: string; error?: string }>",
    "parameters": [
      {
        "name": "oldName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "newName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:rename-intent"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "exportBuildZip",
    "signature": "(buildName: string, label: string, categories?: BuildExportCategory[]) => Promise<{ success: boolean; path?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "label",
        "optional": false,
        "type": "string"
      },
      {
        "name": "categories",
        "optional": true,
        "type": "BuildExportCategory[]"
      }
    ],
    "channels": [
      "build:export-zip"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "exportBuildModlist",
    "signature": "(buildName: string, label: string, format: \"html\" | \"markdown\" | \"json\" | \"csv\" | \"plaintext\") => Promise<{ success: boolean; path?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "label",
        "optional": false,
        "type": "string"
      },
      {
        "name": "format",
        "optional": false,
        "type": "\"html\" | \"markdown\" | \"json\" | \"csv\" | \"plaintext\""
      }
    ],
    "channels": [
      "build:export-modlist"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "moveBuildIntentToTrash",
    "signature": "(dirName: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; trashName?: string; error?: string }>",
    "parameters": [
      {
        "name": "dirName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "metadata",
        "optional": true,
        "type": "Record<string, unknown>"
      }
    ],
    "channels": [
      "build:move-intent-to-trash"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "restoreBuildIntentFromTrash",
    "signature": "(dirName: string, trashName: string) => Promise<{ success: boolean; build?: Record<string, unknown>; error?: string }>",
    "parameters": [
      {
        "name": "dirName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "trashName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:restore-intent-from-trash"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "purgeBuildTrash",
    "signature": "() => Promise<{ success: boolean; error?: string }>",
    "parameters": [],
    "channels": [
      "build:purge-trash"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "listTrashBuilds",
    "signature": "() => Promise<Array<{ trashName: string; originalName: string; trashedAt: number; icon?: string; modLoader?: string }>>",
    "parameters": [],
    "channels": [
      "build:list-trash"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "deleteTrashItem",
    "signature": "(trashName: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "trashName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:delete-trash-item"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onCliLaunchBuild",
    "signature": "(callback: (buildName: string) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(buildName: string) => void"
      }
    ],
    "channels": [
      "cli:launch-build"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "modsModrinthSearch",
    "signature": "(query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: ModLoaderFilter, sortBy?: ModSort, page?: number, categories?: string[], environment?: ModEnvironment) => Promise<ModSearchResponse>",
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "contentType",
        "optional": true,
        "type": "ModContentType"
      },
      {
        "name": "gameVersion",
        "optional": true,
        "type": "string"
      },
      {
        "name": "modLoader",
        "optional": true,
        "type": "ModLoaderFilter"
      },
      {
        "name": "sortBy",
        "optional": true,
        "type": "ModSort"
      },
      {
        "name": "page",
        "optional": true,
        "type": "number"
      },
      {
        "name": "categories",
        "optional": true,
        "type": "string[]"
      },
      {
        "name": "environment",
        "optional": true,
        "type": "ModEnvironment"
      }
    ],
    "channels": [
      "mods:modrinth-search"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsModrinthDetails",
    "signature": "(slug: string) => Promise<ModDetails | null>",
    "parameters": [
      {
        "name": "slug",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mods:modrinth-details"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsModrinthVersions",
    "signature": "(slug: string, sha1?: string) => Promise<ModVersion[]>",
    "parameters": [
      {
        "name": "slug",
        "optional": false,
        "type": "string"
      },
      {
        "name": "sha1",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "mods:modrinth-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsCurseforgeSearch",
    "signature": "(query: string, contentType?: ModContentType, gameVersion?: string, modLoader?: string, sortBy?: ModSort, page?: number, categories?: string[], environment?: ModEnvironment) => Promise<ModSearchResponse>",
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "contentType",
        "optional": true,
        "type": "ModContentType"
      },
      {
        "name": "gameVersion",
        "optional": true,
        "type": "string"
      },
      {
        "name": "modLoader",
        "optional": true,
        "type": "string"
      },
      {
        "name": "sortBy",
        "optional": true,
        "type": "ModSort"
      },
      {
        "name": "page",
        "optional": true,
        "type": "number"
      },
      {
        "name": "categories",
        "optional": true,
        "type": "string[]"
      },
      {
        "name": "environment",
        "optional": true,
        "type": "ModEnvironment"
      }
    ],
    "channels": [
      "mods:curseforge-search"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsCurseforgeDetails",
    "signature": "(modId: number) => Promise<ModDetails | null>",
    "parameters": [
      {
        "name": "modId",
        "optional": false,
        "type": "number"
      }
    ],
    "channels": [
      "mods:curseforge-details"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsCurseforgeDownloadUrl",
    "signature": "(fileId: number, modId: number) => Promise<string | null>",
    "parameters": [
      {
        "name": "fileId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "modId",
        "optional": false,
        "type": "number"
      }
    ],
    "channels": [
      "mods:curseforge-download-url"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsCurseforgeChangelog",
    "signature": "(modId: number, fileId: number) => Promise<string>",
    "parameters": [
      {
        "name": "modId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "fileId",
        "optional": false,
        "type": "number"
      }
    ],
    "channels": [
      "mods:curseforge-changelog"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsResolveDependencies",
    "signature": "(version: ModVersion, source: \"modrinth\" | \"curseforge\") => Promise<ModDependency[]>",
    "parameters": [
      {
        "name": "version",
        "optional": false,
        "type": "ModVersion"
      },
      {
        "name": "source",
        "optional": false,
        "type": "\"modrinth\" | \"curseforge\""
      }
    ],
    "channels": [
      "mods:resolve-dependencies"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsInspectJarDependencies",
    "signature": "(url: string, source: \"modrinth\" | \"curseforge\") => Promise<JarDependencyInspection>",
    "parameters": [
      {
        "name": "url",
        "optional": false,
        "type": "string"
      },
      {
        "name": "source",
        "optional": false,
        "type": "\"modrinth\" | \"curseforge\""
      }
    ],
    "channels": [
      "mods:inspect-jar-dependencies"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "checkBuildLoaderRequirements",
    "signature": "(buildName: string, modLoader?: string, loaderVersion?: string) => Promise<BuildLoaderRequirementReport>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "modLoader",
        "optional": true,
        "type": "string"
      },
      {
        "name": "loaderVersion",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "mods:check-loader-requirements"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsFtbSearch",
    "signature": "(query: string, page?: number, options?: { sortBy?: ModSort; categories?: string[]; gameVersion?: string; loader?: string }) => Promise<ModSearchResponse>",
    "parameters": [
      {
        "name": "query",
        "optional": false,
        "type": "string"
      },
      {
        "name": "page",
        "optional": true,
        "type": "number"
      },
      {
        "name": "options",
        "optional": true,
        "type": "{ sortBy?: ModSort; categories?: string[]; gameVersion?: string; loader?: string }"
      }
    ],
    "channels": [
      "mods:ftb-search"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsFtbCatalogFacets",
    "signature": "() => Promise<{ categories: string[]; gameVersions: string[]; loaders: string[] }>",
    "parameters": [],
    "channels": [
      "mods:ftb-catalog-facets"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsFtbDetails",
    "signature": "(id: number) => Promise<ModDetails | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "number"
      }
    ],
    "channels": [
      "mods:ftb-details"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsFtbChangelog",
    "signature": "(id: number, versionId: number) => Promise<string>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "number"
      },
      {
        "name": "versionId",
        "optional": false,
        "type": "number"
      }
    ],
    "channels": [
      "mods:ftb-changelog"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsModrinthCategories",
    "signature": "() => Promise<any[]>",
    "parameters": [],
    "channels": [
      "mods:modrinth-categories"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "modsCurseforgeCategories",
    "signature": "() => Promise<any[]>",
    "parameters": [],
    "channels": [
      "mods:curseforge-categories"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getMinecraftVersions",
    "signature": "() => Promise<MinecraftVersionInfo[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getLatestRelease",
    "signature": "() => Promise<string | null>",
    "parameters": [],
    "channels": [
      "minecraft:get-latest-release"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getFabricVersions",
    "signature": "(mcVersion: string) => Promise<{ version: string; stable: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-fabric-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getFabricSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-fabric-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getLiteLoaderVersions",
    "signature": "(mcVersion: string) => Promise<{ version: string; stable: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-liteloader-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getLiteLoaderRecommended",
    "signature": "(mcVersion: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-liteloader-recommended"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getLiteLoaderSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-liteloader-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getQuiltVersions",
    "signature": "(mcVersion: string) => Promise<{ version: string; stable: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-quilt-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getQuiltSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-quilt-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getOptifineVersions",
    "signature": "(mcVersion: string) => Promise<{ filename: string; isPreview: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-optifine-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getOptifineRecommended",
    "signature": "(mcVersion: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-optifine-recommended"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getOptifineSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-optifine-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getNeoForgeVersions",
    "signature": "(mcVersion: string) => Promise<{ version: string; stable: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-neoforge-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getNeoForgeRecommended",
    "signature": "(mcVersion: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-neoforge-recommended"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getNeoForgeSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-neoforge-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getForgeVersions",
    "signature": "(mcVersion: string) => Promise<{ version: string; stable: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-forge-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getForgeRecommended",
    "signature": "(mcVersion: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-forge-recommended"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getForgeSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-forge-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getPaperVersions",
    "signature": "(mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-paper-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getPurpurVersions",
    "signature": "(mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-purpur-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getFoliaVersions",
    "signature": "(mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-folia-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getPaperSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-paper-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getPurpurSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-purpur-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getFoliaSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-folia-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getVelocitySupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-velocity-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getVelocityVersions",
    "signature": "(velocityVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>",
    "parameters": [
      {
        "name": "velocityVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-velocity-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getWaterfallSupported",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-waterfall-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getWaterfallVersions",
    "signature": "(mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>",
    "parameters": [
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-waterfall-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getSpongeSupported",
    "signature": "(spongeType?: string) => Promise<string[]>",
    "parameters": [
      {
        "name": "spongeType",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-sponge-supported"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getSpongeVersions",
    "signature": "(spongeType: string, mcVersion: string) => Promise<{ value: string; label: string; stable?: boolean; recommended?: boolean }[]>",
    "parameters": [
      {
        "name": "spongeType",
        "optional": false,
        "type": "string"
      },
      {
        "name": "mcVersion",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:get-sponge-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getCustomVersions",
    "signature": "() => Promise<string[]>",
    "parameters": [],
    "channels": [
      "minecraft:get-custom-versions"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "setOfflineAuth",
    "signature": "(username: string) => Promise<AuthSession | null>",
    "parameters": [
      {
        "name": "username",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "minecraft:set-offline-auth"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getGameDir",
    "signature": "() => Promise<string>",
    "parameters": [],
    "channels": [
      "minecraft:get-game-dir"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getAuth",
    "signature": "() => Promise<AuthSession | null>",
    "parameters": [],
    "channels": [
      "minecraft:get-auth"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "launchMinecraft",
    "signature": "(params: MinecraftLaunchParams) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "params",
        "optional": false,
        "type": "MinecraftLaunchParams"
      }
    ],
    "channels": [
      "minecraft:launch"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "stopMinecraft",
    "signature": "() => Promise<void>",
    "parameters": [],
    "channels": [
      "minecraft:stop"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "isMinecraftRunning",
    "signature": "() => Promise<boolean>",
    "parameters": [],
    "channels": [
      "minecraft:is-running"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onMinecraftJavaProgress",
    "signature": "(callback: (progress: JavaProgress) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: JavaProgress) => void"
      }
    ],
    "channels": [
      "minecraft:java-progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onMinecraftDebug",
    "signature": "(callback: (message: string) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(message: string) => void"
      }
    ],
    "channels": [
      "minecraft:debug"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onMinecraftData",
    "signature": "(callback: (message: string) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(message: string) => void"
      }
    ],
    "channels": [
      "minecraft:data"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onMinecraftDownloadStatus",
    "signature": "(callback: (progress: MinecraftProgress) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: MinecraftProgress) => void"
      }
    ],
    "channels": [
      "minecraft:download-progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onMinecraftClose",
    "signature": "(callback: (info: MinecraftCloseInfo) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(info: MinecraftCloseInfo) => void"
      }
    ],
    "channels": [
      "minecraft:close"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "getSetting",
    "signature": "(key: string) => Promise<string | undefined>",
    "parameters": [
      {
        "name": "key",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "settings:get"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "setSetting",
    "signature": "(key: string, value: string) => Promise<void>",
    "parameters": [
      {
        "name": "key",
        "optional": false,
        "type": "string"
      },
      {
        "name": "value",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "settings:set"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getTotalMemory",
    "signature": "() => Promise<number>",
    "parameters": [],
    "channels": [
      "system:get-total-memory"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "listServers",
    "signature": "(buildName: string) => Promise<Array<{ name: string; ip: string; resourcePack?: \"prompt\" | \"enabled\" | \"disabled\" }>>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "servers:list"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "writeServersDat",
    "signature": "(buildName: string, servers: Array<{ name: string; ip: string; resourcePack?: \"prompt\" | \"enabled\" | \"disabled\" }>) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "servers",
        "optional": false,
        "type": "Array<{ name: string; ip: string; resourcePack?: \"prompt\" | \"enabled\" | \"disabled\" }>"
      }
    ],
    "channels": [
      "servers:write-dat"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pingServer",
    "signature": "(address: string) => Promise<ServerStatusResult>",
    "parameters": [
      {
        "name": "address",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "servers:ping"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getBuildIntentPath",
    "signature": "(buildId: string) => Promise<string>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:get-intent-path"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getInstancesRoot",
    "signature": "() => Promise<string>",
    "parameters": [],
    "channels": [
      "build:get-instances-root"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pickFolder",
    "signature": "(title?: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "title",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "common:pick-folder"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pickThemeFile",
    "signature": "(kind?: \"image\" | \"video\", title?: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "kind",
        "optional": true,
        "type": "\"image\" | \"video\""
      },
      {
        "name": "title",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "common:pick-file"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "readThemeMedia",
    "signature": "(source: string, maxBytes?: number) => Promise<string | null>",
    "parameters": [
      {
        "name": "source",
        "optional": false,
        "type": "string"
      },
      {
        "name": "maxBytes",
        "optional": true,
        "type": "number"
      }
    ],
    "channels": [
      "theme:read-media"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pickThemeMedia",
    "signature": "(kind: \"image\" | \"video\" | \"font\") => Promise<{ source: string; name: string } | null>",
    "parameters": [
      {
        "name": "kind",
        "optional": false,
        "type": "\"image\" | \"video\" | \"font\""
      }
    ],
    "channels": [
      "theme:pick-media"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "listLocalThemes",
    "signature": "() => Promise<LocalThemeSnapshot>",
    "parameters": [],
    "channels": [
      "theme:local-list"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importLocalTheme",
    "signature": "() => Promise<LocalThemeImport | null>",
    "parameters": [],
    "channels": [
      "theme:local-import"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveLocalTheme",
    "signature": "(theme: Theme, css: string) => Promise<LocalThemeFile>",
    "parameters": [
      {
        "name": "theme",
        "optional": false,
        "type": "Theme"
      },
      {
        "name": "css",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "theme:local-save"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "deleteLocalTheme",
    "signature": "(fileName: string) => Promise<void>",
    "parameters": [
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "theme:local-delete"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "exportLocalTheme",
    "signature": "(theme: Theme, format: \"xntheme\") => Promise<boolean>",
    "parameters": [
      {
        "name": "theme",
        "optional": false,
        "type": "Theme"
      },
      {
        "name": "format",
        "optional": false,
        "type": "\"xntheme\""
      }
    ],
    "channels": [
      "theme:local-export"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "openThemesDirectory",
    "signature": "() => Promise<string>",
    "parameters": [],
    "channels": [
      "theme:open-directory"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onLocalThemesChanged",
    "signature": "(callback: (snapshot: LocalThemeSnapshot) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(snapshot: LocalThemeSnapshot) => void"
      }
    ],
    "channels": [
      "theme:local-changed"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "setInstancesRoot",
    "signature": "(newRoot: string) => Promise<{ success: boolean; root?: string; error?: string }>",
    "parameters": [
      {
        "name": "newRoot",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:set-instances-root"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveModToIntent",
    "signature": "(buildId: string, url: string, fileName: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "url",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:save-mod-to-intent"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveLocalModToIntent",
    "signature": "(buildId: string, localFilePath: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "localFilePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:save-local-mod-to-intent"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "readLocalContentMetadata",
    "signature": "(localFilePath: string) => Promise<ContentFileMetadata | null>",
    "parameters": [
      {
        "name": "localFilePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:read-local-content-metadata"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "classifyDropPaths",
    "signature": "(paths: string[], kind: ContentDropKind) => Promise<ContentDropClassification>",
    "parameters": [
      {
        "name": "paths",
        "optional": false,
        "type": "string[]"
      },
      {
        "name": "kind",
        "optional": false,
        "type": "ContentDropKind"
      }
    ],
    "channels": [
      "build:classify-drop-paths"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveContentToIntent",
    "signature": "(buildId: string, contentType: \"mod\" | \"resourcepack\" | \"shader\", url: string, fileName: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "contentType",
        "optional": false,
        "type": "\"mod\" | \"resourcepack\" | \"shader\""
      },
      {
        "name": "url",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:save-content-to-intent"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveLocalContentToIntent",
    "signature": "(buildId: string, contentType: \"mod\" | \"resourcepack\" | \"shader\", localFilePath: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "contentType",
        "optional": false,
        "type": "\"mod\" | \"resourcepack\" | \"shader\""
      },
      {
        "name": "localFilePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:save-local-content-to-intent"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "deleteContentFromIntent",
    "signature": "(buildId: string, contentType: \"mod\" | \"resourcepack\" | \"shader\", fileName: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "contentType",
        "optional": false,
        "type": "\"mod\" | \"resourcepack\" | \"shader\""
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:delete-content-from-intent"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "setContentEnabled",
    "signature": "(buildName: string, contentType: \"mod\" | \"resourcepack\" | \"shader\", fileName: string, enabled: boolean) => Promise<{ success: boolean; fileName?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "contentType",
        "optional": false,
        "type": "\"mod\" | \"resourcepack\" | \"shader\""
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "enabled",
        "optional": false,
        "type": "boolean"
      }
    ],
    "channels": [
      "build:set-content-enabled"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "setBuildIntentPath",
    "signature": "(buildId: string, intentPath: string) => Promise<void>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "intentPath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:set-intent-path"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pruneLoaderProfiles",
    "signature": "(buildName: string, modLoader?: string, loaderVersion?: string) => Promise<{ removed: string[]; kept: string[] }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "modLoader",
        "optional": true,
        "type": "string"
      },
      {
        "name": "loaderVersion",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "build:prune-loader-profiles"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "deleteBuildIntent",
    "signature": "(buildName: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:delete-intent"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importModrinthModpack",
    "signature": "(buildName: string, projectSlug: string, versionId?: string, targetBuildId?: string) => Promise<ModpackImportResult>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "projectSlug",
        "optional": false,
        "type": "string"
      },
      {
        "name": "versionId",
        "optional": true,
        "type": "string"
      },
      {
        "name": "targetBuildId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "build:import-modrinth"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importCurseforgeModpack",
    "signature": "(buildName: string, modId: number, fileId: number, targetBuildId?: string) => Promise<ModpackImportResult>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "modId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "fileId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "targetBuildId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "build:import-curseforge"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importFtbModpack",
    "signature": "(buildName: string, modpackId: number, versionId: number, targetBuildId?: string) => Promise<ModpackImportResult>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "modpackId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "versionId",
        "optional": false,
        "type": "number"
      },
      {
        "name": "targetBuildId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "build:import-ftb"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "openAndImportModpack",
    "signature": "(format?: \"modpack\" | \"curseforge\" | \"xneon\", nameOverride?: string) => Promise<ModpackImportResult & { name?: string; description?: string; icon?: string; source?: \"modrinth\" | \"curseforge\"; intentPath?: string }>",
    "parameters": [
      {
        "name": "format",
        "optional": true,
        "type": "\"modpack\" | \"curseforge\" | \"xneon\""
      },
      {
        "name": "nameOverride",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "build:open-and-import"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cancelImportModpack",
    "signature": "() => Promise<{ success: boolean }>",
    "parameters": [],
    "channels": [
      "build:cancel-import"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onImportProgress",
    "signature": "(callback: (progress: ImportProgress) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: ImportProgress) => void"
      }
    ],
    "channels": [
      "import:progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onBuildExportProgress",
    "signature": "(callback: (progress: { current: number; total: number }) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: { current: number; total: number }) => void"
      }
    ],
    "channels": [
      "build:export-progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onContentDownloadProgress",
    "signature": "(callback: (progress: ContentDownloadProgress) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: ContentDownloadProgress) => void"
      }
    ],
    "channels": [
      "content:download-progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "checkBuildContentUpdates",
    "signature": "(buildId: string, channel?: UpdateChannel) => Promise<BuildContentUpdates>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "channel",
        "optional": true,
        "type": "UpdateChannel"
      }
    ],
    "channels": [
      "build:check-content-updates"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getContentUpdatesCache",
    "signature": "() => Promise<Record<string, BuildContentUpdates>>",
    "parameters": [],
    "channels": [
      "build:get-content-updates-cache"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getContentUpdatesCounts",
    "signature": "() => Promise<Record<string, { mods: number; resourcepacks: number; shaders: number }>>",
    "parameters": [],
    "channels": [
      "build:get-content-updates-counts"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "dismissContentUpdate",
    "signature": "(buildId: string, itemId: string) => Promise<void>",
    "parameters": [
      {
        "name": "buildId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "itemId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "build:dismiss-content-update"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getStatsOverview",
    "signature": "(range?: StatsRange) => Promise<StatsOverview>",
    "parameters": [
      {
        "name": "range",
        "optional": true,
        "type": "StatsRange"
      }
    ],
    "channels": [
      "stats:overview"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onStatsUpdated",
    "signature": "(callback: () => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "() => void"
      }
    ],
    "channels": [
      "stats:updated"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onSettingsUpdated",
    "signature": "(callback: (data: { key: string; value: string }) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { key: string; value: string }) => void"
      }
    ],
    "channels": [
      "settings:updated"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "scanStorage",
    "signature": "() => Promise<StorageScanResult>",
    "parameters": [],
    "channels": [
      "storage:scan"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cleanStorage",
    "signature": "(target: StorageCleanTarget) => Promise<StorageCleanResult>",
    "parameters": [
      {
        "name": "target",
        "optional": false,
        "type": "StorageCleanTarget"
      }
    ],
    "channels": [
      "storage:clean"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "openExternal",
    "signature": "(url: string) => Promise<void>",
    "parameters": [
      {
        "name": "url",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "shell:open-external"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "openLauncherFolder",
    "signature": "() => Promise<void>",
    "parameters": [],
    "channels": [
      "shell:open-launcher-folder"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "openPath",
    "signature": "(dirPath: string) => Promise<void>",
    "parameters": [
      {
        "name": "dirPath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "shell:open-path"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "avatarGetTextures",
    "signature": "(username: string, options?: { uuid?: string; type?: string; randomuuid?: string }) => Promise<{ SKIN?: { url: string }; CAPE?: { url: string } } | null>",
    "parameters": [
      {
        "name": "username",
        "optional": false,
        "type": "string"
      },
      {
        "name": "options",
        "optional": true,
        "type": "{ uuid?: string; type?: string; randomuuid?: string }"
      }
    ],
    "channels": [
      "avatar:get-textures"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "avatarGetHead",
    "signature": "(options: { username: string; size?: number; uuid?: string; type?: string; randomuuid?: string }) => Promise<{ success: boolean; dataUrl?: string; error?: string }>",
    "parameters": [
      {
        "name": "options",
        "optional": false,
        "type": "{ username: string; size?: number; uuid?: string; type?: string; randomuuid?: string }"
      }
    ],
    "channels": [
      "avatar:get-head"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "avatarGetSkin",
    "signature": "(username: string, options?: { uuid?: string; type?: string; randomuuid?: string }) => Promise<{ success: boolean; dataUrl?: string; error?: string }>",
    "parameters": [
      {
        "name": "username",
        "optional": false,
        "type": "string"
      },
      {
        "name": "options",
        "optional": true,
        "type": "{ uuid?: string; type?: string; randomuuid?: string }"
      }
    ],
    "channels": [
      "avatar:get-skin"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "avatarGetCape",
    "signature": "(username: string, options?: { uuid?: string; type?: string; randomuuid?: string }) => Promise<{ success: boolean; dataUrl?: string; error?: string }>",
    "parameters": [
      {
        "name": "username",
        "optional": false,
        "type": "string"
      },
      {
        "name": "options",
        "optional": true,
        "type": "{ uuid?: string; type?: string; randomuuid?: string }"
      }
    ],
    "channels": [
      "avatar:get-cape"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "avatarInvalidateCache",
    "signature": "(params?: { username?: string; uuid?: string; type?: string }) => Promise<{ success: boolean }>",
    "parameters": [
      {
        "name": "params",
        "optional": true,
        "type": "{ username?: string; uuid?: string; type?: string }"
      }
    ],
    "channels": [
      "avatar:invalidate-cache"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "detectJavaInstallations",
    "signature": "(force?: boolean) => Promise<JavaDetectResult[]>",
    "parameters": [
      {
        "name": "force",
        "optional": true,
        "type": "boolean"
      }
    ],
    "channels": [
      "java:detect"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "pickJavaFile",
    "signature": "() => Promise<string | null>",
    "parameters": [],
    "channels": [
      "java:pick-file"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentComplete",
    "signature": "(request: import(\"./agent-types.js\").AgentTurnRequest) => Promise<import(\"./agent-types.js\").AgentTurnResult>",
    "parameters": [
      {
        "name": "request",
        "optional": false,
        "type": "import(\"./agent-types.js\").AgentTurnRequest"
      }
    ],
    "channels": [
      "agent:complete"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentCancel",
    "signature": "(requestId: string) => Promise<void>",
    "parameters": [
      {
        "name": "requestId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "agent:cancel"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentSetArchived",
    "signature": "(id: string, archived: boolean) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "archived",
        "optional": false,
        "type": "boolean"
      }
    ],
    "channels": [
      "agent:set-archived"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentListChats",
    "signature": "() => Promise<import(\"./agent-types.js\").AgentChatSummary[]>",
    "parameters": [],
    "channels": [
      "agent:list-chats"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentGetChat",
    "signature": "(id: string) => Promise<import(\"./agent-types.js\").AgentChat | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "agent:get-chat"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentSaveChat",
    "signature": "(chat: import(\"./agent-types.js\").AgentChat) => Promise<void>",
    "parameters": [
      {
        "name": "chat",
        "optional": false,
        "type": "import(\"./agent-types.js\").AgentChat"
      }
    ],
    "channels": [
      "agent:save-chat"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentDeleteChat",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "agent:delete-chat"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentBuildFile",
    "signature": "(request: import(\"./agent-types.js\").AgentBuildFileRequest) => Promise<{ entries?: string[]; content?: string; success: boolean }>",
    "parameters": [
      {
        "name": "request",
        "optional": false,
        "type": "import(\"./agent-types.js\").AgentBuildFileRequest"
      }
    ],
    "channels": [
      "agent:build-file"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "agentBuildDestination",
    "signature": "(name: string, excludeBuildId?: string) => Promise<{ path: string; available: boolean }>",
    "parameters": [
      {
        "name": "name",
        "optional": false,
        "type": "string"
      },
      {
        "name": "excludeBuildId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "agent:build-destination"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onAgentDelta",
    "signature": "(callback: (data: { requestId: string; text: string }) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { requestId: string; text: string }) => void"
      }
    ],
    "channels": [
      "agent:delta"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "agentHardware",
    "signature": "() => Promise<import(\"./agent-types.js\").AgentHardware>",
    "parameters": [],
    "channels": [
      "agent:hardware"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getAiConfig",
    "signature": "() => Promise<import(\"./agent-types.js\").AiConfig>",
    "parameters": [],
    "channels": [
      "ai:get-config"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "saveAiConfig",
    "signature": "(config: import(\"./agent-types.js\").AiConfig) => Promise<void>",
    "parameters": [
      {
        "name": "config",
        "optional": false,
        "type": "import(\"./agent-types.js\").AiConfig"
      }
    ],
    "channels": [
      "ai:save-config"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "listAiModels",
    "signature": "(override?: import(\"./agent-types.js\").AiModelDiscovery) => Promise<{ success: boolean; models?: string[]; error?: string }>",
    "parameters": [
      {
        "name": "override",
        "optional": true,
        "type": "import(\"./agent-types.js\").AiModelDiscovery"
      }
    ],
    "channels": [
      "ai:list-models"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "analyzeCrash",
    "signature": "(logContent: string) => Promise<{ success: boolean; analysis?: string; error?: string }>",
    "parameters": [
      {
        "name": "logContent",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "ai:analyze-crash"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "analyzeCrashStream",
    "signature": "(requestId: string, logContent: string) => Promise<{ success: boolean; analysis?: string; error?: string }>",
    "parameters": [
      {
        "name": "requestId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "logContent",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "ai:analyze-crash-stream"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onAiStreamChunk",
    "signature": "(callback: (data: { requestId: string; content: string }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { requestId: string; content: string }) => void"
      }
    ],
    "channels": [
      "ai:stream-chunk"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onAiStreamDone",
    "signature": "(callback: (data: { requestId: string; fullText: string }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { requestId: string; fullText: string }) => void"
      }
    ],
    "channels": [
      "ai:stream-done"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onAiStreamError",
    "signature": "(callback: (data: { requestId: string; error: string }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { requestId: string; error: string }) => void"
      }
    ],
    "channels": [
      "ai:stream-error"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "listWorlds",
    "signature": "(buildName: string) => Promise<WorldInfo[]>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:list"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "renameWorld",
    "signature": "(buildName: string, folder: string, newName: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      },
      {
        "name": "newName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:rename"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "copyWorld",
    "signature": "(buildName: string, folder: string, newName: string) => Promise<{ success: boolean; folder?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      },
      {
        "name": "newName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:copy"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importWorldZip",
    "signature": "(buildName: string, localFilePath: string, newName?: string) => Promise<{ success: boolean; folder?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "localFilePath",
        "optional": false,
        "type": "string"
      },
      {
        "name": "newName",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:import-zip"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "importWorldRemote",
    "signature": "(buildName: string, url: string, preferredName?: string) => Promise<{ success: boolean; folder?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "url",
        "optional": false,
        "type": "string"
      },
      {
        "name": "preferredName",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:import-remote"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "deleteWorld",
    "signature": "(buildName: string, folder: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:delete"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "setWorldIcon",
    "signature": "(buildName: string, folder: string, dataUrl: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      },
      {
        "name": "dataUrl",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:set-icon"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "resetWorldIcon",
    "signature": "(buildName: string, folder: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:reset-icon"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "listWorldDatapacks",
    "signature": "(buildName: string, folder: string) => Promise<DatapackInfo[]>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:list-datapacks"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "installDatapackRemote",
    "signature": "(buildName: string, folder: string, url: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      },
      {
        "name": "url",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:install-datapack-remote"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "installDatapackLocal",
    "signature": "(buildName: string, folder: string, localFilePath: string) => Promise<{ success: boolean; path?: string; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      },
      {
        "name": "localFilePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:install-datapack-local"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "deleteWorldDatapack",
    "signature": "(buildName: string, folder: string, fileName: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folder",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "worlds:delete-datapack"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "listScreenshots",
    "signature": "(buildName: string) => Promise<ScreenshotInfo[]>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "screenshots:list"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "getScreenshot",
    "signature": "(buildName: string, fileName: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "screenshots:get"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "deleteScreenshot",
    "signature": "(buildName: string, fileName: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "screenshots:delete"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "renameScreenshot",
    "signature": "(buildName: string, fileName: string, newName: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "newName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "screenshots:rename"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudListProviders",
    "signature": "() => Promise<Array<{ id: string; name: string }>>",
    "parameters": [],
    "channels": [
      "cloud:list-providers"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudConnect",
    "signature": "(providerId: string, authData?: Record<string, string>) => Promise<{ success: boolean; provider?: string; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "authData",
        "optional": true,
        "type": "Record<string, string>"
      }
    ],
    "channels": [
      "cloud:connect"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudIsConnected",
    "signature": "(providerId: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:is-connected"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudDisconnect",
    "signature": "(providerId: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:disconnect"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudListFiles",
    "signature": "(providerId: string, folderPath?: string) => Promise<{ success: boolean; files?: Array<{ id: string; name: string; size: number; modifiedAt?: string; path: string; isDir: boolean; category?: string; themePreview?: Theme }>; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "folderPath",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:list-files"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudDownloadFile",
    "signature": "(providerId: string, remotePath: string, localPath: string) => Promise<{ success: boolean; localPath?: string; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "remotePath",
        "optional": false,
        "type": "string"
      },
      {
        "name": "localPath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:download-file"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudDeleteFile",
    "signature": "(providerId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "remotePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:delete-file"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudGetQuota",
    "signature": "(providerId: string) => Promise<{ used: number; total: number } | null>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:get-quota"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudUploadBuild",
    "signature": "(providerId: string, buildName: string, uploadId?: string, categories?: CloudUploadCategory[]) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "buildName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "uploadId",
        "optional": true,
        "type": "string"
      },
      {
        "name": "categories",
        "optional": true,
        "type": "CloudUploadCategory[]"
      }
    ],
    "channels": [
      "cloud:upload-build"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudUploadServer",
    "signature": "(providerId: string, serverId: string, serverName: string, uploadId?: string, categories?: CloudUploadCategory[]) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "serverId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "serverName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "uploadId",
        "optional": true,
        "type": "string"
      },
      {
        "name": "categories",
        "optional": true,
        "type": "CloudUploadCategory[]"
      }
    ],
    "channels": [
      "cloud:upload-server"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onCloudUploadProgress",
    "signature": "(callback: (data: { id: string; percent: number; stage: \"zip\" | \"upload\" }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { id: string; percent: number; stage: \"zip\" | \"upload\" }) => void"
      }
    ],
    "channels": [
      "cloud:upload-progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "getFilePath",
    "signature": "(file: File) => string",
    "parameters": [
      {
        "name": "file",
        "optional": false,
        "type": "File"
      }
    ],
    "channels": [],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudUploadTheme",
    "signature": "(providerId: string, themeId: string, uploadId?: string) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "themeId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "uploadId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:upload-theme"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudImportTheme",
    "signature": "(providerId: string, remotePath: string) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "remotePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "cloud:import-theme"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudUploadAccount",
    "signature": "(providerId: string, account: { id: string; type: string; username: string; uuid?: string }) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "account",
        "optional": false,
        "type": "{ id: string; type: string; username: string; uuid?: string }"
      }
    ],
    "channels": [
      "cloud:upload-account"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "cloudDownloadAndImport",
    "signature": "(providerId: string, remotePath: string, fileType: string, selectedCategories?: string[]) => Promise<{ success: boolean; error?: string; account?: { id: string; type: string; username: string; uuid?: string } }>",
    "parameters": [
      {
        "name": "providerId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "remotePath",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileType",
        "optional": false,
        "type": "string"
      },
      {
        "name": "selectedCategories",
        "optional": true,
        "type": "string[]"
      }
    ],
    "channels": [
      "cloud:download-and-import"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsGetProfile",
    "signature": "(accountId?: string) => Promise<McProfile | null>",
    "parameters": [
      {
        "name": "accountId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "skins:get-profile"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsDeleteSkin",
    "signature": "(accountId?: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "accountId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "skins:delete-skin"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsSetCape",
    "signature": "(capeId: string | null, accountId?: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "capeId",
        "optional": false,
        "type": "string | null"
      },
      {
        "name": "accountId",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "skins:set-cape"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsListLibrary",
    "signature": "(accountId: string) => Promise<LibrarySkin[]>",
    "parameters": [
      {
        "name": "accountId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "skins:list-library"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsSaveToLibrary",
    "signature": "(filePath: string, name: string, variant: \"classic\" | \"slim\", accountId: string, capeId?: string | null) => Promise<LibrarySkin | null>",
    "parameters": [
      {
        "name": "filePath",
        "optional": false,
        "type": "string"
      },
      {
        "name": "name",
        "optional": false,
        "type": "string"
      },
      {
        "name": "variant",
        "optional": false,
        "type": "\"classic\" | \"slim\""
      },
      {
        "name": "accountId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "capeId",
        "optional": true,
        "type": "string | null"
      }
    ],
    "channels": [
      "skins:save-to-library"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsDeleteFromLibrary",
    "signature": "(id: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "skins:delete-from-library"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsUpdateVariant",
    "signature": "(id: string, variant: \"classic\" | \"slim\", capeId?: string | null, name?: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "variant",
        "optional": false,
        "type": "\"classic\" | \"slim\""
      },
      {
        "name": "capeId",
        "optional": true,
        "type": "string | null"
      },
      {
        "name": "name",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "skins:update-variant"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "skinsApplyLibrarySkin",
    "signature": "(skinId: string, accountId: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "skinId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "accountId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "skins:apply-library-skin"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "labyCatalog",
    "signature": "(page: number, size?: number, order?: LabyOrder, tags?: string[] | null, query?: string | null) => Promise<LabyCatalogPage>",
    "parameters": [
      {
        "name": "page",
        "optional": false,
        "type": "number"
      },
      {
        "name": "size",
        "optional": true,
        "type": "number"
      },
      {
        "name": "order",
        "optional": true,
        "type": "LabyOrder"
      },
      {
        "name": "tags",
        "optional": true,
        "type": "string[] | null"
      },
      {
        "name": "query",
        "optional": true,
        "type": "string | null"
      }
    ],
    "channels": [
      "laby:catalog"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "labyTags",
    "signature": "(locale?: string) => Promise<LabyTag[]>",
    "parameters": [
      {
        "name": "locale",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "laby:tags"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "labySimilar",
    "signature": "(hash: string, tags: string[], slim: boolean) => Promise<LabySkin[]>",
    "parameters": [
      {
        "name": "hash",
        "optional": false,
        "type": "string"
      },
      {
        "name": "tags",
        "optional": false,
        "type": "string[]"
      },
      {
        "name": "slim",
        "optional": false,
        "type": "boolean"
      }
    ],
    "channels": [
      "laby:similar"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "labyPlayer",
    "signature": "(username: string) => Promise<LabyPlayer | null>",
    "parameters": [
      {
        "name": "username",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "laby:player"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "labySaveToLibrary",
    "signature": "(hash: string, accountId: string, name?: string, slim?: boolean) => Promise<LabyImportResult>",
    "parameters": [
      {
        "name": "hash",
        "optional": false,
        "type": "string"
      },
      {
        "name": "accountId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "name",
        "optional": true,
        "type": "string"
      },
      {
        "name": "slim",
        "optional": true,
        "type": "boolean"
      }
    ],
    "channels": [
      "laby:save-to-library"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "labyApply",
    "signature": "(hash: string, accountId: string, name?: string, slim?: boolean) => Promise<LabyImportResult>",
    "parameters": [
      {
        "name": "hash",
        "optional": false,
        "type": "string"
      },
      {
        "name": "accountId",
        "optional": false,
        "type": "string"
      },
      {
        "name": "name",
        "optional": true,
        "type": "string"
      },
      {
        "name": "slim",
        "optional": true,
        "type": "boolean"
      }
    ],
    "channels": [
      "laby:apply"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "readLocalFile",
    "signature": "(filePath: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "filePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "read-local-file"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "quickPlayList",
    "signature": "(buildName?: string, gameDir?: string) => Promise<QuickPlayEntry[]>",
    "parameters": [
      {
        "name": "buildName",
        "optional": true,
        "type": "string"
      },
      {
        "name": "gameDir",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "quickplay:list"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "quickPlayClear",
    "signature": "(buildName?: string, gameDir?: string) => Promise<void>",
    "parameters": [
      {
        "name": "buildName",
        "optional": true,
        "type": "string"
      },
      {
        "name": "gameDir",
        "optional": true,
        "type": "string"
      }
    ],
    "channels": [
      "quickplay:clear"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "quickPlayRemove",
    "signature": "(buildName: string | undefined, gameDir: string | undefined, entry: QuickPlayEntry) => Promise<void>",
    "parameters": [
      {
        "name": "buildName",
        "optional": false,
        "type": "string | undefined"
      },
      {
        "name": "gameDir",
        "optional": false,
        "type": "string | undefined"
      },
      {
        "name": "entry",
        "optional": false,
        "type": "QuickPlayEntry"
      }
    ],
    "channels": [
      "quickplay:remove"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerList",
    "signature": "() => Promise<McServerInfo[]>",
    "parameters": [],
    "channels": [
      "mc-server:list"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerGet",
    "signature": "(id: string) => Promise<McServerInfo | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:get"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerCreate",
    "signature": "(data: { name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string }) => Promise<McServerInfo>",
    "parameters": [
      {
        "name": "data",
        "optional": false,
        "type": "{ name: string; gameVersion: string; modloader?: string; modloaderVersion?: string; port?: number; javaPath?: string; relayEnabled?: boolean; xmx?: number; xms?: number; onlineMode?: boolean; maxPlayers?: number; customJarPath?: string; icon?: string }"
      }
    ],
    "channels": [
      "mc-server:create"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerInstallPack",
    "signature": "(params: { source: \"modrinth\" | \"curseforge\"; projectSlug?: string; versionId?: string; modId?: number; fileId?: number; name?: string; icon?: string; port?: number; xmx?: number; xms?: number; extraJavaArgs?: string; javaPath?: string; relayEnabled?: boolean; onlineMode?: boolean; maxPlayers?: number }) => Promise<McServerInfo>",
    "parameters": [
      {
        "name": "params",
        "optional": false,
        "type": "{ source: \"modrinth\" | \"curseforge\"; projectSlug?: string; versionId?: string; modId?: number; fileId?: number; name?: string; icon?: string; port?: number; xmx?: number; xms?: number; extraJavaArgs?: string; javaPath?: string; relayEnabled?: boolean; onlineMode?: boolean; maxPlayers?: number }"
      }
    ],
    "channels": [
      "mc-server:install-pack"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerAnalyzeJar",
    "signature": "(jarPath: string) => Promise<{ minecraftVersion: string | null; loaderId: string | null; loaderLabel: string | null; modId: string | null; mainClass: string | null; error?: string }>",
    "parameters": [
      {
        "name": "jarPath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:analyze-jar"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerUpdate",
    "signature": "(id: string, update: Record<string, unknown>) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "update",
        "optional": false,
        "type": "Record<string, unknown>"
      }
    ],
    "channels": [
      "mc-server:update"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerDelete",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:delete"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerRestore",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:restore"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerListTrash",
    "signature": "() => Promise<McServerInfo[]>",
    "parameters": [],
    "channels": [
      "mc-server:list-trash"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerPurgeTrash",
    "signature": "(deleteTunnel?: boolean) => Promise<void>",
    "parameters": [
      {
        "name": "deleteTunnel",
        "optional": true,
        "type": "boolean"
      }
    ],
    "channels": [
      "mc-server:purge-trash"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerPermanentDelete",
    "signature": "(id: string, deleteTunnel?: boolean) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "deleteTunnel",
        "optional": true,
        "type": "boolean"
      }
    ],
    "channels": [
      "mc-server:permanent-delete"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerExportZip",
    "signature": "(id: string, serverName: string, categories?: string[]) => Promise<{ success: boolean; path?: string; error?: string }>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "serverName",
        "optional": false,
        "type": "string"
      },
      {
        "name": "categories",
        "optional": true,
        "type": "string[]"
      }
    ],
    "channels": [
      "mc-server:export-zip"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerDuplicate",
    "signature": "(id: string) => Promise<McServerInfo | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:duplicate"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerStart",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:start"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerStop",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:stop"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerKill",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:kill"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerSendCommand",
    "signature": "(id: string, command: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "command",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:send-command"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerStatus",
    "signature": "(id: string) => Promise<McServerState>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:status"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerMetricsSubscribe",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:metrics-subscribe"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerMetricsUnsubscribe",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:metrics-unsubscribe"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onMcServerMetrics",
    "signature": "(callback: (data: { id: string; metrics: McServerMetrics }) => void) => CleanupFn",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { id: string; metrics: McServerMetrics }) => void"
      }
    ],
    "channels": [
      "mc-server:metrics"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "mcServerLogs",
    "signature": "(id: string) => Promise<string[]>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:logs"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerInstallState",
    "signature": "(id: string) => Promise<{ installing: boolean; progress: { phase: string; percent?: number; bytesTotal?: number; bytesDownloaded?: number; message: string } | null }>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:install-state"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerOpenFolder",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:open-folder"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerReadProperties",
    "signature": "(id: string) => Promise<Record<string, string> | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:read-properties"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerWriteProperties",
    "signature": "(id: string, properties: Record<string, string>) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "properties",
        "optional": false,
        "type": "Record<string, string>"
      }
    ],
    "channels": [
      "mc-server:write-properties"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerGetWhitelist",
    "signature": "(id: string) => Promise<McPlayerEntry[]>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:get-whitelist"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerAddWhitelist",
    "signature": "(id: string, username: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "username",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:add-whitelist"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerRemoveWhitelist",
    "signature": "(id: string, uuid: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "uuid",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:remove-whitelist"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerGetOps",
    "signature": "(id: string) => Promise<McPlayerEntry[]>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:get-ops"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerAddOp",
    "signature": "(id: string, username: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "username",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:add-op"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerRemoveOp",
    "signature": "(id: string, uuid: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "uuid",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:remove-op"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerGetBanned",
    "signature": "(id: string) => Promise<McPlayerEntry[]>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:get-banned"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerBanPlayer",
    "signature": "(id: string, username: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "username",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:ban-player"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerUnbanPlayer",
    "signature": "(id: string, uuid: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "uuid",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:unban-player"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerGetBannedIps",
    "signature": "(id: string) => Promise<McPlayerEntry[]>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:get-banned-ips"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerBanIp",
    "signature": "(id: string, ip: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "ip",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:ban-ip"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerUnbanIp",
    "signature": "(id: string, ip: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "ip",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:unban-ip"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerGetAddresses",
    "signature": "(id: string) => Promise<{ local: string; public: string | null; custom: string } | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:get-addresses"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerCheckEula",
    "signature": "(id: string) => Promise<boolean>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:check-eula"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerAcceptEula",
    "signature": "(id: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:accept-eula"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerFsList",
    "signature": "(id: string, relativePath: string) => Promise<McFsEntry[]>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "relativePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:fs-list"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerFsRead",
    "signature": "(id: string, relativePath: string) => Promise<string | null>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "relativePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:fs-read"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerFsWrite",
    "signature": "(id: string, relativePath: string, content: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "relativePath",
        "optional": false,
        "type": "string"
      },
      {
        "name": "content",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:fs-write"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerFsDelete",
    "signature": "(id: string, relativePath: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "relativePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:fs-delete"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerFsRename",
    "signature": "(id: string, oldPath: string, newPath: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "oldPath",
        "optional": false,
        "type": "string"
      },
      {
        "name": "newPath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:fs-rename"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerFsMkdir",
    "signature": "(id: string, relativePath: string) => Promise<void>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "relativePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:fs-mkdir"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerFsDownload",
    "signature": "(id: string, relativePath: string, url: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "relativePath",
        "optional": false,
        "type": "string"
      },
      {
        "name": "url",
        "optional": false,
        "type": "string"
      },
      {
        "name": "fileName",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:fs-download"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "mcServerResolveInstalled",
    "signature": "(id: string, relativePath: string) => Promise<Array<{ name: string; sha1: string; projectId?: string; versionId?: string }>>",
    "parameters": [
      {
        "name": "id",
        "optional": false,
        "type": "string"
      },
      {
        "name": "relativePath",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "mc-server:resolve-installed"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "xnConnectAuthorize",
    "signature": "() => Promise<boolean>",
    "parameters": [],
    "channels": [
      "xn-connect:authorize"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "xnConnectStart",
    "signature": "(serverId: string) => Promise<XnConnectState>",
    "parameters": [
      {
        "name": "serverId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "xn-connect:start"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "xnConnectStop",
    "signature": "(serverId: string) => Promise<void>",
    "parameters": [
      {
        "name": "serverId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "xn-connect:stop"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "xnConnectStatus",
    "signature": "(serverId: string) => Promise<XnConnectState>",
    "parameters": [
      {
        "name": "serverId",
        "optional": false,
        "type": "string"
      }
    ],
    "channels": [
      "xn-connect:status"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "xnConnectUsage",
    "signature": "() => Promise<XnConnectUsage | null>",
    "parameters": [],
    "channels": [
      "xn-connect:usage"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onXnConnectUsage",
    "signature": "(callback: (usage: XnConnectUsage) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(usage: XnConnectUsage) => void"
      }
    ],
    "channels": [
      "xn-connect:usage-updated"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onXnConnectState",
    "signature": "(callback: (data: { serverId: string; state: XnConnectState }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { serverId: string; state: XnConnectState }) => void"
      }
    ],
    "channels": [
      "xn-connect:state"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onXnConnectLog",
    "signature": "(callback: (data: { serverId: string; line: string }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { serverId: string; line: string }) => void"
      }
    ],
    "channels": [
      "xn-connect:log"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onXnConnectAuthState",
    "signature": "(callback: (data: { state: XnConnectState }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { state: XnConnectState }) => void"
      }
    ],
    "channels": [
      "xn-connect:auth-state"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onMcServerLog",
    "signature": "(callback: (data: { id: string; line: string }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { id: string; line: string }) => void"
      }
    ],
    "channels": [
      "mc-server:log"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onMcServerStateChange",
    "signature": "(callback: (data: { id: string; state: McServerState }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { id: string; state: McServerState }) => void"
      }
    ],
    "channels": [
      "mc-server:state-change"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onMcServerDownloadProgress",
    "signature": "(callback: (data: { id: string; progress: { phase: string; percent?: number; bytesTotal?: number; bytesDownloaded?: number; message: string } }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(data: { id: string; progress: { phase: string; percent?: number; bytesTotal?: number; bytesDownloaded?: number; message: string } }) => void"
      }
    ],
    "channels": [
      "mc-server:download-progress"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "updateCheck",
    "signature": "() => Promise<{ available: boolean; version?: string; error?: string }>",
    "parameters": [],
    "channels": [
      "update:check"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "updateDownload",
    "signature": "() => Promise<{ success: boolean; error?: string }>",
    "parameters": [],
    "channels": [
      "update:download"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "updateInstall",
    "signature": "() => Promise<void>",
    "parameters": [],
    "channels": [
      "update:install"
    ],
    "event": false,
    "callable": true
  },
  {
    "method": "onUpdateStatus",
    "signature": "(callback: (status: { status: string; version?: string; releaseDate?: string; releaseNotes?: string; error?: string }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(status: { status: string; version?: string; releaseDate?: string; releaseNotes?: string; error?: string }) => void"
      }
    ],
    "channels": [
      "update:status"
    ],
    "event": true,
    "callable": true
  },
  {
    "method": "onUpdateProgress",
    "signature": "(callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void",
    "parameters": [
      {
        "name": "callback",
        "optional": false,
        "type": "(progress: { percent: number; transferred: number; total: number }) => void"
      }
    ],
    "channels": [
      "update:progress"
    ],
    "event": true,
    "callable": true
  }
]
export const UNBRIDGED_IPC_CHANNELS = []
export const IPC_CHANNELS = ["startup:ready","startup:theme-cache","system:get-total-memory","auth:elyby-login","auth:elyby-device-start","auth:elyby-device-poll","auth:xnskins-login","auth:xnskins-device-start","auth:xnskins-device-poll","auth:microsoft-login","auth:microsoft-device-start","auth:microsoft-device-poll","authlib:list-servers","authlib:probe-server","authlib:add-server","authlib:remove-server","authlib:refresh-server","authlib:login","authlib:ensure-session","authlib:invalidate","authlib:get-profile-textures","fetch:minecraft-news","fetch:launcher-news","db:load-accounts","db:save-account","db:remove-account","db:load-builds-light","db:load-build-content","build:fetch-missing-mods","db:save-builds","db:insert-build","db:update-build-fields","db:is-fallback-storage","db:reorder-accounts","build:scan-intent-content","build:get-intent-path","build:get-instances-root","common:pick-folder","common:pick-file","theme:read-media","theme:pick-media","theme:local-list","theme:local-import","theme:local-save","theme:local-delete","theme:local-export","theme:open-directory","build:set-instances-root","build:save-mod-to-intent","build:save-local-mod-to-intent","build:read-local-content-metadata","build:classify-drop-paths","build:save-content-to-intent","build:save-local-content-to-intent","build:delete-content-from-intent","build:set-content-enabled","build:set-intent-path","build:prune-loader-profiles","build:delete-intent","build:import-modrinth","build:import-curseforge","build:import-ftb","build:open-and-import","build:cancel-import","build:copy","build:rename-intent","build:export-zip","build:export-modlist","build:move-intent-to-trash","build:restore-intent-from-trash","build:purge-trash","build:list-trash","build:delete-trash-item","build:check-content-updates","build:get-content-updates-cache","build:get-content-updates-counts","build:dismiss-content-update","stats:overview","storage:scan","storage:clean","agent:complete","agent:hardware","agent:cancel","agent:set-archived","agent:list-chats","agent:get-chat","agent:save-chat","agent:delete-chat","agent:build-file","agent:build-destination","ai:get-config","ai:save-config","ai:list-models","ai:analyze-crash","ai:analyze-crash-stream","launcher:discover-importable-instances","launcher:discover-from-path","launcher:import-gdlauncher-instances","launcher:import-instances","mods:modrinth-search","mods:modrinth-details","mods:modrinth-versions","mods:curseforge-search","mods:curseforge-details","mods:curseforge-download-url","mods:curseforge-changelog","mods:resolve-dependencies","mods:inspect-jar-dependencies","mods:check-loader-requirements","mods:ftb-search","mods:ftb-catalog-facets","mods:ftb-details","mods:ftb-changelog","mods:modrinth-categories","mods:curseforge-categories","minecraft:get-versions","minecraft:get-latest-release","minecraft:get-fabric-versions","minecraft:get-fabric-supported","minecraft:get-liteloader-versions","minecraft:get-liteloader-recommended","minecraft:get-liteloader-supported","minecraft:get-quilt-versions","minecraft:get-quilt-supported","minecraft:get-optifine-versions","minecraft:get-optifine-recommended","minecraft:get-optifine-supported","minecraft:get-neoforge-versions","minecraft:get-neoforge-recommended","minecraft:get-neoforge-supported","minecraft:get-forge-versions","minecraft:get-forge-recommended","minecraft:get-forge-supported","minecraft:get-custom-versions","minecraft:get-paper-versions","minecraft:get-paper-supported","minecraft:get-purpur-versions","minecraft:get-purpur-supported","minecraft:get-folia-versions","minecraft:get-folia-supported","minecraft:get-velocity-versions","minecraft:get-velocity-supported","minecraft:get-waterfall-versions","minecraft:get-waterfall-supported","minecraft:get-sponge-versions","minecraft:get-sponge-supported","minecraft:set-offline-auth","minecraft:get-game-dir","minecraft:get-auth","minecraft:launch","minecraft:stop","minecraft:is-running","settings:get","settings:set","worlds:list","worlds:rename","worlds:delete","worlds:set-icon","worlds:list-datapacks","worlds:install-datapack-remote","worlds:install-datapack-local","worlds:delete-datapack","worlds:import-zip","worlds:import-remote","worlds:copy","worlds:reset-icon","screenshots:list","screenshots:get","screenshots:delete","screenshots:rename","shell:open-external","shell:open-launcher-folder","shell:open-path","servers:list","servers:write-dat","servers:ping","quickplay:list","quickplay:clear","quickplay:remove","update:check","update:download","update:install","read-local-file","skins:get-profile","skins:delete-skin","skins:set-cape","skins:list-library","skins:save-to-library","skins:delete-from-library","skins:update-variant","skins:apply-library-skin","laby:catalog","laby:tags","laby:similar","laby:player","laby:save-to-library","laby:apply","avatar:get-textures","avatar:get-head","avatar:get-skin","avatar:get-cape","avatar:invalidate-cache","java:detect","java:pick-file","cloud:list-providers","cloud:connect","cloud:is-connected","cloud:disconnect","cloud:list-files","cloud:download-file","cloud:delete-file","cloud:get-quota","cloud:upload-theme","cloud:import-theme","cloud:upload-build","cloud:upload-server","cloud:upload-account","cloud:download-and-import","xn-connect:authorize","xn-connect:start","xn-connect:stop","xn-connect:status","xn-connect:usage","mc-server:list","mc-server:get","mc-server:create","mc-server:analyze-jar","mc-server:update","mc-server:delete","mc-server:restore","mc-server:list-trash","mc-server:purge-trash","mc-server:permanent-delete","mc-server:export-zip","mc-server:duplicate","mc-server:start","mc-server:stop","mc-server:kill","mc-server:send-command","mc-server:status","mc-server:metrics-subscribe","mc-server:metrics-unsubscribe","mc-server:logs","mc-server:install-state","mc-server:open-folder","mc-server:read-properties","mc-server:write-properties","mc-server:get-whitelist","mc-server:add-whitelist","mc-server:remove-whitelist","mc-server:get-ops","mc-server:add-op","mc-server:remove-op","mc-server:get-banned","mc-server:ban-player","mc-server:unban-player","mc-server:get-banned-ips","mc-server:ban-ip","mc-server:unban-ip","mc-server:get-addresses","mc-server:check-eula","mc-server:accept-eula","mc-server:fs-list","mc-server:fs-read","mc-server:fs-write","mc-server:fs-delete","mc-server:fs-rename","mc-server:fs-mkdir","mc-server:fs-download","mc-server:resolve-installed","mc-server:install-pack","theme:local-changed","minecraft:java-progress","minecraft:debug","minecraft:data","minecraft:download-progress","minecraft:close","import:progress","build:export-progress","content:download-progress","cloud:upload-progress","mc-server:download-progress","mc-server:log","mc-server:state-change","mc-server:metrics","xn-connect:usage-updated","xn-connect:state","xn-connect:log","xn-connect:auth-state","ai:stream-chunk","agent:delta","ai:stream-done","ai:stream-error","update:status","update:progress","cli:launch-build","stats:updated","authlib:login-progress","settings:updated"]
