/**
 * Детект «сервер полностью запустился» по строке-маркеру в консоли.
 *
 * Идея та же, что в панелях управления игровыми серверами: у сервера в
 * конфигурации задаётся строка, которую ждут в выводе, и только после неё
 * состояние переключается в «запущен». Пока строка не появилась, сервер
 * считается запускающимся — так UI не врёт, что сервер уже работает.
 *
 * Для ванильного Minecraft (и всего семейства на его основе) это хвост строки
 * `Done (5.123s)! For help, type "help"`, то есть достаточно искать
 * `)! For help, type "`; у Forge/NeoForge/Paper/Fabric отличается только
 * оформление, а прокси (BungeeCord/Velocity/Waterfall) пишут совсем другое.
 */
export const STARTUP_DONE_PATTERNS: readonly RegExp[] = [
  // vanilla / paper / spigot / purpur / folia / fabric / quilt / forge / neoforge
  /Done \(\d[\d.,]*\s*s\)! For help, type "?help/i,
  // хвост каноничной строки готовности (её же ищут панели серверов)
  /\)! For help, type "/i,
  // старые сборки Forge, где «help» не упоминается
  /For help, type "help"/i,
  /Done \(\d[\d.,]*\s*s\)!/i,
  // прокси: BungeeCord / Waterfall слушают порт, Velocity печатает Done
  /Listening on \//i,
  /Done \(\d[\d.,]*\s*s\)/i,
]

/**
 * Строки, по которым видно, что сервер начал штатно останавливаться.
 * Нужны для случая, когда игрок вводит `stop` прямо в консоли лаунчера:
 * без этого состояние оставалось `running` до самого закрытия процесса.
 */
export const STOPPING_PATTERNS: readonly RegExp[] = [
  /Stopping server/i,
  /Stopping the server/i,
  /Closing Server/i,
]

/** Сервер просит согласие с EULA — без него он выйдет сразу после старта. */
export const EULA_PROMPT_PATTERN = /You need to agree to the EULA|agree to the EULA in order to run the server/i

export function isStartupDoneLine(line: string): boolean {
  return STARTUP_DONE_PATTERNS.some((pattern) => pattern.test(line))
}

export function isStoppingLine(line: string): boolean {
  return STOPPING_PATTERNS.some((pattern) => pattern.test(line))
}
