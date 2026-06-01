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

  async extractNatives(versionJson: VersionJson, gameDir: string): Promise<string> {
    const nativesDir = getNativesDir(gameDir);
    console.log(`[NativesExtractor] Preparing natives dir ${nativesDir}`);

    // Clean natives directory
    if (fs.existsSync(nativesDir)) {
      console.log(`[NativesExtractor] Removing existing natives dir ${nativesDir}`);
      fs.rmSync(nativesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(nativesDir, { recursive: true });

    // 1. Get all resolved libraries and filter for natives
    const resolved = this.librariesManager.resolveLibraries(versionJson);
    const nativeLibs = resolved.filter(l => l.isNative);

    console.log(`[NativesExtractor] Native libraries to inspect: ${nativeLibs.length}`);

    for (const lib of nativeLibs) {
      const jarPath = lib.path;
      if (!fs.existsSync(jarPath)) {
        console.warn(`[NativesExtractor] Native jar missing for ${lib.name}: ${jarPath}`);
        continue;
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
          console.log(`[NativesExtractor] Extracted ${entryName} from ${lib.name}`);
        }
      } catch (e) {
        console.error(`[NativesExtractor] Failed to extract ${jarPath}: ${e}`);
      }
    }

    return nativesDir;
  }

  private shouldExtractEntry(lib: VersionJsonLibrary, entryName: string): boolean {
    if (!lib.extract || !lib.extract.exclude) {
      return true;
    }
    return !lib.extract.exclude.some((exclude) => entryName.startsWith(exclude));
  }
}
