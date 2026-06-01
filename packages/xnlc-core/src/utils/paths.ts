import * as path from "path";
import { ensureDirSync } from "./sync.js";

export function getGameDirStructure(gameDir: string): Record<string, string> {
  const dirs = {
    root: gameDir,
    versions: path.join(gameDir, "versions"),
    libraries: path.join(gameDir, "libraries"),
    assets: path.join(gameDir, "assets"),
    assetIndexes: path.join(gameDir, "assets", "indexes"),
    assetObjects: path.join(gameDir, "assets", "objects"),
    resources: path.join(gameDir, "resources"),
    natives: path.join(gameDir, "natives"),
    logs: path.join(gameDir, "logs"),
    runtime: path.join(gameDir, "runtime"),
    mods: path.join(gameDir, "mods"),
    config: path.join(gameDir, "config"),
    resourcepacks: path.join(gameDir, "resourcepacks"),
    saves: path.join(gameDir, "saves"),
    screenshots: path.join(gameDir, "screenshots"),
    shaderpacks: path.join(gameDir, "shaderpacks"),
    crashReports: path.join(gameDir, "crash-reports"),
  };

  for (const dir of Object.values(dirs)) {
    ensureDirSync(dir);
  }

  return dirs;
}

export const getVersionDir = (gameDir: string, version: string) => path.join(gameDir, "versions", version);
export const getLibraryDir = (gameDir: string) => path.join(gameDir, "libraries");
export const getNativesDir = (gameDir: string) => path.join(gameDir, "natives");
export const getAssetsDir = (gameDir: string) => path.join(gameDir, "assets");
export const getAssetIndexDir = (gameDir: string) => path.join(gameDir, "assets", "indexes");
export const getAssetObjectsDir = (gameDir: string) => path.join(gameDir, "assets", "objects");
export const getLogsDir = (gameDir: string) => path.join(gameDir, "logs");
export const getRuntimeDir = (gameDir: string) => path.join(gameDir, "runtime");
export const getModsDir = (gameDir: string) => path.join(gameDir, "mods");
export const getConfigDir = (gameDir: string) => path.join(gameDir, "config");
export const getResourcepacksDir = (gameDir: string) => path.join(gameDir, "resourcepacks");
export const getSavesDir = (gameDir: string) => path.join(gameDir, "saves");
export const getScreenshotsDir = (gameDir: string) => path.join(gameDir, "screenshots");
export const getShaderpacksDir = (gameDir: string) => path.join(gameDir, "shaderpacks");
export const getCrashReportsDir = (gameDir: string) => path.join(gameDir, "crash-reports");