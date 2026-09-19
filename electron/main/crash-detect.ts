import fs from "fs"
import path from "path"

/**
 * Свежий crash-report в папке игры: Minecraft пишет его перед падением.
 *
 * `since` — момент запуска игры. Файлы прошлых сессий отсекаются по mtime,
 * иначе после любого нормального выхода игра «выглядела бы упавшей».
 */
export function findRecentCrashReport(gameDir: string, since: number): string | null {
  try {
    const dir = path.join(gameDir, "crash-reports")
    let newest: { file: string; mtimeMs: number } | null = null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".txt")) continue
      const full = path.join(dir, entry.name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.mtimeMs < since) continue
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs: stat.mtimeMs }
    }
    return newest?.file ?? null
  } catch {
    return null
  }
}

/**
 * Упала ли игра. Ненулевой код выхода — краш; нулевой код с свежим
 * crash-report — тоже краш (Java-исключение: игра пишет отчёт и выходит штатно).
 */
export function detectMinecraftCrash(
  gameDir: string,
  launchStartedAt: number,
  exitCode: number,
): { crashed: boolean; crashReport: string | null } {
  const crashReport = findRecentCrashReport(gameDir, launchStartedAt)
  return { crashed: exitCode !== 0 || crashReport !== null, crashReport }
}
