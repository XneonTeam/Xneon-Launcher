import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { AuthManager } from "./auth/auth-manager.js";
import type {
  AuthSession,
  OfflineAuth,
  LoaderType,
  VersionJson,
  LaunchAuth
} from "./types/index.js";

export type LaunchRequestOptions = {
  mcVersion?: string;
  version?: string;
  modLoader?: string;
  loaderType?: LoaderType;
  loaderVersion?: string;
  memoryMin?: string;
  memoryMax?: string;
  javaPath?: string;
  width?: number;
  height?: number;
};

export type ResolvedLaunchRequest = {
  mcVersion: string;
  loaderType: LoaderType;
  loaderVersion?: string;
  memoryMin: string;
  memoryMax: string;
  javaPath?: string;
  width: number;
  height: number;
};

export type MinecraftRootOptions = {
  platform?: NodeJS.Platform;
  homeDir: string;
  appDataDir?: string;
  launcherDirName?: string;
};

export type MinecraftRootEnvOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  launcherDirName?: string;
};

export type AuthorizationAccount = {
  type: string;
  accessToken?: string;
  uuid?: string;
  username: string;
};

export type XnlcHandlerLike = {
  getVersions(): Promise<Array<{ id: string; type: string }>>;
};

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function ensureDownloadedFile(filePath: string, url: string, label: string): Promise<string> {
  if (existsSync(filePath) && statSync(filePath).size > 0) {
    return filePath;
  }

  ensureParentDir(filePath);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} download failed: ${response.status} ${response.statusText}`);
  }

  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  return filePath;
}

export function getDefaultMinecraftRoot(options: MinecraftRootOptions): string {
  const platform = options.platform ?? process.platform;
  const launcherDirName = options.launcherDirName ?? "xneonlauncher";

  if (platform === "win32") {
    const appDataDir = options.appDataDir ?? path.join(options.homeDir, "AppData", "Roaming");
    return path.join(appDataDir, launcherDirName, "minecraft");
  }

  if (platform === "darwin") {
    return path.join(options.homeDir, "Library", "Application Support", launcherDirName, "minecraft");
  }

  return path.join(options.homeDir, `.${launcherDirName}`, "minecraft");
}

export function getDefaultMinecraftRootFromEnv(options: MinecraftRootEnvOptions = {}): string {
  const env = options.env ?? process.env;
  return getDefaultMinecraftRoot({
    platform: options.platform,
    launcherDirName: options.launcherDirName,
    homeDir: (options.platform ?? process.platform) === "win32" ? env.USERPROFILE ?? env.HOME ?? "" : env.HOME ?? "",
    appDataDir: env.APPDATA,
  });
}

export async function ensureAuthlibInjector(rootPath: string): Promise<string> {
  return ensureDownloadedFile(
    path.join(rootPath, "authlib-injector.jar"),
    "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.7/authlib-injector-1.2.7.jar",
    "authlib-injector",
  );
}

export async function ensureRetroAuthInjector(rootPath: string): Promise<string> {
  return ensureDownloadedFile(
    path.join(rootPath, "retroauth-injector.jar"),
    "https://github.com/MAINER4IK/RetroAuth-injector/releases/download/1.0.2/retroauth-injector-1.0.2.jar",
    "retroauth-injector",
  );
}

export function createLaunchAuth(account: AuthorizationAccount): LaunchAuth {
  if (account.type === "offline") {
    return AuthManager.createOfflineAuth(account.username);
  }

  return {
    mode: "microsoft",
    username: account.username,
    uuid: account.uuid ?? account.username,
    accessToken: account.accessToken ?? "0",
  };
}

export function resolveLaunchRequest(options: LaunchRequestOptions): ResolvedLaunchRequest | { error: string } {
  const mcVersion = options.mcVersion ?? options.version;
  if (!mcVersion) {
    return { error: "No Minecraft version specified" };
  }

  const modLoaderToLoaderType: Record<string, LoaderType> = {
    vanilla: "vanilla",
    forge: "forge",
    neoforge: "neoforge",
    fabric: "fabric",
    liteloader: "liteloader",
    quilt: "quilt",
    optifine: "optifine",
  };

  return {
    mcVersion,
    loaderType: options.loaderType ?? (options.modLoader ? modLoaderToLoaderType[options.modLoader] : "vanilla"),
    loaderVersion: options.loaderVersion,
    memoryMin: options.memoryMin ?? "2G",
    memoryMax: options.memoryMax ?? "4G",
    javaPath: options.javaPath,
    width: options.width ?? 1280,
    height: options.height ?? 720,
  };
}

export async function collectSupportedVersions(
  handler: XnlcHandlerLike,
  resolver: (handler: XnlcHandlerLike, versionId: string) => Promise<unknown[]>,
  limit = 30,
): Promise<string[]> {
  const mcVersions = await handler.getVersions();
  const supported: string[] = [];

  for (const mc of mcVersions.slice(0, limit)) {
    try {
      const versions = await resolver(handler, mc.id);
      if (versions.length > 0) {
        supported.push(mc.id);
      }
    } catch {
      // skip unsupported versions
    }
  }

  return supported;
}
