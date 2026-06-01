// ============================================================
// XNLC — Utility Functions
// Author: MAINER4IK
// ============================================================

import type { OSType, ArchType, OSInfo, VersionJsonArgumentValue } from "../types/index.js";
import { URLS } from "../constants/urls.js";
import * as os from "os";
import * as crypto from "crypto";
import * as fs from "fs";

export * from "./sync.js";
export * from "./paths.js";
export * from "./urls.js";
export * from "./version-json.js";

export function getOSInfo(): OSInfo {
  const platform = os.platform();
  const arch = os.arch();

  let osType: OSType;
  if (platform === "win32") {
    osType = "windows";
  } else if (platform === "darwin") {
    osType = "osx";
  } else {
    osType = "linux";
  }

  let archType: ArchType;
  if (arch === "x64") {
    archType = "x64";
  } else if (arch === "arm64" || arch === "aarch64") {
    archType = "arm64";
  } else {
    archType = "x86";
  }

  return { os: osType, arch: archType };
}

export function getNativesClassifier(osInfo: OSInfo): string {
  const { os: o, arch: a } = osInfo;
  if (o === "windows") {
    return a === "x64" ? "windows-x86_64" : a === "arm64" ? "windows-arm64" : "windows-x86";
  }
  if (o === "osx") {
    return a === "arm64" ? "macos-arm64" : "macos";
  }
  return a === "arm64" ? "linux-aarch64" : "linux-x86_64";
}

export function getNativesClassifierOld(osInfo: OSInfo): string {
  const { os: o, arch: a } = osInfo;
  if (o === "windows") {
    return a === "x64" ? "natives-windows" : a === "arm64" ? "natives-windows-arm64" : "natives-windows-x86";
  }
  if (o === "osx") {
    return a === "arm64" ? "natives-macos-arm64" : "natives-macos";
  }
  return a === "arm64" ? "natives-linux-aarch64" : "natives-linux";
}

export function getOSRuleName(osInfo: OSInfo): OSType {
  return osInfo.os;
}

export function getArchRule(osInfo: OSInfo): string {
  if (osInfo.arch === "x64") return "x86_64";
  if (osInfo.arch === "arm64") return "aarch64";
  return "x86";
}

function splitMavenNotation(name: string): {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
  extension: string;
} {
  const parts = name.split(":");
  const [version, extFromVersion] = (parts[2] ?? "").split("@");
  const [classifier, extFromClassifier] = (parts[3] ?? "").split("@");
  return {
    groupId: parts[0] ?? "",
    artifactId: parts[1] ?? "",
    version,
    classifier: classifier || undefined,
    extension: parts[4] ?? extFromClassifier ?? extFromVersion ?? "jar",
  };
}

export function libraryNameToPath(name: string): string {
  const parsed = splitMavenNotation(name);
  const groupId = parsed.groupId.replace(/\./g, "/");
  const artifactId = parsed.artifactId;
  const version = parsed.version;
  const classifier = parsed.classifier ?? "";
  const ext = parsed.extension;

  let fileName: string;
  if (classifier) {
    fileName = `${artifactId}-${version}-${classifier}.${ext}`;
  } else {
    fileName = `${artifactId}-${version}.${ext}`;
  }

  return `${groupId}/${artifactId}/${version}/${fileName}`;
}

export function libraryNameToParts(name: string): {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
  ext: string;
} {
  const parsed = splitMavenNotation(name);
  return {
    groupId: parsed.groupId,
    artifactId: parsed.artifactId,
    version: parsed.version,
    classifier: parsed.classifier,
    ext: parsed.extension,
  };
}

export function getPlainLibraryName(name: string): string {
  const normalizedName = name.replace(/@[^:]+$/, "");
  const parts = normalizedName.split(":", 4);
  if (parts.length < 3) {
    return normalizedName;
  }

  let plainName = `${parts[0] ?? ""}:${parts[1] ?? ""}`;
  if (parts.length === 4 && parts[3]) {
    plainName += `::${parts[3]}`;
  }

  return plainName;
}

export function sha1Hash(data: Buffer): string {
  return crypto.createHash("sha1").update(data).digest("hex");
}

export function sha1HashSync(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return sha1Hash(data);
}

export function generateOfflineUUID(username: string): string {
  const data = `OfflinePlayer:${username}`;
  const hash = crypto.createHash("md5").update(data, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface RuleCheck {
  action: "allow" | "disallow";
  os?: { name?: string; arch?: string };
  features?: Record<string, boolean>;
}

export function checkRules(
  rules: RuleCheck[],
  osInfo: OSInfo,
  features?: Record<string, boolean>,
): boolean {
  if (!rules || rules.length === 0) return true;

  let result = false;

  for (const rule of rules) {
    let matches = true;

    if (rule.os) {
      if (rule.os.name && rule.os.name !== osInfo.os) {
        matches = false;
      }
      if (rule.os.arch && rule.os.arch !== getArchRule(osInfo)) {
        matches = false;
      }
    }

    if (rule.features) {
      for (const [key, value] of Object.entries(rule.features)) {
        if ((features?.[key] ?? false) !== value) {
          matches = false;
        }
      }
    }

    if (matches) {
      result = rule.action === "allow";
    }
  }

  return result;
}

export function tokenizeCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  const chars = [...input];

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    const nextChar = chars[index + 1];

    if (quote) {
      if (char === "\\" && nextChar && (nextChar === quote || nextChar === "\\")) {
        current += nextChar;
        index++;
        continue;
      }

      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export interface ParsedLaunchArgument {
  name: string;
  value?: string;
  index: number;
  raw: string;
}

export function flattenVersionJsonArguments(
  argDefs: (string | VersionJsonArgumentValue)[],
  features?: Record<string, boolean>,
  osInfo?: OSInfo,
): string[] {
  const values: string[] = [];

  for (const argDef of argDefs) {
    if (typeof argDef === "string") {
      values.push(argDef);
      continue;
    }

    if (!osInfo) {
      values.push(...(Array.isArray(argDef.value) ? argDef.value : [argDef.value]));
      continue;
    }

    if (!checkRules(argDef.rules ?? [], osInfo, features)) {
      continue;
    }

    values.push(...(Array.isArray(argDef.value) ? argDef.value : [argDef.value]));
  }

  return values;
}

export function parseLaunchArguments(args: string[]): ParsedLaunchArgument[] {
  const parsed: ParsedLaunchArgument[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (!arg.startsWith("-")) {
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex > 0) {
      parsed.push({
        name: arg.slice(0, eqIndex),
        value: arg.slice(eqIndex + 1),
        index: i,
        raw: arg,
      });
      continue;
    }

    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      parsed.push({
        name: arg,
        value: next,
        index: i,
        raw: arg,
      });
      continue;
    }

    parsed.push({
      name: arg,
      index: i,
      raw: arg,
    });
  }

  return parsed;
}

export function hasLaunchArgument(args: string[], name: string): boolean {
  return parseLaunchArguments(args).some((arg) => arg.name === name);
}

export function getLaunchArgumentValues(args: string[], name: string): string[] {
  return parseLaunchArguments(args)
    .filter((arg) => arg.name === name && arg.value !== undefined)
    .map((arg) => arg.value as string);
}

export function countLaunchArgument(args: string[], name: string): number {
  return parseLaunchArguments(args).filter((arg) => arg.name === name).length;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function isLegacyVersion(mcVersion: string): boolean {
  const parts = mcVersion.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (major < 1) return true;
  if (major === 1 && minor < 13) return true;
  return false;
}

export function isLegacyFabric(fabricLoaderVersion: string): boolean {
  const parts = fabricLoaderVersion.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (major === 0 && minor < 14) return true;
  return false;
}

export function parseMavenCoordinate(coord: string): {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
  extension: string;
} {
  return splitMavenNotation(coord);
}

export function mavenCoordinateToPath(
  groupId: string,
  artifactId: string,
  version: string,
  classifier?: string,
  extension: string = "jar",
): string {
  const groupPath = groupId.replace(/\./g, "/");
  let fileName = `${artifactId}-${version}`;
  if (classifier) {
    fileName += `-${classifier}`;
  }
  fileName += `.${extension}`;
  return `${groupPath}/${artifactId}/${version}/${fileName}`;
}
