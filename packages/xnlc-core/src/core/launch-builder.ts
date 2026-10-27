import * as path from "path";
import * as fs from "fs";
import {
  VersionJson,
  ResolvedLibrary,
  OSInfo,
  LaunchAuth,
} from "../types/index.js";
import {
  getLibraryDir,
  getNativesDir,
  libraryNameToPath,
  flattenVersionJsonArguments,
  tokenizeCommandLine
} from "../utils/index.js";
import { ensureLegacyBootstrap, LEGACY_MAIN_CLASS } from "./legacy-bootstrap.js";

export class LaunchBuilder {
  constructor(
    private gameDir: string,
    private osInfo: OSInfo,
    private launcherName: string = "xneonlauncher",
    private launcherVersion: string = "1.0.0",
    private resourceDir: string = gameDir
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
      clientJarPath?: string;
    }
  ): string[] {
    const { javaPath, memoryMin, memoryMax, width, height, extraJvmArgs = [], extraGameArgs = [] } = options;

    const nativesDir = getNativesDir(this.gameDir);
    const legacy = versionJson.traits?.includes("legacyLaunch") === true;
    const bootstrap = legacy ? ensureLegacyBootstrap(this.gameDir) : undefined;
    const classpath = this.buildClasspath(libraries, versionJson, options.clientJarPath, bootstrap);
    
    const jvmArgs = this.buildJvmArgs(versionJson, {
      nativesDir,
      classpath,
      memoryMin,
      memoryMax,
      extraJvmArgs
    });

    const gameArgs = this.buildGameArgs(versionJson, auth, {
      width,
      height,
      extraGameArgs
    });

    if (legacy) {
      const mainClass = versionJson.mainClass === "net.minecraft.launchwrapper.Launch"
        ? "net.minecraft.client.Minecraft" : versionJson.mainClass;
      return [javaPath, ...jvmArgs, LEGACY_MAIN_CLASS, mainClass,
        auth.profileName || auth.username, this.getSession(auth), String(width || 854), String(height || 480),
        versionJson.traits?.includes("noapplet") ? "-" : String(versionJson.appletClass || "net.minecraft.client.MinecraftApplet"),
        ...gameArgs];
    }
    return [javaPath, ...jvmArgs, versionJson.mainClass, ...gameArgs];
  }

  private buildClasspath(libraries: ResolvedLibrary[], versionJson: VersionJson, clientJarPath?: string, bootstrap?: string): string {
    const paths: string[] = bootstrap ? [bootstrap] : [];
    if (versionJson.jarMods?.length && !clientJarPath) throw new Error("Jar mods have not been prepared");

    // mavenFiles are download-only (ForgeWrapper finds them via its own file detector).
    // Adding them to classpath causes module split-package ResolutionException.
    const libs = libraries.filter(l => !l.isNative && l.includeInClasspath !== false && !l.downloadOnly);
    paths.push(...libs.map(l => l.path));

    // ForgeWrapper сам подключает пропатченный клиент после работы installer.
    // Ванильный JAR в системном classpath иначе затеняет исправленные классы.
    const usesForgeWrapper = versionJson.mainClass === "io.github.zekerzhayard.forgewrapper.installer.Main";
    if (!versionJson.traits?.includes("no_vjar") && !usesForgeWrapper) {
      const jarName = versionJson.jar || versionJson.inheritsFrom || versionJson.id;
      const versionJarPath = clientJarPath ?? path.join(this.resourceDir, "versions", jarName, `${jarName}.jar`);
      if (fs.existsSync(versionJarPath)) {
        paths.push(versionJarPath);
      }
      if (versionJson.xnlcJarIsOverlay && versionJson.inheritsFrom) {
        const base = versionJson.inheritsFrom;
        const parentJar = path.join(this.resourceDir, "versions", base, `${base}.jar`);
        if (!fs.existsSync(parentJar)) throw new Error(`Base client jar missing for overlay: ${parentJar}`);
        paths.push(parentJar);
      }
    }

    return Array.from(new Set(paths)).join(this.osInfo.os === "windows" ? ";" : ":");
  }

  private buildJvmArgs(versionJson: VersionJson, context: any): string[] {
    const args: string[] = [];

    if (context.memoryMin) args.push(`-Xms${context.memoryMin}`);
    if (context.memoryMax) args.push(`-Xmx${context.memoryMax}`);

    args.push("-Djava.library.path=" + context.nativesDir);
    args.push("-DlogLocation=" + path.join(this.gameDir, "logs"));
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
      // Памятью управляет только лаунчер: аргументы version.json добавляются ПОСЛЕ
      // наших -Xms/-Xmx, а JVM применяет последнее значение — поэтому чужой -Xmx из
      // JSON (например -Xmx4G в custom-версии через `+jvmArgs`) молча перебивал
      // настройку «Оперативная память». Такие аргументы отбрасываем.
      const jvmArgs = this.replacePlaceholderArgs(
        filtered,
        {
          classpath: typeof context.classpath === 'string' ? context.classpath.replace(/\\/g, '/') : context.classpath,
          natives_directory: context.nativesDir,
          library_directory: getLibraryDir(this.resourceDir),
          classpath_separator: this.osInfo.os === "windows" ? ";" : ":",
          launcher_name: this.launcherName,
          launcher_version: this.launcherVersion,
        }
      ).filter((arg) => !/^-Xm[sx]/.test(arg));
      args.push(...jvmArgs);
    }

    if (versionJson.traits?.includes("legacyFML") || versionJson.jarMods?.length) {
      args.push("-Dfml.ignoreInvalidMinecraftCertificates=true");
      args.push("-Dfml.ignorePatchDiscrepancies=true");
    }

    if (versionJson.agents) {
      for (const agent of versionJson.agents) {
        const libPath = agent.downloads?.artifact?.path || libraryNameToPath(agent.name);
        const fullPath = path.join(getLibraryDir(this.resourceDir), libPath);
        if (fs.existsSync(fullPath)) args.push(`-javaagent:${fullPath}`);
      }
    }

    args.push(...context.extraJvmArgs);
    // В сохранённых профилях ForgeWrapper могли остаться абсолютные пути до миграции.
    if (versionJson.mainClass === "io.github.zekerzhayard.forgewrapper.installer.Main") {
      for (let i = args.length - 1; i >= 0; i--) {
        if (/^-Dforgewrapper\.(minecraft|librariesDir)=/.test(args[i])) args.splice(i, 1);
      }
      const base = versionJson.jar ?? versionJson.xnlcBaseVersion ?? versionJson.inheritsFrom ?? versionJson.id;
      args.push(`-Dforgewrapper.minecraft=${path.join(this.resourceDir, "versions", base, `${base}.jar`)}`,
        `-Dforgewrapper.librariesDir=${getLibraryDir(this.resourceDir)}`);
    }
    // Единая кодировка stdout/stderr для Java 8 и современных JVM.
    args.push("-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8",
      "-Dsun.stdout.encoding=UTF-8", "-Dsun.stderr.encoding=UTF-8");
    return args;
  }

  private buildGameArgs(versionJson: VersionJson, auth: LaunchAuth, context: any): string[] {
    let args: string[] = [];

    if (versionJson.minecraftArguments) {
      args.push(...tokenizeCommandLine(versionJson.minecraftArguments));
    }

    if (versionJson.arguments?.game) {
      args.push(...flattenVersionJsonArguments(versionJson.arguments.game,
        { has_custom_resolution: Boolean(context.width || context.height) }, this.osInfo));
    }

    const placeholders = this.getPlaceholders(versionJson, auth, context);
    args = args.map(arg => this.replacePlaceholders(arg, placeholders));
    args.push(...context.extraGameArgs);

    // Разрешение задаётся настройками лаунчера, а не дублирующими флагами
    // профиля или дополнительных аргументов игры.
    const dimensions = new Map<string, number>();
    if (Number.isFinite(context.width) && context.width > 0) dimensions.set("width", Math.round(context.width));
    if (Number.isFinite(context.height) && context.height > 0) dimensions.set("height", Math.round(context.height));
    args = args.filter((arg, index, original) => {
      const match = arg.match(/^--?(width|height)(?:=.*)?$/);
      if (match && dimensions.has(match[1])) return false;
      const previous = original[index - 1]?.match(/^--?(width|height)$/);
      return !(previous && dimensions.has(previous[1]) && !arg.startsWith("-"));
    });
    if (!versionJson.traits?.includes("legacyLaunch")) {
      for (const [key, value] of dimensions) args.push(`--${key}`, String(value));
    }

    return args;
  }

  private getPlaceholders(versionJson: VersionJson, auth: LaunchAuth, context: any): Record<string, string> {
    const isOffline = auth.mode === "offline";
    return {
      auth_player_name: auth.profileName || auth.username,
      auth_uuid: auth.uuid,
      auth_access_token: auth.accessToken,
      auth_xuid: auth.xuid ?? "",
      clientid: auth.clientId ?? "",
      auth_session: this.getSession(auth),
      user_type: isOffline ? "legacy" : "msa",
      version_name: versionJson.id,
      game_directory: this.gameDir,
      assets_root: path.join(this.resourceDir, "assets"),
      assets_index_name: versionJson.assetIndex?.id || versionJson.assets || "legacy",
      game_assets: versionJson.assetIndex?.id === "pre-1.6" ? path.join(this.gameDir, "resources")
        : path.join(this.resourceDir, "assets", "virtual", versionJson.assetIndex?.id || versionJson.assets || "legacy"),
      version_type: String(versionJson.type),
      resolution_width: String(context.width || 854),
      resolution_height: String(context.height || 480),
      launcher_name: this.launcherName,
      launcher_version: this.launcherVersion,
      user_properties: auth.userProperties || "{}",
    };
  }

  private replacePlaceholders(arg: string, placeholders: Record<string, string>): string {
    return arg.replace(/\$\{([^}]+)\}/g, (match, p1) => placeholders[p1] ?? match);
  }

  private getSession(auth: LaunchAuth): string {
    return auth.mode === "offline" ? "-" : `token:${auth.accessToken}:${auth.uuid.replace(/-/g, "")}`;
  }

  private replacePlaceholderArgs(args: string[], placeholders: Record<string, string>): string[] {
    // Повторяющиеся значения могут относиться к разным ключам (-p, --add-opens).
    return args.map(arg => this.replacePlaceholders(arg, placeholders));
  }
}
