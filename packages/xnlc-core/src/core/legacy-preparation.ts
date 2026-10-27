import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip/adm-zip.js";
import type { DownloadProgressCallback, VersionJson } from "../types/index.js";
import { Downloader } from "./downloader.js";
import { URLS } from "../constants/urls.js";
import { getLibraryDir, libraryNameToPath } from "../utils/index.js";

// Имена и контрольные суммы старых зависимостей FML совпадают с теми,
// которые проверяет сам загрузчик. Это не обычные библиотеки classpath.
const FML_COMMON = [
  ["argo-small-3.2.jar", "58912ea2858d168c50781f956fa5b59f0f7c6b51"],
  ["guava-14.0-rc3.jar", "931ae21fa8014c3ce686aaa621eae565fefb1a6a"],
  ["asm-all-4.1.jar", "054986e962b88d8660ae4566475658469595ef58"],
  ["bcprov-jdk15on-148.jar", "960dea7c9181ba0b17e8bab0c06a43f0a5f04e65"],
  ["scala-library.jar", "458d046151ad179c85429ed7420ffb1eaf6ddf85"],
];
const FML_13 = [
  ["argo-2.25.jar", "bb672829fde76cb163004752b86b0484bd0a7f4b"],
  ["guava-12.0.1.jar", "b8e78b9af7bf45900e14c6f958486b6ca682195f"],
  ["asm-all-4.0.jar", "98308890597acb64047f7e896638e0d98753ae82"],
];

export function legacyFmlLibraries(mcVersion: string): string[][] {
  if (mcVersion === "1.3.2") return FML_13;
  if (/^1\.4(?:\.[1-7])?$/.test(mcVersion)) {
    return [...FML_13, ["bcprov-jdk15on-147.jar", "b6f5d9926b0afbde9f4dbe3db88c5247be7794bb"]];
  }
  const deobfuscation: Record<string, string> = {
    "1.5": "5f7c142d53776f16304c0bbe10542014abad6af8",
    "1.5.1": "22e221a0d89516c1f721d6cab056a7e37471d0a6",
    "1.5.2": "446e55cd986582c70fcf12cb27bc00114c5adfd9",
  };
  return deobfuscation[mcVersion]
    ? [...FML_COMMON, [`deobfuscation_data_${mcVersion}.zip`, deobfuscation[mcVersion]]]
    : [];
}

export class LegacyPreparation {
  constructor(private gameDir: string, private downloader = new Downloader(), private resourceDir = gameDir) {}

  async prepare(version: VersionJson, onProgress?: DownloadProgressCallback): Promise<string | undefined> {
    const base = version.jar ?? version.xnlcBaseVersion ?? version.inheritsFrom ?? version.id;
    if (version.traits?.includes("legacyFML")) {
      for (const [filename, sha1] of legacyFmlLibraries(base)) {
        const dest = path.join(this.gameDir, "lib", filename);
        // FML сам проверяет SHA-1: повреждённый кэш необходимо восстановить до запуска.
        if (fs.existsSync(dest) && this.hash(fs.readFileSync(dest)) === sha1) continue;
        await this.downloader.download({
          url: `${URLS.official.loader.fmlLibraries}/${filename}`,
          dest, sha1, skipIfExists: false, onProgress,
        });
      }
    }

    for (const mod of version.mods ?? []) {
      const source = path.join(getLibraryDir(this.resourceDir), mod.downloads?.artifact?.path ?? libraryNameToPath(mod.name));
      const destination = path.join(this.gameDir, "mods", path.basename(source));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }

    if (!version.jarMods?.length) return undefined;
    if (version.traits?.includes("no_vjar")) throw new Error("Jar mods require a Minecraft client jar");
    const source = path.join(this.resourceDir, "versions", base, `${base}.jar`);
    const inputs = [source, ...version.jarMods.map(mod =>
      path.join(getLibraryDir(this.resourceDir), mod.downloads?.artifact?.path ?? libraryNameToPath(mod.name)))];
    // Хэш включает содержимое и порядок патчей; ванильный JAR остаётся неизменным.
    const contents = inputs.map(file => fs.readFileSync(file));
    const fingerprint = this.hash(Buffer.from(contents.map(data => this.hash(data)).join(":")));
    const destination = path.join(this.gameDir, ".xnlc", "patched", `${fingerprint}.jar`);
    if (fs.existsSync(destination)) {
      try {
        new AdmZip(destination).getEntries();
        return destination;
      } catch {
        // Незавершённый или повреждённый кэш пересобирается из исходных архивов.
      }
    }

    const merged = new AdmZip();
    for (const data of contents) {
      for (const entry of new AdmZip(data).getEntries()) {
        if (entry.isDirectory || /^META-INF\//i.test(entry.entryName)) continue;
        merged.addFile(entry.entryName, entry.getData());
      }
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
    try {
      merged.writeZip(temporary);
      fs.renameSync(temporary, destination);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return destination;
  }

  private hash(data: Buffer): string {
    return createHash("sha1").update(data).digest("hex");
  }
}
