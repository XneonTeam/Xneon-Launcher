// ============================================================
// Xneon Launcher — Stale modloader profile cleanup
// ============================================================
//
// Каждая сборка держит свой .minecraft в intents/<name>. Когда пользователь
// меняет загрузчик (или его версию), профиль старого загрузчика остаётся в
// <gameDir>/versions и может быть подхвачен при следующем запуске — старый и
// новый загрузчик начинают конфликтовать за одни и те же библиотеки.
//
// Здесь удаляются все профили загрузчиков, которые больше не соответствуют
// выбору сборки. Ванильные версии и пользовательские (custom) профили не
// трогаются: они не являются профилями загрузчика.

import * as fs from "fs"
import * as path from "path"

interface LoaderProfileFamily {
  id: string
  test: RegExp
}

/** `^`-якорь у forge не даёт паттерну поймать `neoforge-...`. */
const LOADER_PROFILE_FAMILIES: LoaderProfileFamily[] = [
  { id: "fabric", test: /^fabric-loader-/i },
  { id: "quilt", test: /^quilt-loader-/i },
  { id: "neoforge", test: /^neoforge-/i },
  { id: "forge", test: /^forge-/i },
  { id: "liteloader", test: /^liteloader-/i },
  { id: "optifine", test: /-optifine[_-]/i },
]

export interface LoaderPruneResult {
  removed: string[]
  kept: string[]
}

function familyOf(dirName: string): LoaderProfileFamily | null {
  return LOADER_PROFILE_FAMILIES.find(family => family.test.test(dirName)) ?? null
}

function normalizeLoaderId(loaderId?: string): string {
  const value = (loaderId ?? "").trim().toLowerCase()
  // Legacy Fabric ставит профиль `fabric-loader-*` — это та же семья.
  if (value === "fabric-legacy") return "fabric"
  return value
}

function removeProfile(dirPath: string, name: string, result: LoaderPruneResult): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true })
    result.removed.push(name)
  } catch {
    // Заблокированный (запущенный) профиль не должен ломать запуск.
  }
}

/**
 * Удаляет из `<gameDir>/versions` профили загрузчиков, не соответствующие
 * текущему выбору сборки.
 *
 * - профиль другой семьи (forge ↔ neoforge ↔ fabric …) — удаляется;
 * - профиль той же семьи, но другой версии — удаляется;
 * - если нужную версию не удалось опознать в имени каталога (OptiFine),
 *   ничего не удаляется: активный профиль никогда не должен быть потерян.
 */
export function pruneStaleLoaderProfiles(
  gameDir: string,
  loaderId?: string,
  loaderVersion?: string,
): LoaderPruneResult {
  const result: LoaderPruneResult = { removed: [], kept: [] }
  if (!gameDir) return result

  const versionsDir = path.join(gameDir, "versions")
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(versionsDir, { withFileTypes: true })
  } catch {
    return result
  }

  const currentFamily = normalizeLoaderId(loaderId)
  const currentVersion = (loaderVersion ?? "").trim().toLowerCase()
  const sameFamilyProfiles: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const family = familyOf(entry.name)
    if (!family) continue

    if (family.id !== currentFamily) {
      removeProfile(path.join(versionsDir, entry.name), entry.name, result)
      continue
    }
    sameFamilyProfiles.push(entry.name)
  }

  if (sameFamilyProfiles.length === 0) return result

  if (!currentVersion) {
    result.kept.push(...sameFamilyProfiles)
    return result
  }

  const matching = sameFamilyProfiles.filter(name => name.toLowerCase().includes(currentVersion))
  if (matching.length === 0) {
    result.kept.push(...sameFamilyProfiles)
    return result
  }

  for (const name of sameFamilyProfiles) {
    if (matching.includes(name)) result.kept.push(name)
    else removeProfile(path.join(versionsDir, name), name, result)
  }

  return result
}