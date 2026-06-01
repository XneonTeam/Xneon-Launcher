import { ComponentData, VersionJson, VersionJsonArguments, VersionJsonLibrary } from "../types/index.js";

interface GradleParts {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
}

function parseGradleSpecifier(name: string): GradleParts | null {
  const normalized = name.replace(/@[^:]+$/, "");
  const parts = normalized.split(":");
  if (parts.length < 3) return null;
  return {
    groupId: parts[0],
    artifactId: parts[1],
    version: parts[2],
    classifier: parts[3],
  };
}

function matchName(a: GradleParts, b: GradleParts): boolean {
  return a.groupId === b.groupId && a.artifactId === b.artifactId && (a.classifier ?? "") === (b.classifier ?? "");
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split(/[^0-9]+/).filter(Boolean).map(Number);
  const bParts = b.split(/[^0-9]+/).filter(Boolean).map(Number);
  const maxLen = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLen; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}

export class ProfileBuilder {
  private minecraftVersion = "";
  private mainClass = "";
  private minecraftArguments?: string;
  private libraries: VersionJsonLibrary[] = [];
  private mavenFiles: VersionJsonLibrary[] = [];
  private agents: VersionJsonLibrary[] = [];
  private jarMods: VersionJsonLibrary[] = [];
  private mods: VersionJsonLibrary[] = [];
  private traits: string[] = [];
  private compatibleJavaMajors: number[] = [];
  private versionType = "";
  private downloads?: VersionJson["downloads"];
  private assetIndex?: VersionJson["assetIndex"];
  private javaVersion?: VersionJson["javaVersion"];
  private gameArgs: Array<string | any> = [];
  private jvmArgs: Array<string | any> = [];

  setMinecraftBase(baseJson: Partial<Pick<VersionJson, "downloads" | "assetIndex" | "javaVersion" | "type">>): void {
    if (baseJson.downloads) this.downloads = baseJson.downloads;
    if (baseJson.assetIndex) this.assetIndex = baseJson.assetIndex;
    if (baseJson.javaVersion) this.javaVersion = baseJson.javaVersion;
    if (baseJson.type) this.versionType = baseJson.type;
  }

  applyComponent(component: ComponentData): void {
    if (component.mainClass) this.mainClass = component.mainClass;
    if (component.minecraftArguments) this.minecraftArguments = component.minecraftArguments;

    // Arguments: collect both game and jvm args (may contain rule objects)
    if (component.arguments?.game) {
      this.gameArgs.push(...component.arguments.game);
    }
    if (component.arguments?.jvm) {
      this.jvmArgs.push(...component.arguments.jvm);
    }

    // +jvmArgs / +gameArgs (always flat strings)
    if (component.jvmArgs) {
      this.jvmArgs.push(...component.jvmArgs);
    }
    if (component.gameArgs) {
      this.gameArgs.push(...component.gameArgs);
    }

    // Tweakers (+tweakers)
    if (component.tweakers) {
      for (const tweaker of component.tweakers) {
        this.gameArgs.push("--tweakClass", tweaker);
      }
    }

    if (component.jarMods) {
      this.jarMods.push(...component.jarMods);
    }

    if (component.mods) {
      this.mods.push(...component.mods);
    }

    if (component.traits) {
      this.traits.push(...component.traits);
    }

    if (component.compatibleJavaMajors) {
      this.compatibleJavaMajors.push(...component.compatibleJavaMajors);
    }

    const allLibs = [...(component.libraries ?? []), ...(component.plusLibraries ?? [])];
    for (const lib of allLibs) {
      this.applyLibrary(lib);
    }

    if (component.mavenFiles) {
      this.mavenFiles.push(...component.mavenFiles);
    }

    if (component.agents) {
      this.agents.push(...component.agents);
    }
  }

  private applyLibrary(lib: VersionJsonLibrary): void {
    const parsed = parseGradleSpecifier(lib.name);
    if (!parsed) {
      this.libraries.push(lib);
      return;
    }

    const existingIndex = this.libraries.findIndex((existing) => {
      const existingParsed = parseGradleSpecifier(existing.name);
      if (!existingParsed) return false;
      return matchName(parsed, existingParsed);
    });

    if (existingIndex < 0) {
      this.libraries.push(lib);
    } else {
      const existing = this.libraries[existingIndex];
      const existingParsed = parseGradleSpecifier(existing.name);
      if (existingParsed && compareVersions(parsed.version, existingParsed.version) > 0) {
        this.libraries[existingIndex] = lib;
      }
    }
  }

  build(): VersionJson {
    const arguments_: VersionJsonArguments = {};
    if (this.gameArgs.length > 0) arguments_.game = this.gameArgs;
    if (this.jvmArgs.length > 0) arguments_.jvm = this.jvmArgs;

    const versionJson: VersionJson = {
      id: this.minecraftVersion,
      mainClass: this.mainClass || "net.minecraft.client.main.Main",
      type: this.versionType || "modified",
      libraries: this.libraries,
      arguments: (arguments_.game || arguments_.jvm) ? arguments_ : undefined,
      traits: this.traits.length > 0 ? this.traits : undefined,
      jarMods: this.jarMods.length > 0 ? this.jarMods : undefined,
      mods: this.mods.length > 0 ? this.mods : undefined,
      mavenFiles: this.mavenFiles.length > 0 ? this.mavenFiles : undefined,
      agents: this.agents.length > 0 ? this.agents : undefined,
    };

    if (this.minecraftVersion) versionJson.jar = this.minecraftVersion;
    if (this.minecraftArguments) versionJson.minecraftArguments = this.minecraftArguments;
    if (this.downloads) versionJson.downloads = this.downloads;
    if (this.assetIndex) versionJson.assetIndex = this.assetIndex;
    if (this.javaVersion) versionJson.javaVersion = this.javaVersion;

    return versionJson;
  }
}
