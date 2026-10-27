import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { AuthManager } from "./auth/auth-manager.js";
import { getAuthlibInjectorAllowedHosts } from "./config.js";
import { URLS } from "./constants/urls.js";
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
  customVersionPath?: string;
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
  customVersionPath?: string;
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

/** Минимальный размер валидного JAR — отсекает пустые и оборванные файлы. */
const MIN_JAR_BYTES = 1024;

/** Таймаут загрузки JAR, мс: без него fetch мог висеть бесконечно. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Таймаут запроса «последней версии» (latest.json / GitHub API), мс. */
const VERSION_LOOKUP_TIMEOUT_MS = 10_000;

/** Файл похож на ZIP/JAR: сигнатура "PK" и минимальный размер. */
function looksLikeJar(filePath: string, size: number): boolean {
  if (size < MIN_JAR_BYTES) return false;
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const header = Buffer.alloc(4);
    const read = readSync(fd, header, 0, header.length, 0);
    return read >= 2 && header[0] === 0x50 && header[1] === 0x4b;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * fetch с таймаутом и, если передан, внешней отменой (например «Стоп»
 * во время подготовки запуска).
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Скачивает файл, если его нет или он битый.
 *
 * Загрузка идёт во временный файл рядом и подменяет цель через rename:
 * оборванная загрузка больше не оставляет «половину» JAR на месте рабочего
 * файла. Сигнатуру ("PK") проверяем и у скачанного, и у уже лежащего файла —
 * раньше хватало size > 0, поэтому обрезанный JAR считался валидным навсегда.
 */
async function ensureDownloadedFile(
  filePath: string,
  url: string,
  label: string,
  signal?: AbortSignal,
): Promise<string> {
  if (existsSync(filePath)) {
    if (looksLikeJar(filePath, statSync(filePath).size)) {
      return filePath;
    }
    try {
      unlinkSync(filePath);
    } catch {
      // Не смогли удалить — перезапись через rename ниже всё равно исправит файл.
    }
  }

  ensureParentDir(filePath);
  const tempPath = `${filePath}.part`;

  try {
    const response = await fetchWithTimeout(url, { redirect: "follow" }, DOWNLOAD_TIMEOUT_MS, signal);
    if (!response.ok) {
      throw new Error(`${label} download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < MIN_JAR_BYTES || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new Error(`${label} download returned an invalid archive (${buffer.length} bytes)`);
    }

    writeFileSync(tempPath, buffer);
    renameSync(tempPath, filePath);
    return filePath;
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // ignore
    }
    throw error;
  }
}

/** URL загрузки JAR доверенный: только https и только известный хост (см. config.ts). */
function isTrustedAuthlibInjectorDownloadUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return getAuthlibInjectorAllowedHosts().includes(parsed.hostname.toLowerCase());
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

export async function resolveLatestAuthlibInjectorUrl(): Promise<string> {
  const root = URLS.official.authlibInjector?.root || "https://authlib-injector.yushi.moe";
  try {
    const res = await fetchWithTimeout(
      `${root.replace(/\/$/, "")}/artifact/latest.json`,
      {},
      VERSION_LOOKUP_TIMEOUT_MS,
    );
    if (res.ok) {
      const data = (await res.json()) as { download_url?: string };
      // download_url приходит от удалённого хоста — принимаем только https
      // и только известные хосты, иначе падаем на пиннутый URL ниже.
      if (data?.download_url && isTrustedAuthlibInjectorDownloadUrl(data.download_url)) {
        return data.download_url;
      }
    }
  } catch {
    // fallback
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest",
      { headers: { "User-Agent": "XNLauncher" } },
      VERSION_LOOKUP_TIMEOUT_MS,
    );
    if (res.ok) {
      const data = (await res.json()) as { assets?: Array<{ browser_download_url?: string; name?: string }> };
      const jarAsset = data.assets?.find((a) => a.name?.endsWith(".jar"));
      if (jarAsset?.browser_download_url && isTrustedAuthlibInjectorDownloadUrl(jarAsset.browser_download_url)) {
        return jarAsset.browser_download_url;
      }
    }
  } catch {
    // fallback
  }

  return "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar";
}

export async function ensureAuthlibInjector(rootPath: string, signal?: AbortSignal): Promise<string> {
  const filePath = path.join(rootPath, "authlib-injector.jar");
  if (existsSync(filePath) && looksLikeJar(filePath, statSync(filePath).size)) {
    return filePath;
  }
  const downloadUrl = await resolveLatestAuthlibInjectorUrl();
  return ensureDownloadedFile(
    filePath,
    downloadUrl,
    "authlib-injector",
    signal,
  );
}

export async function ensureRetroAuthInjector(rootPath: string, signal?: AbortSignal): Promise<string> {
  return ensureDownloadedFile(
    path.join(rootPath, "retroauth-injector.jar"),
    "https://github.com/MAINER4IK/RetroAuth-injector/releases/download/1.0.2/retroauth-injector-1.0.2.jar",
    "retroauth-injector",
    signal,
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
    custom: "custom",
  };

  return {
    mcVersion,
    loaderType: options.loaderType ?? (options.modLoader ? modLoaderToLoaderType[options.modLoader] : "vanilla"),
    loaderVersion: options.loaderVersion,
    customVersionPath: options.customVersionPath,
    memoryMin: options.memoryMin ?? "512M",
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
