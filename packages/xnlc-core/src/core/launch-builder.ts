import * as path from "path";
import * as fs from "fs";
import {
  VersionJson,
  ResolvedLibrary,
  OSInfo,
  LaunchAuth,
  VersionJsonArguments,
  AssetIndex
} from "../types/index.js";
import {
  getLibraryDir,
  getNativesDir,
  getAssetObjectsDir,
  getAssetIndexDir,
  getVersionDir,
  libraryNameToPath,
  flattenVersionJsonArguments
} from "../utils/index.js";

export class LaunchBuilder {
  constructor(
    private gameDir: string,
    private osInfo: OSInfo,
    private launcherName: string = "xneonlauncher",
    private launcherVersion: string = "1.0.0"
  ) {}

  build(
    versionJson: VersionJson,
    libraries: ResolvedLibrary[],
    auth: LaunchAuth,
    options: {
      javaPath: string;
      memoryMin?: string;
      memoryMax?: string;
      width?: number;
      height?: number;
      extraJvmArgs?: string[];
      extraGameArgs?: string[];
    }
  ): string[] {
    const { javaPath, memoryMin, memoryMax, width, height, extraJvmArgs = [], extraGameArgs = [] } = options;

    const nativesDir = getNativesDir(this.gameDir);
    const classpath = this.buildClasspath(libraries, versionJson);
    
    const jvmArgs = this.buildJvmArgs(versionJson, {
      nativesDir,
      classpath,
      memoryMin,
      memoryMax,
      extraJvmArgs,
      javaVersion: 8
    });

    const gameArgs = this.buildGameArgs(versionJson, auth, {
      width,
      height,
      extraGameArgs
    });

    return [javaPath, ...jvmArgs, versionJson.mainClass, ...gameArgs];
  }

  private buildClasspath(libraries: ResolvedLibrary[], versionJson: VersionJson): string {
    const paths: string[] = [];

    if (versionJson.jarMods && versionJson.jarMods.length > 0) {
      for (const mod of versionJson.jarMods) {
        const libPath = mod.downloads?.artifact?.path || libraryNameToPath(mod.name);
        const fullPath = path.join(getLibraryDir(this.gameDir), libPath);
        if (fs.existsSync(fullPath)) {
          paths.push(fullPath);
        }
      }
    }

    // mavenFiles are download-only (ForgeWrapper finds them via its own file detector).
    // Adding them to classpath causes module split-package ResolutionException.
    const libs = libraries.filter(l => !l.isNative && l.includeInClasspath);
    paths.push(...libs.map(l => l.path));

    if (!versionJson.traits?.includes("no_vjar")) {
      const jarName = versionJson.jar || versionJson.id;
      const versionJarPath = path.join(this.gameDir, "versions", jarName, `${jarName}.jar`);
      if (fs.existsSync(versionJarPath)) {
        paths.push(versionJarPath);
      }
      if (versionJson.inheritsFrom) {
        const parentJarPath = path.join(this.gameDir, "versions", versionJson.inheritsFrom, `${versionJson.inheritsFrom}.jar`);
        if (fs.existsSync(parentJarPath)) {
          paths.push(parentJarPath);
        }
      }
    }

    return paths.join(path.delimiter);
  }

  private writeClasspathFile(classpath: string, versionId: string): string | null {
    if (classpath.length <= 8000) return null;

    const cpFile = path.join(getVersionDir(this.gameDir, versionId), "classpath.txt");
    fs.writeFileSync(cpFile, classpath, "utf-8");
    console.log(`[LaunchBuilder] Classpath written to file (${classpath.length} chars): ${cpFile}`);
    return cpFile;
  }

  private buildJvmArgs(versionJson: VersionJson, context: any): string[] {
    const args: string[] = [];

    if (context.memoryMin) args.push(`-Xms${context.memoryMin}`);
    if (context.memoryMax) args.push(`-Xmx${context.memoryMax}`);

    args.push("-Djava.library.path=" + context.nativesDir);
    args.push("-cp", context.classpath);

    if (versionJson.arguments?.jvm) {
      const rawJvmArgs = flattenVersionJsonArguments(versionJson.arguments.jvm, undefined, this.osInfo);
      const filtered: string[] = [];
      for (let i = 0; i < rawJvmArgs.length; i++) {
        if (rawJvmArgs[i] === "-cp" || rawJvmArgs[i] === "-classpath") {
          i++;
          continue;
        }
        filtered.push(rawJvmArgs[i]);
      }
      const jvmArgs = this.replacePlaceholderArgs(
        filtered,
        {
          classpath: typeof context.classpath === 'string' ? context.classpath.replace(/\\/g, '/') : context.classpath,
          natives_directory: context.nativesDir,
        }
      );
      args.push(...jvmArgs);
    }

    if (versionJson.traits?.includes("legacyFML")) {
      args.push("-Dfml.ignoreInvalidMinecraftCertificates=true");
    }

    if (versionJson.agents) {
      for (const agent of versionJson.agents) {
        const libPath = agent.downloads?.artifact?.path || libraryNameToPath(agent.name);
        const fullPath = path.join(getLibraryDir(this.gameDir), libPath);
        if (fs.existsSync(fullPath)) args.push(`-javaagent:${fullPath}`);
      }
    }

    args.push(...context.extraJvmArgs);
    return args;
  }

  private buildGameArgs(versionJson: VersionJson, auth: LaunchAuth, context: any): string[] {
    let args: string[] = [];

    if (versionJson.minecraftArguments) {
      args.push(...versionJson.minecraftArguments.split(" "));
    }

    if (versionJson.arguments?.game) {
      args.push(...flattenVersionJsonArguments(versionJson.arguments.game, undefined, this.osInfo));
    }

    const placeholders = this.getPlaceholders(versionJson, auth, context);
    args = args.map(arg => this.replacePlaceholders(arg, placeholders));
    args.push(...context.extraGameArgs);

    return args;
  }

  private getPlaceholders(versionJson: VersionJson, auth: LaunchAuth, context: any): Record<string, string> {
    const isOffline = auth.mode === "offline";
    return {
      auth_player_name: auth.profileName || auth.username,
      auth_uuid: auth.uuid,
      auth_access_token: auth.accessToken,
      auth_session: isOffline ? "-" : auth.accessToken,
      user_type: isOffline ? "offline" : "mojang",
      version_name: versionJson.id,
      game_directory: this.gameDir,
      assets_root: path.join(this.gameDir, "assets"),
      assets_index_name: versionJson.assetIndex?.id || versionJson.assets || "legacy",
      version_type: String(versionJson.type),
      resolution_width: String(context.width || 854),
      resolution_height: String(context.height || 480),
      launcher_name: this.launcherName,
      launcher_version: this.launcherVersion,
      user_properties: "{}",
    };
  }

  private replacePlaceholders(arg: string, placeholders: Record<string, string>): string {
    return arg.replace(/\$\{([^}]+)\}/g, (match, p1) => placeholders[p1] || match);
  }

  private replacePlaceholderArgs(args: string[], placeholders: Record<string, string>): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = this.replacePlaceholders(args[i], placeholders);
      const key = arg;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(arg);
      }
    }
    return deduped;
  }
}
