import { randomUUID } from "node:crypto"
import { link, lstat, mkdir, open, rename, rm, utimes, type FileHandle } from "node:fs/promises"
import path from "node:path"
import { crc32 } from "node:zlib"
import { ArchiveError, throwIfAborted, toArchiveIoError } from "./errors.js"
import { assertSafeEntryName, normalizeEntryName } from "./paths.js"
import {
  openArchiveReader,
  readEntryChunks,
  readZipDirectory,
  type ArchiveEntryInfo,
  type ArchiveInput,
} from "./zip.js"

export interface ArchiveExtractProgress {
  done: number
  total: number
  bytes: number
  name: string
}

export interface ArchiveExtractOptions {
  signal?: AbortSignal
  /** Оставить только записи, прошедшие проверку. */
  include?: (entry: ArchiveEntryInfo) => boolean
  /** Срезать общий корень архива, например `overrides/`. */
  stripPrefix?: string
  /**
   * Приводить имена к безопасным для Windows: архив мог быть собран на
   * Linux/macOS и содержать `:`, `?`, `*` и другие недопустимые символы.
   * Записи с `.`/`..` в пути при этом пропускаются.
   */
  sanitizeNames?: boolean
  /** Перезаписывать существующие файлы (по умолчанию да). */
  overwrite?: boolean
  /** Пропускать небезопасные записи вместо ошибки. */
  skipUnsafe?: boolean
  /** Что делать со ссылками: пропустить (по умолчанию) или прервать распаковку. */
  symlinks?: "skip" | "error"
  maxEntries?: number
  maxEntrySize?: number
  maxCompressionRatio?: number
  maxTotalSize?: number
  progressIntervalMs?: number
  onProgress?: (progress: ArchiveExtractProgress) => void
}

export interface ArchiveExtractResult {
  files: number
  bytes: number
  skipped: number
}

const MAX_TOTAL_SIZE = 8 * 1024 * 1024 * 1024

interface PendingFile {
  entry: ArchiveEntryInfo
  relative: string
  target: string
}

function normalizePrefix(prefix?: string): string {
  if (!prefix) return ""
  const normalized = normalizeEntryName(prefix)
  if (!normalized) return ""
  return normalized.endsWith("/") ? normalized : `${normalized}/`
}

function relativeEntryName(name: string, prefix: string): string | null {
  if (!prefix) return name
  if (!name.startsWith(prefix)) return null
  const relative = name.slice(prefix.length)
  return relative || null
}

/** Символы, недопустимые в именах файлов Windows. */
const INVALID_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g

/**
 * Приводит путь записи к виду, пригодному для файловой системы Windows.
 * Возвращает `null`, если путь содержит `.`/`..`: такие записи пропускаются
 * целиком, а не переписываются в другое место.
 */
function sanitizeRelativePath(relative: string): string | null {
  const segments = normalizeEntryName(relative).split("/").filter(Boolean)
  const cleaned: string[] = []
  for (const segment of segments) {
    if (segment === "." || segment === "..") return null
    const trimmed = segment.trim().replace(INVALID_NAME_CHARACTERS, "_")
    if (!trimmed) return null
    cleaned.push(trimmed)
  }
  return cleaned.length ? cleaned.join("/") : null
}

/**
 * Создаёт каталог, проверяя, что ни один его сегмент не является ссылкой.
 *
 * Распаковка не должна писать сквозь symlink, оставленный предыдущей
 * установкой: иначе запись архива окажется за пределами каталога назначения.
 */
async function prepareDirectory(root: string, target: string, verified: Set<string>): Promise<void> {
  const relative = path.relative(root, target)
  if (!relative) return
  const segments = relative.split(path.sep)
  let current = root
  for (const segment of segments) {
    if (!segment) continue
    current = path.join(current, segment)
    if (verified.has(current)) continue
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new ArchiveError("UNSAFE_ENTRY", `Destination path contains a symlink: ${current}`)
      if (!stat.isDirectory()) throw new ArchiveError("UNSAFE_ENTRY", `Destination path is not a directory: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      try {
        await mkdir(current)
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError
        const stat = await lstat(current)
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new ArchiveError("UNSAFE_ENTRY", `Unsafe destination directory: ${current}`)
        }
      }
    }
    verified.add(current)
  }
}

function resolveTarget(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relative)
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep
  if (!resolved.startsWith(prefix)) {
    throw new ArchiveError("UNSAFE_ENTRY", `Archive entry escapes the destination: ${relative}`, relative)
  }
  return resolved
}

async function writeEntry(
  reader: Awaited<ReturnType<typeof openArchiveReader>>,
  file: PendingFile,
  options: ArchiveExtractOptions,
): Promise<number> {
  const { entry, target, relative } = file
  const temporary = path.join(path.dirname(target), `.xnlc-${randomUUID()}.partial`)
  let owned = false
  let handle: FileHandle | undefined
  let written = 0
  let checksum = 0
  try {
    const existing = await lstat(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return undefined
    })
    if (existing?.isSymbolicLink()) throw new ArchiveError("UNSAFE_ENTRY", `Destination file is a symlink: ${target}`, entry.name)
    if (existing && options.overwrite === false) throw new ArchiveError("IO_ERROR", `Destination exists: ${target}`, entry.name)
    handle = await open(temporary, "wx")
    owned = true
    for await (const chunk of readEntryChunks(reader, entry, { signal: options.signal, maxCompressionRatio: options.maxCompressionRatio })) {
      throwIfAborted(options.signal)
      written += chunk.length
      if (written > entry.size) {
        throw new ArchiveError("INVALID_ARCHIVE", `Archive entry ${entry.name} expands beyond its declared size`, entry.name)
      }
      checksum = crc32(chunk, checksum)
      let offset = 0
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset)
        if (!bytesWritten) throw new ArchiveError("IO_ERROR", `Cannot write archive entry: ${entry.name}`, entry.name)
        offset += bytesWritten
      }
    }
    if ((checksum >>> 0) !== (entry.crc >>> 0)) {
      throw new ArchiveError("INVALID_ARCHIVE", `Checksum mismatch for ${entry.name}`, entry.name)
    }
    if (entry.mtime) await handle.utimes(entry.mtime, entry.mtime)
    await handle.close()
    handle = undefined
    throwIfAborted(options.signal)
    if (options.overwrite === false) await link(temporary, target)
    else {
      await rename(temporary, target)
      owned = false
    }
    return written
  } catch (error) {
    throw toArchiveIoError(error, relative)
  } finally {
    await handle?.close().catch(() => {})
    if (owned) await rm(temporary, { force: true }).catch(() => {})
  }
}

/**
 * Потоково распаковывает ZIP в каталог.
 *
 * Каталог читается один раз, затем каждая запись распаковывается отдельным
 * потоком: в памяти живёт только текущий чанк, прогресс отдаётся не чаще
 * `progressIntervalMs` (по умолчанию 100 мс).
 */
export async function extractArchive(
  input: ArchiveInput,
  destination: string,
  options: ArchiveExtractOptions = {},
): Promise<ArchiveExtractResult> {
  throwIfAborted(options.signal)
  const root = path.resolve(destination)
  await mkdir(root, { recursive: true })
  if ((await lstat(root)).isSymbolicLink()) {
    throw new ArchiveError("UNSAFE_ENTRY", `Destination root is a symlink: ${root}`)
  }
  const verifiedDirectories = new Set<string>([root])
  const prefix = normalizePrefix(options.stripPrefix)
  const reader = await openArchiveReader(input)
  const started = Date.now()
  let lastProgress = 0
  let bytes = 0
  let files = 0
  let skipped = 0

  try {
    const entries = await readZipDirectory(reader, { signal: options.signal })
    const pending: PendingFile[] = []
    const directories: PendingFile[] = []
    const targets = new Set<string>()
    let declaredSize = 0

    for (const entry of entries) {
      throwIfAborted(options.signal)
      if (entry.symlink) {
        if (options.symlinks === "error") {
          throw new ArchiveError("UNSAFE_ENTRY", `Archive entry is a symlink: ${entry.name}`, entry.name)
        }
        skipped++
        continue
      }
      if (options.include && !options.include(entry)) continue
      const stripped = relativeEntryName(entry.name, prefix)
      if (!stripped) continue
      const relative = options.sanitizeNames ? sanitizeRelativePath(stripped) : stripped
      if (!relative) {
        if (options.sanitizeNames) skipped++
        continue
      }
      try {
        assertSafeEntryName(relative)
        if (process.platform === "win32" && relative.split("/").some(part =>
          /[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part))) {
          throw new ArchiveError("UNSAFE_ENTRY", `Unsafe Windows path: ${relative}`, entry.name)
        }
      } catch (error) {
        if (!options.skipUnsafe) throw error
        skipped++
        continue
      }
      const target = resolveTarget(root, relative)
      const key = process.platform === "win32" ? target.toLowerCase() : target
      if (targets.has(key)) throw new ArchiveError("INVALID_ARCHIVE", `Duplicate destination: ${relative}`, entry.name)
      targets.add(key)
      if (entry.directory) { directories.push({ entry, relative, target }); continue }
      if (entry.size > (options.maxEntrySize ?? MAX_TOTAL_SIZE)) throw new ArchiveError("LIMIT_EXCEEDED", `Entry too large: ${entry.name}`, entry.name)
      pending.push({ entry, relative, target })
      declaredSize += entry.size
    }

    const maxEntries = options.maxEntries ?? 500_000
    if (pending.length + directories.length > maxEntries) {
      throw new ArchiveError("LIMIT_EXCEEDED", `Archive extracts ${pending.length} files, limit is ${maxEntries}`)
    }
    const maxTotalSize = options.maxTotalSize ?? MAX_TOTAL_SIZE
    if (declaredSize > maxTotalSize) {
      throw new ArchiveError("LIMIT_EXCEEDED", `Archive extracts ${declaredSize} bytes, limit is ${maxTotalSize}`)
    }

    const total = pending.length
    const interval = options.progressIntervalMs ?? 100
    for (const file of pending) {
      throwIfAborted(options.signal)
      await prepareDirectory(root, path.dirname(file.target), verifiedDirectories)
      bytes += await writeEntry(reader, file, options)
      files++
      const now = Date.now()
      if (options.onProgress && (files === total || now - lastProgress >= interval)) {
        lastProgress = now
        options.onProgress({ done: files, total, bytes, name: file.relative })
      }
    }
    for (const { target } of directories) {
      throwIfAborted(options.signal)
      await prepareDirectory(root, target, verifiedDirectories)
    }
    for (const { entry, target } of directories.sort((a, b) => b.target.length - a.target.length)) {
      if (entry.mtime) await utimes(target, entry.mtime, entry.mtime)
    }
    if (options.onProgress && total === 0 && Date.now() - started >= 0) {
      options.onProgress({ done: 0, total: 0, bytes: 0, name: "" })
    }
    return { files, bytes, skipped }
  } finally {
    await reader.close()
  }
}
