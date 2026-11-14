import path from "node:path"
import { ArchiveError } from "./errors.js"

/** Путь внутри архива всегда в POSIX-виде и без ведущих `./`. */
export function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "")
}

export function isDirectoryEntry(name: string): boolean {
  return name.endsWith("/")
}

/**
 * Проверяет, что запись архива не выйдет за пределы каталога распаковки.
 *
 * Отклоняем абсолютные пути, буквы диска, `..`, NUL и двоеточия (потоки NTFS):
 * всё это либо позволяет выйти из каталога, либо создаёт файл не там, где
 * ожидает вызывающий код.
 */
export function assertSafeEntryName(name: string): void {
  const normalized = normalizeEntryName(name)
  if (!normalized || normalized === "/") throw new ArchiveError("UNSAFE_ENTRY", "Archive entry has an empty path", name)
  if (normalized.startsWith("/")) throw new ArchiveError("UNSAFE_ENTRY", `Archive entry has an absolute path: ${name}`, name)
  if (/^[a-zA-Z]:/.test(normalized)) throw new ArchiveError("UNSAFE_ENTRY", `Archive entry has a drive path: ${name}`, name)
  if (normalized.includes("\0")) throw new ArchiveError("UNSAFE_ENTRY", `Archive entry contains NUL: ${name}`, name)
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new ArchiveError("UNSAFE_ENTRY", `Archive entry escapes the destination: ${name}`, name)
  }
  if (normalized.includes(":")) throw new ArchiveError("UNSAFE_ENTRY", `Archive entry contains a stream separator: ${name}`, name)
}

/** Возвращает абсолютный путь записи или `null`, если она выходит за пределы `root`. */
export function resolveEntryPath(root: string, name: string): string | null {
  const normalized = normalizeEntryName(name)
  if (!normalized) return null
  try {
    assertSafeEntryName(normalized)
  } catch {
    return null
  }
  const absoluteRoot = path.resolve(root)
  const resolved = path.resolve(absoluteRoot, normalized)
  if (resolved === absoluteRoot) return null
  const prefix = absoluteRoot.endsWith(path.sep) ? absoluteRoot : absoluteRoot + path.sep
  return resolved.startsWith(prefix) ? resolved : null
}
