import * as path from "path";
import * as fs from "fs";
import type { VersionJson, LoaderInstallResult, DownloadProgressCallback } from "../types/index.js";

export class CustomVersionHandler {
  constructor(
    private customVersionsDir: string,
  ) {}

  async getVersions(): Promise<string[]> {
    if (!fs.existsSync(this.customVersionsDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.customVersionsDir, { withFileTypes: true });
    const versions: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const versionJsonPath = path.join(entry.path, `${entry.name}.json`);
        if (fs.existsSync(versionJsonPath)) {
          versions.push(entry.name);
        }
      } else if (entry.name.endsWith(".json")) {
        versions.push(entry.name.replace(".json", ""));
      }
    }

    return versions.sort();
  }

  async install(customVersionPath: string, _loaderVersion: string, _onProgress?: DownloadProgressCallback): Promise<LoaderInstallResult> {
    const resolvedPath = path.isAbsolute(customVersionPath) 
      ? customVersionPath 
      : path.join(this.customVersionsDir, customVersionPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Custom version not found at: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    let versionJsonPath: string;
    let profileName: string;
    let customJarPath: string | undefined;

    if (stats.isDirectory()) {
      versionJsonPath = path.join(resolvedPath, `${path.basename(resolvedPath)}.json`);
      profileName = path.basename(resolvedPath);
      
      const files = fs.readdirSync(resolvedPath);
      
      // For LabyMod versions, we need the underscore-named jar which contains LabyModTweaker
      // The hyphen-named jar in version folder is just a copy of vanilla client without the tweak class
      // The actual mod jar with tweak is in libraries folder with underscore in version (e.g., LabyMod-3_1.16.5.jar)
      let jarFile = files.find(f => f.match(/^LabyMod-.*_.*\.jar$/) && !f.includes("natives"));
      
      if (!jarFile) {
        // Check if there are two versions in the directory - if there's a hyphen-only version,
        // we need to fix up the library reference to use the underscore version from libraries
        const hyphenJar = files.find(f => f.match(/^LabyMod-.*\.jar$/) && !f.includes("natives"));
        if (hyphenJar) {
          // The library entry will be fixed after loading JSON to point to libraries folder
          customJarPath = path.join(resolvedPath, hyphenJar);
        }
      } else {
        customJarPath = path.join(resolvedPath, jarFile);
      }
    } else if (resolvedPath.endsWith(".json")) {
      versionJsonPath = resolvedPath;
      profileName = path.basename(resolvedPath, ".json");
    } else {
      throw new Error(`Invalid custom version path: ${resolvedPath}`);
    }

    if (!fs.existsSync(versionJsonPath)) {
      throw new Error(`Version JSON not found at: ${versionJsonPath}`);
    }

    let versionJson: VersionJson = JSON.parse(fs.readFileSync(versionJsonPath, "utf-8"));
    
    // If there's a custom jar, fix any library entries that have no downloads
    if (customJarPath) {
      const customJarName = path.basename(customJarPath, ".jar");
      
      // Get the game directory from the version path (parent of versions folder)
      const gameDir = path.dirname(path.dirname(resolvedPath));
      
      versionJson.libraries = versionJson.libraries.map(lib => {
        // If library has no downloads info, try to use the custom jar
        if (!lib.downloads?.artifact) {
          // lib.name format: "net.labymod:LabyMod:3_1.16.5"
          const parts = lib.name.split(":");
          const groupId = parts[0]!;
          const artifactId = parts[1]!;
          const version = parts[2]!;
          const libBaseName = artifactId.toLowerCase().replace(/-/g, "").replace(/_/g, "").replace(/\./g, "");
          
          // For LabyMod, try to find the correct library in libraries folder
          // The underscore version has the LabyModTweaker class
          if (libBaseName === "labymod") {
            const underscoreVersion = version.replace(/-/g, "_");
            const libraryPath = path.join(gameDir, "libraries", groupId.replace(/\./g, "/"), artifactId, version, `${artifactId}-${underscoreVersion}.jar`);
            
            // Check if underscore version exists in libraries
            if (fs.existsSync(libraryPath)) {
              const libSize = fs.statSync(libraryPath).size;
              const mavenPath = `${groupId.replace(/\./g, "/")}/${artifactId}/${version}/${artifactId}-${underscoreVersion}.jar`;
              return {
                ...lib,
                downloads: {
                  artifact: {
                    path: mavenPath,
                    url: `file://${libraryPath}`,
                    sha1: "",
                    size: libSize,
                  },
                },
              };
            }
            
            // Also check hyphen version in libraries
            const hyphenLibraryPath = path.join(gameDir, "libraries", groupId.replace(/\./g, "/"), artifactId, version, `${artifactId}-${version}.jar`);
            if (fs.existsSync(hyphenLibraryPath)) {
              const libSize = fs.statSync(hyphenLibraryPath).size;
              const mavenPath = `${groupId.replace(/\./g, "/")}/${artifactId}/${version}/${artifactId}-${version}.jar`;
              return {
                ...lib,
                downloads: {
                  artifact: {
                    path: mavenPath,
                    url: `file://${hyphenLibraryPath}`,
                    sha1: "",
                    size: libSize,
                  },
                },
              };
            }
          }
          
          // Original matching logic for other libraries
          const customJarBaseName = customJarName.toLowerCase().replace(/-/g, "").replace(/_/g, "").replace(/\./g, "");
          if (customJarBaseName.includes(libBaseName) || libBaseName.includes(customJarBaseName)) {
            const mavenPath = `${groupId.replace(/\./g, "/")}/${artifactId}/${version}/${customJarName}.jar`;
            const customJarSize = fs.statSync(customJarPath).size;
            return {
              ...lib,
              downloads: {
                artifact: {
                  path: mavenPath,
                  url: `file://${customJarPath}`,
                  sha1: "",
                  size: customJarSize,
                },
              },
            };
          }
        }
        return lib;
      });
    }
    
    return {
      versionJson,
      versionId: versionJson.id,
    };
  }
}