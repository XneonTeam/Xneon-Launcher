// Resolves version inheritance and builds complete version data
// Author: MAINER4IK
import { VersionJson, VersionJsonLibrary, VersionJsonRule } from "../types/index.js";
import { MetaClient } from "./meta-client.js";
import { checkRules } from "../utils/index.js";
import { OSInfo } from "../types/index.js";

export class VersionResolver {
  constructor(private metaClient: MetaClient) {}

  async resolveVersion(versionId: string, osInfo: OSInfo): Promise<VersionJson> {
    const versionJson = await this.metaClient.fetchVersionJson(versionId);
    return this.resolveInheritance(versionJson, osInfo);
  }

  async resolveVersionFromJson(versionJson: VersionJson, osInfo: OSInfo): Promise<VersionJson> {
    return this.resolveInheritance(versionJson, osInfo);
  }

  private async resolveInheritance(versionJson: VersionJson, osInfo: OSInfo): Promise<VersionJson> {
    if (!versionJson.inheritsFrom) {
      return this.normalizeFamily(versionJson);
    }

    const parentJson = await this.metaClient.fetchVersionJson(versionJson.inheritsFrom);
    const resolved = await this.resolveInheritance(parentJson, osInfo);

    // Merge libraries (child overrides parent)
    const mergedLibraries = this.mergeLibraries(resolved.libraries, versionJson.libraries, osInfo);

    // Handle +libraries extensions
    const plusLibraries = (versionJson as any)["+libraries"];
    if (Array.isArray(plusLibraries)) {
      mergedLibraries.push(...plusLibraries);
    }

    // Merge arguments
    let mergedArgs: NonNullable<VersionJson["arguments"]> = { ...(resolved.arguments ?? {}) };
    if (versionJson.arguments) {
      mergedArgs = this.mergeArguments(mergedArgs, versionJson.arguments) as NonNullable<VersionJson["arguments"]>;
    }

    // Handle +jvmArgs and +gameArgs extensions
    const plusJvmArgs = (versionJson as any)["+jvmArgs"];
    if (Array.isArray(plusJvmArgs)) {
      mergedArgs.jvm = [...(mergedArgs.jvm ?? []), ...plusJvmArgs];
    }
    const plusGameArgs = (versionJson as any)["+gameArgs"];
    if (Array.isArray(plusGameArgs)) {
      mergedArgs.game = [...(mergedArgs.game ?? []), ...plusGameArgs];
    }

    // Handle +tweakers extension
    const plusTweakers = (versionJson as any)["+tweakers"];
    if (Array.isArray(plusTweakers) && plusTweakers.length > 0) {
      if (!mergedArgs.game) mergedArgs.game = [];
      for (const tweaker of plusTweakers) {
        if (!mergedArgs.game.includes("--tweakClass") || !mergedArgs.game.includes(tweaker)) {
          mergedArgs.game.push("--tweakClass", tweaker);
        }
      }
    }

    // Merge other fields
    const mergedJarMods = [...(resolved.jarMods ?? []), ...(versionJson.jarMods ?? [])];
    const mergedAgents = [...(resolved.agents ?? []), ...(versionJson.agents ?? [])];
    const mergedTraits = Array.from(new Set([...(resolved.traits ?? []), ...(versionJson.traits ?? []), ...((versionJson as any)["+traits"] ?? [])]));

    return this.normalizeFamily({
      ...resolved,
      ...versionJson,
      mainClass: versionJson.mainClass ?? resolved.mainClass,
      minecraftArguments: versionJson.minecraftArguments ?? resolved.minecraftArguments,
      libraries: mergedLibraries,
      arguments: mergedArgs,
      jarMods: mergedJarMods.length > 0 ? mergedJarMods : undefined,
      agents: mergedAgents.length > 0 ? mergedAgents : undefined,
      traits: mergedTraits.length > 0 ? mergedTraits : undefined,
      // Keep inheritsFrom so LaunchBuilder can detect legacy/modloader profiles
    });
  }

  private normalizeFamily(versionJson: VersionJson): VersionJson {
    if (versionJson.family) {
      return versionJson;
    }

    const inheritedFamily = versionJson.inheritsFrom ? this.getFamilyOf(versionJson.inheritsFrom) : undefined;
    const currentId = versionJson.id.toLowerCase();

    if (currentId.includes("fabric")) {
      return {
        ...versionJson,
        family: `Fabric-${inheritedFamily ?? "unknown"}`,
      };
    }

    // Intentionally do not assign a dedicated Quilt family here.
    return versionJson;
  }

  private getFamilyOf(versionId: string): string | undefined {
    const match = versionId.match(/([a-z]*\d+\.\d+)/i);
    const family = match?.[1];
    if (!family || family === "26.1") {
      return undefined;
    }
    return family;
  }

  private mergeLibraries(
    parent: VersionJsonLibrary[],
    child: VersionJsonLibrary[],
    osInfo: OSInfo,
  ): VersionJsonLibrary[] {
    const merged = new Map<string, VersionJsonLibrary>();

    // Returns true if the library's natives field has a matching entry for this OS
    const matchesCurrentOS = (lib: VersionJsonLibrary): boolean => {
      if (!lib.natives) return false;
      const os = (osInfo as any).os as string;
      const arch = (osInfo as any).arch as string;
      const modernKey = `${os}-${arch}`;
      return lib.natives[os] != null || lib.natives[modernKey] != null;
    };

    // Prefer the entry that matches the current OS; if both (or neither) do,
    // prefer the later one (last-wins).
    const setBetter = (key: string, lib: VersionJsonLibrary): void => {
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, lib);
        return;
      }
      const existingMatches = matchesCurrentOS(existing);
      const newMatches = matchesCurrentOS(lib);
      if (newMatches && !existingMatches) {
        merged.set(key, lib);
      } else if (!newMatches && existingMatches) {
        // keep existing (it matches OS)
      } else {
        // both (or neither) match — last-wins
        merged.set(key, lib);
      }
    };

    for (const lib of parent) {
      setBetter(this.getArtifactKey(lib), lib);
    }

    for (const lib of child) {
      setBetter(this.getArtifactKey(lib), lib);
    }

    return Array.from(merged.values());
  }

  private getArtifactKey(lib: VersionJsonLibrary): string {
    const normalizedName = lib.name.replace(/@[^:]+$/, "");
    const parts = normalizedName.split(":");
    if (parts.length < 3) {
      return normalizedName;
    }

    const group = parts[0];
    const artifact = parts[1];
    const classifier = parts[3] || "";

    // Separate keys based on whether the library provides natives. A native
    // entry (one with a `natives` field) provides both a main artifact and
    // native binaries. A non-native entry only provides a main artifact.
    // They have overlapping artifact coordinates but serve different roles,
    // so they must never replace each other during merge.
    const suffix = lib.natives ? "::natives" : "";

    return classifier
      ? `${group}:${artifact}:${classifier}${suffix}`
      : `${group}:${artifact}${suffix}`;
  }

  private mergeArguments(
    parent: VersionJson["arguments"] | undefined,
    child: VersionJson["arguments"] | undefined,
  ): VersionJson["arguments"] {
    if (!parent) return child ?? {};

    return {
      jvm: [...(parent.jvm ?? []), ...(child?.jvm ?? [])],
      game: [...(parent.game ?? []), ...(child?.game ?? [])],
    };
  }

  filterLibrariesForOS(libraries: VersionJsonLibrary[], osInfo: OSInfo): VersionJsonLibrary[] {
    return libraries.filter((lib) => {
      if (!lib.rules) return true;
      return checkRules(lib.rules as VersionJsonRule[], osInfo);
    });
  }
}
