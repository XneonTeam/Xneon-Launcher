// ============================================================
// XNLC — Natives Extractor
// Extracts native libraries for the current platform
// Author: MAINER4IK
// ============================================================

import * as path from "path";
import * as fs from "fs";
import AdmZip from "adm-zip/adm-zip.js";
import { VersionJson, VersionJsonLibrary } from "../types/index.js";
import { LibrariesManager } from "./libraries-manager.js";
import { getNativesDir } from "../utils/index.js";

export class NativesExtractor {
  constructor(
    private librariesManager: LibrariesManager,
  ) {}

  async extractNatives(versionJson: VersionJson, gameDir: string, resourceDir = gameDir): Promise<string> {
    const nativesDir = getNativesDir(gameDir);
    const versionNativesDir = path.join(resourceDir, "versions", versionJson.id, "natives");
    const markerPath = path.join(nativesDir, ".xnlc-natives-version");
    const markerId = this.getNativeMarkerId(versionJson);

    // Reuse previously extracted natives when the version (and its native
    // libraries) haven't changed — avoids re-writing ~50 files on every launch.
    if (fs.existsSync(markerPath)) {
      try {
        const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
        if (marker.id === markerId && Array.isArray(marker.files) && marker.files.every((file: string) => fs.existsSync(path.join(nativesDir, file)))) {
          return nativesDir;
        }
      } catch {
        // fall through to re-extract
      }
    }

    console.log(`[NativesExtractor] Preparing natives dir ${nativesDir}`);

    // Clean natives directory
    if (fs.existsSync(nativesDir)) {
      console.log(`[NativesExtractor] Removing existing natives dir ${nativesDir}`);
      fs.rmSync(nativesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(nativesDir, { recursive: true });

    // ZIP-портированные клиенты могут поставлять готовые DLL/SO рядом с
    // версией. Сначала берём их, затем дозаполняем набор из native JAR.
    const bundledFiles = new Set<string>();
    const copyBundled = (directory: string, relative = "") => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
        if (entry.isDirectory()) {
          copyBundled(path.join(directory, entry.name), entryRelative);
        } else if (entry.isFile()) {
          const destination = path.join(nativesDir, entryRelative);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.copyFileSync(path.join(directory, entry.name), destination);
          bundledFiles.add(entryRelative);
        }
      }
    };
    copyBundled(versionNativesDir);

    // 1. Get all resolved libraries and filter for natives
    const resolved = this.librariesManager.resolveLibraries(versionJson);
    const nativeLibs = resolved.filter(l => l.isNative);
    const extractedFiles = new Set<string>();

    console.log(`[NativesExtractor] Native libraries to inspect: ${nativeLibs.length}`);

    for (const lib of nativeLibs) {
      const jarPath = lib.path;
      if (!fs.existsSync(jarPath)) {
        throw new Error(`Native jar missing for ${lib.name}: ${jarPath}`);
      }

      try {
        const zip = new AdmZip(jarPath);
        const entries = zip.getEntries();
        
        // Find the original library in VersionJson to get exclusion rules
        const originalLib = versionJson.libraries.find(l => l.name === lib.name);

        for (const entry of entries) {
          const entryName = entry.entryName;
          if (entryName.endsWith("/") || entryName.startsWith("META-INF/")) continue;
          
          if (originalLib && !this.shouldExtractEntry(originalLib, entryName)) {
            continue;
          }

          zip.extractEntryTo(entryName, nativesDir, true, true, false);
          extractedFiles.add(entryName);
          console.log(`[NativesExtractor] Extracted ${entryName} from ${lib.name}`);
        }
      } catch (e) {
        throw new Error(`Failed to extract native library ${jarPath}: ${e}`);
      }
    }

    try {
    fs.writeFileSync(markerPath, JSON.stringify({ id: markerId, files: [...bundledFiles, ...extractedFiles] }), "utf-8");
    } catch {
      // ignore marker write failures
    }

    return nativesDir;
  }

  private getNativeMarkerId(versionJson: VersionJson): string {
    const nativeLibs = this.librariesManager
      .resolveLibraries(versionJson)
      .filter(l => l.isNative)
      .map(l => `${l.name}:${l.classifier}:${l.path}:${l.sha1}`)
      .join("|");
    return `${versionJson.id}:${versionJson.jar ?? ""}:${nativeLibs}`;
  }

  private shouldExtractEntry(lib: VersionJsonLibrary, entryName: string): boolean {
    if (!lib.extract || !lib.extract.exclude) {
      return true;
    }
    return !lib.extract.exclude.some((exclude) => entryName.startsWith(exclude));
  }
}
