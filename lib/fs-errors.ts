/**
 * Системные ошибки файловой системы приходят из main как «сырой» текст Node
 * («EBUSY: resource busy or locked, rmdir …»). В уведомлениях и баннерах он
 * выглядит как мусор и не переводится, поэтому по коду ошибки собираем
 * человеческую подсказку на языке интерфейса.
 */

const FS_ERROR_KEYS: Record<string, string> = {
  EBUSY: "fsError.busy",
  EPERM: "fsError.permission",
  EACCES: "fsError.permission",
  ENOENT: "fsError.notFound",
  ENOSPC: "fsError.noSpace",
  EROFS: "fsError.readOnly",
  EMFILE: "fsError.tooManyFiles",
  ENFILE: "fsError.tooManyFiles",
}

/** Локализованное сообщение для ошибки ФС; неизвестный код — общая подсказка. */
export function fsErrorMessage(
  t: (key: string) => string,
  raw?: string | null,
): string {
  const code = /\b(EBUSY|EPERM|EACCES|ENOENT|ENOSPC|EROFS|EMFILE|ENFILE)\b/.exec(String(raw ?? ""))?.[1]
  return t(code ? (FS_ERROR_KEYS[code] ?? "fsError.generic") : "fsError.generic")
}
