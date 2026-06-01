// ============================================================
// XNLC — Libraries Manager
// Component-based library resolution and download (Prism Style)
// Author: MAINER4IK
// ============================================================

import * as path from "path";
import * as fs from "fs";
import { VersionJson, VersionJsonLibrary, ResolvedLibrary, OSInfo, DownloadProgressCallback } from "../types/index.js";
import { DownloadJob } from "./downloader.js";
import { 
  libraryNameToPath, 
  checkRules, 
  getNativesClassifier, 
  getNativesClassifierOld, 
  getLibraryDir, 
  getPlainLibraryName 
} from "../utils/index.js";
import { URLS } from "../constants/urls.js";

export class LibrariesManager {
  constructor(
    private gameDir: string,
    private osInfo: OSInfo,
  ) {}

  /**
   * Resolves libraries from a version JSON (including inherited components)
   */
  resolveLibraries(versionJson: VersionJson): ResolvedLibrary[] {
    const libraries: VersionJsonLibrary[] = versionJson.libraries || [];
    const resolved: ResolvedLibrary[] = [];
    const seenPaths = new Set<string>();

    for (const lib of libraries) {
      // 1. Check rules (Prism style)
      if (lib.rules && !checkRules(lib.rules, this.osInfo)) {
        continue;
      }

      // 2. Handle natives
      const classifier = this.resolveNativeClassifier(lib);
      if (classifier && lib.downloads?.classifiers?.[classifier]) {
        const entry = lib.downloads.classifiers[classifier];
        const libPath = entry.path ?? this.getClassifierLibraryPath(lib, classifier);
        const dest = path.join(getLibraryDir(this.gameDir), libPath);

        if (!seenPaths.has(dest)) {
          seenPaths.add(dest);
          resolved.push({
            name: lib.name,
            path: dest,
            url: entry.url,
            sha1: entry.sha1 ?? "",
            size: entry.size ?? 0,
            natives: lib.natives,
            isNative: true,
            classifier,
            includeInClasspath: lib.includeInClasspath !== false,
            downloadOnly: lib.downloadOnly === true,
          });
        }
      }

      // 3. Handle main artifact (Prism/Mojang compatible)
      let mainArtifact: { url?: string; sha1?: string; size?: number; path?: string } | undefined;

      if (lib.downloads?.artifact) {
        mainArtifact = lib.downloads.artifact;
      } else if (!lib.natives) {
        // Fallback for libraries without 'downloads' field (common in Prism Meta)
        // BUT only if it's not a native-only library.
        const libPath = libraryNameToPath(lib.name);
        const baseUrl = lib.url ? lib.url.replace(/\/$/, "") : URLS.official.mojang.libraries;
        mainArtifact = {
          url: `${baseUrl}/${libPath}`,
          path: libPath,
          sha1: "",
          size: 0,
        };
      }

      if (mainArtifact && mainArtifact.url) {
        let libPath = mainArtifact.path ?? libraryNameToPath(lib.name);
        
        // Extension fix for Forge legacy
        if (mainArtifact.url.endsWith(".zip") && lib.name.includes("net.minecraftforge:forge") && lib.name.includes("universal")) {
          libPath = libPath.replace(/\.jar$/, ".zip").replace(/\.zip$/, ".jar");
        }

        const dest = path.join(getLibraryDir(this.gameDir), libPath);
        if (!seenPaths.has(dest)) {
          seenPaths.add(dest);
          resolved.push({
            name: lib.name,
            path: dest,
            url: mainArtifact.url,
            sha1: mainArtifact.sha1 ?? "",
            size: mainArtifact.size ?? 0,
            natives: lib.natives,
            isNative: false,
            includeInClasspath: lib.includeInClasspath !== false,
            downloadOnly: lib.downloadOnly === true,
          });
        }
      }
    }

    return resolved;
  }

  /**
   * Downloads all resolved libraries using the new task system
   */
  async downloadLibraries(
    versionJson: VersionJson,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const resolved = this.resolveLibraries(versionJson);
    
    // Add extra components (jarMods, agents, mods, mavenFiles)
    const extraComponents = [
      ...(versionJson.jarMods || []),
      ...(versionJson.agents || []),
      ...(versionJson.mods || []),
      ...(versionJson.mavenFiles || []),
    ];

    const job = new DownloadJob(`Libraries:${versionJson.id}`);
    const seen = new Set<string>();

    const addLibToJob = (lib: any, isExtra = false) => {
      let url = lib.url;
      let dest = lib.path;
      let sha1 = lib.sha1;
      let size = lib.size;

      if (isExtra) {
        const artifact = lib.downloads?.artifact;
        url = artifact?.url;
        sha1 = artifact?.sha1;
        size = artifact?.size;
        let libPath = artifact?.path || libraryNameToPath(lib.name);
        dest = path.join(getLibraryDir(this.gameDir), libPath);
      }

      if (!url || seen.has(dest)) return;
      seen.add(dest);

      job.addTask({
        url,
        dest,
        sha1,
        size,
        onProgress,
      });
    };

    resolved.forEach(lib => addLibToJob(lib));
    extraComponents.forEach(lib => addLibToJob(lib, true));

    // mavenFiles are download-only, not in classpath
    const mavenFiles = versionJson.mavenFiles || [];
    for (const lib of mavenFiles) {
      const artifact = lib.downloads?.artifact;
      if (!artifact?.url) continue;
      const libPath = artifact.path || libraryNameToPath(lib.name);
      const dest = path.join(getLibraryDir(this.gameDir), libPath);
      if (seen.has(dest)) continue;
      seen.add(dest);
      job.addTask({
        url: artifact.url,
        dest,
        sha1: artifact.sha1,
        size: artifact.size,
        onProgress,
      });
    }

    await job.execute();
  }

  private resolveNativeClassifier(lib: VersionJsonLibrary): string | null {
    if (!lib.natives) return null;
    
    // 1. Try old style (os name as key)
    const osKey = this.osInfo.os;
    if (lib.natives[osKey]) {
      return lib.natives[osKey] || null;
    }

    // 2. Try modern style (os-arch as key)
    const modernKey = getNativesClassifier(this.osInfo);
    if (lib.natives[modernKey]) {
      return lib.natives[modernKey] || null;
    }

    return null;
  }

  private getClassifierLibraryPath(lib: VersionJsonLibrary, classifier: string): string {
    const path = libraryNameToPath(lib.name);
    return path.replace(/\.jar$/, `-${classifier}.jar`);
  }

  countTotalFiles(versionJson: VersionJson): number {
    const libs = this.resolveLibraries(versionJson);
    return libs.filter(l => !fs.existsSync(l.path)).length;
  }

  countTotalSize(versionJson: VersionJson): number {
    const libs = this.resolveLibraries(versionJson);
    return libs.reduce((acc, l) => acc + (fs.existsSync(l.path) ? 0 : (l.size || 0)), 0);
  }
}
