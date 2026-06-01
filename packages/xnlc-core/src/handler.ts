// ============================================================
// XNLC — Simple Handler API
// Easy-to-use wrapper for common launcher operations
// Author: MAINER4IK
// ============================================================

import { Xnlc } from './xnlc.js';
import type { LoaderType, LaunchAuth } from './types/index.js';
import { getDefaultMinecraftRootFromEnv } from './launch-utils.js';

// Simple ask function for interactive mode
async function ask(question: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

export interface HandlerOptions {
  gameDir?: string;
  javaPath?: string;
  memoryMax?: string;
  memoryMin?: string;
  width?: number;
  height?: number;
}

export interface DefaultHandlerOptions extends HandlerOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  launcherDirName?: string;
}

export interface LaunchOptions {
  mcVersion: string;
  loaderType?: LoaderType;
  loaderVersion?: string;
  javaPath?: string;
  memoryMin?: string;
  memoryMax?: string;
  width?: number;
  height?: number;
}

export interface VersionInfo {
  id: string;
  type: 'release' | 'snapshot' | 'old_alpha' | 'old_beta';
  url?: string;
  releaseTime?: string;
}

export interface ModLoaderInfo {
  version: string;
  stable?: boolean;
}

export function createDefaultHandler(options: DefaultHandlerOptions = {}): XnlcHandler {
  return new XnlcHandler({
    ...options,
    gameDir: options.gameDir ?? getDefaultMinecraftRootFromEnv(options),
  });
}

export class XnlcHandler {
  private xnlc: Xnlc;
  private auth: LaunchAuth | null = null;

  constructor(options: HandlerOptions = {}) {
    this.xnlc = new Xnlc({
      gameDir: options.gameDir ?? './minecraft',
      javaPath: options.javaPath,
      defaultJvmArgs: [],
    });
  }

  // ============ Version Info ============

  async getVersions(): Promise<VersionInfo[]> {
    return (await this.xnlc.getMojangVersions()) as VersionInfo[];
  }

  async getLatestRelease(): Promise<string> {
    return this.xnlc.getLatestRelease();
  }

  async getLatestSnapshot(): Promise<string> {
    return this.xnlc.getLatestSnapshot();
  }

  // ============ NeoForge ============

  async getNeoForgeVersions(mcVersion: string): Promise<string[]> {
    return this.xnlc.getNeoForgeVersions(mcVersion);
  }

  async getNeoForgeRecommended(mcVersion: string): Promise<string | undefined> {
    return this.xnlc.getNeoForgeRecommended(mcVersion);
  }

  // ============ Forge ============

  async getForgeVersions(mcVersion: string): Promise<string[]> {
    return this.xnlc.getForgeVersions(mcVersion);
  }

  async getForgeRecommended(mcVersion: string): Promise<string | undefined> {
    return this.xnlc.getForgeRecommended(mcVersion);
  }

  // ============ Fabric ============

  async getFabricGameVersions(): Promise<{ version: string; stable: boolean }[]> {
    const versions = await this.xnlc.getFabricGameVersions();
    return versions.map(v => ({ version: v, stable: true }));
  }

  async getFabricSupportedVersions(): Promise<string[]> {
    return this.xnlc.getFabricGameVersions();
  }

  async getFabricVersions(mcVersion: string): Promise<ModLoaderInfo[]> {
    const versions = await this.xnlc.getFabricLoaderVersions(mcVersion);
    return versions.map(v => ({
      version: v,
      stable: true,
    }));
  }

  // ============ Quilt ============

  async getQuiltGameVersions(): Promise<{ version: string; stable: boolean }[]> {
    const versions = await this.xnlc.getQuiltGameVersions();
    return versions.map(v => ({ version: v, stable: true }));
  }

  async getLiteLoaderVersions(mcVersion: string): Promise<ModLoaderInfo[]> {
    const versions = await this.xnlc.getLiteLoaderVersions(mcVersion);
    return versions.map((version) => ({
      version,
      stable: !version.includes("SNAPSHOT"),
    }));
  }

  async getLiteLoaderSupportedVersions(): Promise<string[]> {
    return this.xnlc.getLiteLoaderSupportedVersions();
  }

  async getLiteLoaderRecommended(mcVersion: string): Promise<string | undefined> {
    return this.xnlc.getLiteLoaderRecommended(mcVersion);
  }

  async getQuiltSupportedVersions(): Promise<string[]> {
    return this.xnlc.getQuiltGameVersions();
  }

  async getQuiltVersions(mcVersion: string): Promise<ModLoaderInfo[]> {
    const versions = await this.xnlc.getQuiltLoaderVersions(mcVersion);
    return versions.map(v => ({
      version: v,
      stable: !v.includes("-beta") && !v.includes("-pre") && !v.includes("-rc"),
    }));
  }

  // ============ NeoForge ============

  async getNeoForgeSupportedVersions(): Promise<string[]> {
    return this.xnlc.getNeoForgeSupportedVersions();
  }

  async getForgeSupportedVersions(): Promise<string[]> {
    return this.xnlc.getForgeSupportedVersions();
  }

  // ============ OptiFine ============

  async getOptifineSupportedVersions(): Promise<string[]> {
    return this.xnlc.getOptifineSupportedVersions();
  }

  // ============ OptiFine ============

  async getOptifineVersions(mcVersion: string): Promise<{ filename: string; isPreview: boolean }[]> {
    const versions = await this.xnlc.getOptifineVersions(mcVersion);
    return versions.map(v => ({
      filename: v.filename,
      isPreview: v.isPreview,
    }));
  }

  async getOptifineRecommended(mcVersion: string): Promise<{ filename: string } | undefined> {
    const version = await this.xnlc.getOptifineRecommended(mcVersion);
    if (!version) return undefined;
    return { filename: version.filename };
  }

  // ============ Custom Versions ============

  async getCustomVersions(): Promise<string[]> {
    return this.xnlc.getCustomVersions();
  }

  // ============ Authentication ============

  setOfflineAuth(username: string): void {
    this.auth = this.xnlc.createOfflineAuth(username);
  }

  getAuth(): LaunchAuth | null {
    return this.auth;
  }

  // ============ Launch ============

  async launch(options: LaunchOptions, onProgress?: (info: { percent: number; file: string }) => void): Promise<void> {
    if (!this.auth) {
      throw new Error('No authentication set. Use setOfflineAuth() first.');
    }

    await this.xnlc.launch(
      {
        mcVersion: options.mcVersion,
        loaderType: options.loaderType ?? 'vanilla',
        loaderVersion: options.loaderVersion,
      },
      this.auth,
      {
        javaPath: options.javaPath,
        memoryMin: options.memoryMin ?? '256M',
        memoryMax: options.memoryMax ?? '2G',
        width: options.width ?? 854,
        height: options.height ?? 480,
      },
      onProgress ? (p) => onProgress({ percent: p.percent ?? 0, file: p.fileName ?? '' }) : undefined
    );
  }

  // ============ Quick Launch Shortcuts ============

  async launchVanilla(mcVersion: string, username: string): Promise<void> {
    this.setOfflineAuth(username);
    await this.launch({ mcVersion, loaderType: 'vanilla' });
  }

  async launchFabric(mcVersion: string, fabricVersion: string, username: string): Promise<void> {
    this.setOfflineAuth(username);
    await this.launch({ mcVersion, loaderType: 'fabric', loaderVersion: fabricVersion });
  }

  async launchNeoForge(mcVersion: string, neoforgeVersion: string, username: string): Promise<void> {
    this.setOfflineAuth(username);
    await this.launch({ mcVersion, loaderType: 'neoforge', loaderVersion: neoforgeVersion });
  }

  async launchQuilt(mcVersion: string, quiltVersion: string, username: string): Promise<void> {
    this.setOfflineAuth(username);
    await this.launch({ mcVersion, loaderType: 'quilt', loaderVersion: quiltVersion });
  }

  async launchLiteLoader(mcVersion: string, liteloaderVersion: string, username: string): Promise<void> {
    this.setOfflineAuth(username);
    await this.launch({ mcVersion, loaderType: 'liteloader', loaderVersion: liteloaderVersion });
  }

  // ============ Interactive Launch ============

  async interactiveLaunch(username: string): Promise<void> {
    const loaders = [
      { id: 'vanilla', name: 'Vanilla', getVersions: async () => [] as string[] },
      { id: 'neoforge', name: 'NeoForge', getVersions: () => this.getNeoForgeSupportedVersions() },
      { id: 'fabric', name: 'Fabric', getVersions: () => this.getFabricSupportedVersions() },
      { id: 'liteloader', name: 'LiteLoader', getVersions: () => this.getLiteLoaderSupportedVersions() },
      { id: 'quilt', name: 'Quilt', getVersions: () => this.getQuiltSupportedVersions() },
      { id: 'optifine', name: 'OptiFine', getVersions: () => this.getOptifineSupportedVersions() },
    ];

    const loaderNames = loaders.map(l => l.name);
    const loaderInput = await ask('Select loader (1-' + loaderNames.length + '): ');
    const loaderIdx = parseInt(loaderInput) - 1;
    if (loaderIdx < 0 || loaderIdx >= loaders.length) {
      throw new Error('Invalid loader selection');
    }

    const selectedLoader = loaders[loaderIdx]!;
    const loaderType = selectedLoader.id as LoaderType;

    const mcVersions = await selectedLoader.getVersions();
    
    if (mcVersions.length === 0) {
      throw new Error(`No Minecraft versions support ${selectedLoader.name}`);
    }

    console.log(`\nSupported Minecraft versions for ${selectedLoader.name}:`);
    mcVersions.slice(0, 5).forEach((v, i) => console.log(`  ${i + 1}. ${v}`));
    if (mcVersions.length > 5) console.log(`  ... and ${mcVersions.length - 5} more`);

    const mcInput = await ask('\nSelect Minecraft version (number): ');
    const mcIdx = parseInt(mcInput) - 1;
    if (mcIdx < 0 || mcIdx >= mcVersions.length) {
      throw new Error('Invalid version selection');
    }
    const mcVersion = mcVersions[mcIdx]!;

    let loaderVersion: string | undefined;

    if (loaderType !== 'vanilla') {
      console.log(`\nFetching ${selectedLoader.name} versions for ${mcVersion}...`);
      
      if (loaderType === 'neoforge') {
        const versions = await this.getNeoForgeVersions(mcVersion);
        const recommended = await this.getNeoForgeRecommended(mcVersion);
        if (versions.length > 0) {
          loaderVersion = recommended ?? versions[versions.length - 1];
        }
      } else if (loaderType === 'fabric') {
        const versions = await this.getFabricVersions(mcVersion);
        const stable = versions.filter(v => v.stable);
        if (stable.length > 0) {
          loaderVersion = stable[stable.length - 1]!.version;
        }
      } else if (loaderType === 'liteloader') {
        const recommended = await this.getLiteLoaderRecommended(mcVersion);
        if (recommended) {
          loaderVersion = recommended;
        }
      } else if (loaderType === 'quilt') {
        const versions = await this.getQuiltVersions(mcVersion);
        const stable = versions.filter(v => v.stable);
        if (stable.length > 0) {
          loaderVersion = stable[stable.length - 1]!.version;
        }
      } else if (loaderType === 'optifine') {
        const recommended = await this.getOptifineRecommended(mcVersion);
        if (recommended) {
          loaderVersion = recommended.filename;
        }
      }
    }

    console.log(`\nLaunching: ${mcVersion}${loaderVersion ? ` + ${selectedLoader.name} ${loaderVersion}` : ''}`);

    this.setOfflineAuth(username);
    await this.launch({ mcVersion, loaderType, loaderVersion: loaderVersion! });
  }

  // ============ Direct Access ============

  getXnlc(): Xnlc {
    return this.xnlc;
  }
}

export default XnlcHandler;
