import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawnSync } from "child_process";
import { Downloader } from "./downloader.js";
import { DownloadJob, DownloadTask } from "./downloader.js";
import { URLS } from "../constants/urls.js";
import type { VersionJsonJavaVersion } from "../types/index.js";
import { ensureDirSync } from "../utils/sync.js";

const MOJANG_RUNTIME_MANIFEST = URLS.official.mojang.javaRuntime;

export interface JavaRuntime {
  path: string;
  version: number;
  vendor: string;
}

interface MojangManifestFile {
  downloads: {
    raw?: { sha1: string; size: number; url: string };
    lzma?: { sha1: string; size: number; url: string };
  };
  executable: boolean;
  type: string;
}

interface MojangManifest {
  files: Record<string, MojangManifestFile>;
}

interface MojangComponentEntry {
  manifest: {
    sha1: string;
    size: number;
    url: string;
  };
  version: { name: string; released: string };
  availability: { group: number; progress: number };
}

type MojangAllManifest = Record<string, Record<string, MojangComponentEntry[]>>;

const VERSION_TO_COMPONENT: Record<number, string> = {
  8: "jre-legacy",
  16: "java-runtime-alpha",
  17: "java-runtime-gamma",
  21: "java-runtime-delta",
};

function getComponentName(requiredVersion: number, javaVersion?: VersionJsonJavaVersion): string {
  if (javaVersion?.component) {
    return javaVersion.component;
  }
  const major = javaVersion?.majorVersion ?? requiredVersion;
  return VERSION_TO_COMPONENT[major] ?? "java-runtime-epsilon";
}

function getMojangPlatformKey(): string | null {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "win32") {
    if (arch === "x64") return "windows-x64";
    if (arch === "x86" as string) return "windows-x86";
    if (arch === "arm64") return "windows-arm64";
    return "windows-x64";
  }

  if (platform === "darwin") {
    if (arch === "arm64" || arch === ("aarch64" as string)) return "mac-os-arm64";
    return "mac-os";
  }

  if (platform === "linux") {
    if (arch === "x64") return "linux";
    if (arch === "x86" as string) return "linux-i386";
    return null;
  }

  return null;
}

export class JavaManager {
  constructor(
    private downloader: Downloader,
    private gameDir: string,
  ) {}

  detectJavaVersion(javaPath: string = "java"): number {
    try {
      const result = spawnSync(javaPath, ["-version"], {
        encoding: "utf-8",
        shell: false,
      });
      const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
      const match = output.match(/version "(.*?)"/);
      if (match) {
        const parts = match[1]!.split(".");
        const major = parseInt(parts[0]!, 10);
        if (major === 1) {
          return parseInt(parts[1]!, 10);
        }
        return major;
      }
    } catch {
      // Java not found
    }
    return 0;
  }

  async findOrDownloadJava(
    requiredVersion: number,
    userJavaPath?: string,
    onProgress?: (pct: number) => void,
    javaVersion?: VersionJsonJavaVersion,
  ): Promise<JavaRuntime> {
    // 1. Check user-provided path
    if (userJavaPath) {
      const version = this.detectJavaVersion(userJavaPath);
      if (this.isJavaCompatible(version, requiredVersion)) {
        return { path: userJavaPath, version, vendor: "user" };
      }
    }

    // 2. Check previously downloaded Mojang runtime
    const downloadedRuntime = this.getDownloadedRuntime(requiredVersion, javaVersion);
    if (downloadedRuntime) {
      return downloadedRuntime;
    }

    // 3. Check system PATH
    const systemVersion = this.detectJavaVersion("java");
    if (this.isJavaCompatible(systemVersion, requiredVersion)) {
      return { path: "java", version: systemVersion, vendor: "system" };
    }

    // 4. Download from Mojang (or fall back to Azul Zulu)
    return this.downloadJava(requiredVersion, onProgress, javaVersion);
  }

  private isJavaCompatible(actualVersion: number, requiredVersion: number): boolean {
    if (requiredVersion <= 8) {
      return actualVersion === requiredVersion;
    }
    return actualVersion >= requiredVersion;
  }

  private getRuntimeBaseDir(): string {
    return path.join(this.gameDir, "runtime");
  }

  private getDownloadedRuntime(
    requiredVersion: number,
    javaVersion?: VersionJsonJavaVersion,
  ): JavaRuntime | null {
    const platformKey = getMojangPlatformKey();
    if (!platformKey) return null;

    const component = getComponentName(requiredVersion, javaVersion);
    const runtimeDir = path.join(this.getRuntimeBaseDir(), platformKey, component);
    const javaPath = this.findJavaBinary(runtimeDir);
    if (!javaPath) return null;

    const version = this.detectJavaVersion(javaPath);
    if (this.isJavaCompatible(version, requiredVersion)) {
      return { path: javaPath, version, vendor: "mojang" };
    }
    return null;
  }

  private async downloadJava(
    version: number,
    onProgress?: (pct: number) => void,
    javaVersion?: VersionJsonJavaVersion,
  ): Promise<JavaRuntime> {
    const platformKey = getMojangPlatformKey();
    const component = getComponentName(version, javaVersion);

    // Try Mojang runtime first
    if (platformKey) {
      try {
        return await this.downloadMojangRuntime(platformKey, component, version, onProgress);
      } catch (err) {
        console.warn(`[JavaManager] Failed to download Mojang runtime ${platformKey}/${component}: ${err}`);
        // Fall through to Azul Zulu
      }
    }

    // Fallback: Azul Zulu with standard directory structure
    return this.downloadAzulRuntime(version, component, onProgress);
  }

  private async downloadMojangRuntime(
    platformKey: string,
    component: string,
    requiredVersion: number,
    onProgress?: (pct: number) => void,
  ): Promise<JavaRuntime> {
    const runtimeDir = path.join(this.getRuntimeBaseDir(), platformKey, component);
    ensureDirSync(runtimeDir);

    // 1. Fetch all.json to get component manifest URL
    const allRes = await fetch(MOJANG_RUNTIME_MANIFEST);
    if (!allRes.ok) {
      throw new Error(`Failed to fetch Java runtime manifest: HTTP ${allRes.status}`);
    }
    const allManifest = await allRes.json() as MojangAllManifest;

    const platformEntries = allManifest[platformKey];
    if (!platformEntries) {
      throw new Error(`No Java runtime entries for platform ${platformKey}`);
    }

    const componentEntries = platformEntries[component];
    if (!componentEntries || componentEntries.length === 0) {
      throw new Error(`No Java runtime entries for ${platformKey}/${component}`);
    }

    // Pick the latest entry
    const latestEntry = componentEntries.reduce((best, entry) => {
      const bestDate = Date.parse(best.version.released);
      const entryDate = Date.parse(entry.version.released);
      return entryDate > bestDate ? entry : best;
    });

    // 2. Fetch component manifest
    const manifestRes = await fetch(latestEntry.manifest.url);
    if (!manifestRes.ok) {
      throw new Error(`Failed to fetch component manifest: HTTP ${manifestRes.status}`);
    }
    const manifest = await manifestRes.json() as MojangManifest;

    // 3. Download all files
    const fileEntries = Object.entries(manifest.files).filter(
      ([, fileEntry]) => fileEntry.type === "file" && fileEntry.downloads?.raw,
    );

    const job = new DownloadJob(`java-runtime-${component}`, 5);
    let totalBytes = 0;

    for (const [filePath, fileEntry] of fileEntries) {
      const raw = fileEntry.downloads.raw!;
      const dest = path.join(runtimeDir, filePath);
      totalBytes += raw.size;
      job.addTask({
        url: raw.url,
        sha1: raw.sha1,
        size: raw.size,
        dest,
        skipIfExists: true,
      });
    }

    if (fileEntries.length === 0) {
      throw new Error(`No downloadable files in manifest for ${platformKey}/${component}`);
    }

    let downloadedBytes = 0;
    if (onProgress) {
      for (const task of job["tasks"] as DownloadTask[]) {
        const originalOnProgress = task.options.onProgress;
        task.options.onProgress = (p) => {
          if (originalOnProgress) originalOnProgress(p);
          downloadedBytes += (p.downloaded ?? 0) - (p.total ?? 0) > 0 ? 0 : 0; // placeholder
        };
      }
    }

    await job.execute();

    // Set executable flags on unix
    if (os.platform() !== "win32") {
      for (const [filePath, fileEntry] of fileEntries) {
        if (fileEntry.executable) {
          const fullPath = path.join(runtimeDir, filePath);
          if (fs.existsSync(fullPath)) {
            try { fs.chmodSync(fullPath, 0o755); } catch {}
          }
        }
      }
    }

    // 4. Find java binary
    const javaPath = this.findJavaBinary(runtimeDir);
    if (!javaPath) {
      throw new Error(`Could not find java binary in Mojang runtime ${platformKey}/${component}`);
    }

    const detectedVersion = this.detectJavaVersion(javaPath);
    return { path: javaPath, version: detectedVersion, vendor: "mojang" };
  }

  private async downloadAzulRuntime(
    version: number,
    component: string,
    onProgress?: (pct: number) => void,
  ): Promise<JavaRuntime> {
    const platformKey = getMojangPlatformKey() ?? "unknown";
    const runtimeDir = path.join(this.getRuntimeBaseDir(), platformKey, component);
    ensureDirSync(runtimeDir);

    const osInfo = this.getPlatformInfo();
    const downloadUrl = await this.getAzulDownloadUrl(version, osInfo);

    if (!downloadUrl) {
      throw new Error(
        `Could not find Java ${version} for ${osInfo.os}-${osInfo.arch}. ` +
        `Please install Java ${version}+ manually and set --java-path.`,
      );
    }

    const fileName = path.basename(new URL(downloadUrl).pathname);
    const archivePath = path.join(this.getRuntimeBaseDir(), fileName);

    console.log(`Downloading Java ${version} from Azul Zulu...`);
    await this.downloader.download({
      url: downloadUrl,
      dest: archivePath,
      onProgress: onProgress
        ? (p) => onProgress(p.percent ?? 0)
        : undefined,
    });

    console.log(`Extracting Java ${version}...`);
    await this.extractArchive(archivePath, runtimeDir);
    fs.unlinkSync(archivePath);

    const javaPath = this.findJavaBinary(runtimeDir);
    if (!javaPath) {
      throw new Error(`Could not find java binary in extracted runtime`);
    }

    if (os.platform() !== "win32") {
      fs.chmodSync(javaPath, 0o755);
    }

    const detectedVersion = this.detectJavaVersion(javaPath);
    return { path: javaPath, version: detectedVersion, vendor: "azul" };
  }

  private async getAzulDownloadUrl(
    version: number,
    platform: { os: string; arch: string },
  ): Promise<string | null> {
    try {
      const expectedExt = platform.os === "windows" ? ".zip" : ".tar.gz";
      const query = new URLSearchParams({
        java_version: String(version),
        os: platform.os,
        arch: platform.arch,
        bundle_type: "jdk",
        ext: expectedExt.slice(1),
        latest: "true",
      });

      const url = `${URLS.official.azul.metadataApi}/?${query.toString()}`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const data = await res.json() as Array<Record<string, unknown>>;
      if (!Array.isArray(data) || data.length === 0) return null;

      const preferred = data.find((asset) => {
        const downloadUrl = asset?.["download_url"];
        return typeof downloadUrl === "string" && downloadUrl.endsWith(expectedExt);
      });

      const fallback = data.find((asset) => {
        const downloadUrl = asset?.["download_url"];
        return typeof downloadUrl === "string" && (downloadUrl.endsWith(".zip") || downloadUrl.endsWith(".tar.gz") || downloadUrl.endsWith(".tgz"));
      });

      return (preferred?.["download_url"] as string)
        ?? (fallback?.["download_url"] as string)
        ?? null;
    } catch {
      return null;
    }
  }

  private async extractArchive(archivePath: string, destDir: string): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });

    if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
      const result = spawnSync("tar", ["-xzf", archivePath, "-C", destDir, "--strip-components=1"], {
        stdio: "inherit",
        shell: false,
      });
      if (result.status !== 0) {
        throw new Error(`Failed to extract archive: ${archivePath}`);
      }
    } else if (archivePath.endsWith(".zip")) {
      const AdmZip = (await import("adm-zip/adm-zip.js")).default;
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(destDir, true);
      const entries = fs.readdirSync(destDir);
      if (entries.length === 1 && fs.statSync(path.join(destDir, entries[0]!)).isDirectory()) {
        const nestedDir = path.join(destDir, entries[0]!);
        const nestedEntries = fs.readdirSync(nestedDir);
        for (const entry of nestedEntries) {
          fs.renameSync(path.join(nestedDir, entry), path.join(destDir, entry));
        }
        fs.rmdirSync(nestedDir);
      }
    } else {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
  }

  private findJavaBinary(rootDir: string): string | null {
    const isWin = os.platform() === "win32";
    const javaName = isWin ? "java.exe" : "java";

    const standardPath = path.join(rootDir, "bin", javaName);
    if (fs.existsSync(standardPath)) return standardPath;

    try {
      const entries = fs.readdirSync(rootDir);
      for (const entry of entries) {
        const fullPath = path.join(rootDir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          const binPath = path.join(fullPath, "bin", javaName);
          if (fs.existsSync(binPath)) return binPath;
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  private getPlatformInfo(): { os: string; arch: string } {
    const platform = os.platform();
    const arch = os.arch();

    let osName: string;
    if (platform === "linux") osName = "linux";
    else if (platform === "darwin") osName = "mac";
    else if (platform === "win32") osName = "windows";
    else {
      console.warn(`Unknown platform: ${platform}, defaulting to linux`);
      osName = "linux";
    }

    let archName: string;
    if (arch === "x64") archName = "x86_64";
    else if (arch === "arm64" || arch === ("aarch64" as string)) archName = "aarch64";
    else if (arch === "arm") archName = "arm";
    else {
      console.warn(`Unknown architecture: ${arch}, defaulting to x86_64`);
      archName = "x86_64";
    }

    return { os: osName, arch: archName };
  }
}
