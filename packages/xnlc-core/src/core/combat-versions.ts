import type { MojangVersionEntry, MojangVersionManifest } from "../types/index.js";
import { URLS } from "../constants/urls.js";

// Боевые тесты опубликованы отдельно от манифеста Mojang. Идентификаторы
// соответствуют компонентам net.minecraft в Prism, а не именам ZIP-архивов.
const COMBAT_VERSIONS = [
  ["1.16_combat-6", "2020-08-26"],
  ["1.16_combat-5", "2020-08-21"],
  ["1.16_combat-4", "2020-08-19"],
  ["1.16_combat-3", "2020-08-14"],
  ["1.16_combat-2", "2020-08-13"],
  ["1.16_combat-1", "2020-08-12"],
  ["1.16_combat-0", "2020-08-07"],
  ["1.15_combat-6", "2020-01-15"],
  ["1.15_combat-1", "2019-11-29"],
  ["1.14_combat-3", "2019-10-31"],
  ["1.14_combat-0", "2019-08-13"],
  ["1.14_combat-212796", "2019-06-20"],
] as const;

export function isCombatVersion(version: string): boolean {
  return COMBAT_VERSIONS.some(([id]) => id === version);
}

export function withCombatVersions(manifest: MojangVersionManifest): MojangVersionManifest {
  const existing = new Set(manifest.versions.map(version => version.id));
  const additional: MojangVersionEntry[] = COMBAT_VERSIONS.filter(([id]) => !existing.has(id)).map(([id, date]) => ({
    id,
    type: "snapshot",
    url: `${URLS.official.loader.meta}/net.minecraft/${id}.json`,
    releaseTime: `${date}T00:00:00Z`,
  }));
  return {
    ...manifest,
    versions: [...manifest.versions, ...additional].sort((a, b) =>
      (Date.parse(b.releaseTime ?? b.time ?? "") || 0) - (Date.parse(a.releaseTime ?? a.time ?? "") || 0)),
  };
}
