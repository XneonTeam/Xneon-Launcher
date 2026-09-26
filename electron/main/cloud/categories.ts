// ============================================================
// XNLC — категории содержимого облачных архивов
// ============================================================
//
// Раньше карта «категория → папки» существовала в трёх местах и в двух
// вариантах: `upload-worker.ts` (упаковка архива) и два литерала в
// `handlers.ts` (выбор категорий при импорте сборки и сервера). Наборы
// расходились: у сборки была категория `data`, у сервера — `configs`, а
// `mods`/`resourcepacks`/`logs` дублировались дословно.
//
// Модуль намеренно не импортирует electron: его использует и worker-поток
// (worker_threads не может грузить модули, которым нужен electron).
//
// Категории из `BUILD_CATEGORY_DIRS` и `SERVER_CATEGORY_DIRS` — то, что
// пользователь выбирает в диалоге импорта; `EXPORT_CATEGORY_DIRS` — объединение
// для упаковки, потому что архивируется либо папка сборки, либо папка сервера.

/** Категории папки сборки (интента). */
export const BUILD_CATEGORY_DIRS: Record<string, string[]> = {
  mods: ["mods"],
  resourcepacks: ["resourcepacks"],
  shaderpacks: ["shaderpacks"],
  saves: ["saves"],
  data: ["config", "options.txt", "servers.dat"],
  logs: ["logs", "crash-reports"],
}

/** Категории папки сервера. */
export const SERVER_CATEGORY_DIRS: Record<string, string[]> = {
  world: ["world", "world_nether", "world_the_end"],
  mods: ["mods"],
  plugins: ["plugins"],
  configs: ["config", "eula.txt", "server.properties", "whitelist.json", "ops.json", "banned-players.json", "banned-ips.json", "usercache.json"],
  logs: ["logs", "crash-reports"],
}

/**
 * Категории для упаковки архива. Содержит все папки, которые вообще могут
 * попасть в архив: наборы сборки и сервера объединены, плюс кэш-папки клиента,
 * которые сбрасываются отдельной категорией.
 */
export const EXPORT_CATEGORY_DIRS: Record<string, string[]> = {
  mods: ["mods"],
  resourcepacks: ["resourcepacks"],
  shaderpacks: ["shaderpacks"],
  saves: ["saves"],
  world: ["world", "world_nether", "world_the_end"],
  plugins: ["plugins"],
  configs: ["config", "eula.txt", "server.properties", "whitelist.json", "ops.json", "banned-players.json", "banned-ips.json", "usercache.json"],
  data: ["config", "options.txt", "servers.dat"],
  logs: ["logs", "crash-reports", ".cache", ".fabric", ".quilt"],
}

/** Папки, которые идентичны во всех сборках (junction на общий кэш игр). */
export const SHARED_GAME_ENTRIES = new Set(["versions", "libraries", "assets"])

/** Категории, которым принадлежит запись архива, по её относительному пути. */
export function categoriesOf(relPath: string, categoryDirs: Record<string, string[]> = EXPORT_CATEGORY_DIRS): string[] {
  const segments = relPath.replace(/\\/g, "/").split("/").filter(Boolean)
  const key = segments[0] ?? ""
  const matched: string[] = []
  for (const [category, dirs] of Object.entries(categoryDirs)) {
    if (dirs.includes(key)) matched.push(category)
  }
  return matched
}