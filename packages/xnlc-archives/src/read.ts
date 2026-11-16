import { crc32 } from "node:zlib"
import { ArchiveError, throwIfAborted } from "./errors.js"
import { normalizeEntryName } from "./paths.js"
import {
  openArchiveReader,
  readEntryChunks,
  readZipDirectory,
  type ArchiveEntryInfo,
  type ArchiveInput,
} from "./zip.js"

export interface ArchiveReadOptions {
  signal?: AbortSignal
  /** Максимальный размер одной читаемой записи (по умолчанию 32 МиБ). */
  maxEntrySize?: number
  maxEntries?: number
  maxCompressionRatio?: number
  /** Максимальный суммарный размер читаемых записей (по умолчанию 256 МиБ). */
  maxTotalSize?: number
}

const DEFAULT_MAX_ENTRY_SIZE = 32 * 1024 * 1024
const DEFAULT_MAX_TOTAL_SIZE = 256 * 1024 * 1024

function indexEntries(entries: ArchiveEntryInfo[]): Map<string, ArchiveEntryInfo> {
  const index = new Map<string, ArchiveEntryInfo>()
  for (const entry of entries) {
    if (entry.directory) continue
    index.set(entry.name, entry)
  }
  return index
}

/** Список записей архива без распаковки содержимого. */
export async function listArchiveEntries(
  input: ArchiveInput,
  options: { signal?: AbortSignal; maxEntries?: number; maxDirectorySize?: number } = {},
): Promise<ArchiveEntryInfo[]> {
  const reader = await openArchiveReader(input)
  try {
    return await readZipDirectory(reader, options)
  } finally {
    await reader.close()
  }
}

/** Открывает каталог один раз; чтение записей доступно до завершения callback. */
export async function withArchiveEntries<T>(
  input: ArchiveInput,
  visit: (entries: ArchiveEntryInfo[], read: (entry: ArchiveEntryInfo) => Promise<Buffer>) => T | Promise<T>,
  options: ArchiveReadOptions = {},
): Promise<T> {
  const reader = await openArchiveReader(input)
  try {
    const entries = await readZipDirectory(reader, options)
    const maxEntrySize = options.maxEntrySize ?? DEFAULT_MAX_ENTRY_SIZE
    const maxTotalSize = options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE
    let total = 0
    const read = async (entry: ArchiveEntryInfo) => {
      if (entry.symlink) throw new ArchiveError("UNSAFE_ENTRY", `Archive entry is a symlink: ${entry.name}`, entry.name)
      if (entry.size > maxEntrySize || total + entry.size > maxTotalSize) {
        throw new ArchiveError("LIMIT_EXCEEDED", `Archive read budget exceeded: ${entry.name}`, entry.name)
      }
      total += entry.size
      let checksum = 0
      let buffer: Buffer | undefined
      let offset = 0
      for await (const chunk of readEntryChunks(reader, entry, options)) {
        if (!buffer && chunk.length === entry.size && entry.method !== 0) {
          // Результат DEFLATE уже выделен отдельно. STORE может ссылаться на входной ZIP.
          buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        } else {
          buffer ??= Buffer.allocUnsafe(entry.size)
          buffer.set(chunk, offset)
        }
        offset += chunk.length
        checksum = crc32(chunk, checksum)
      }
      if ((checksum >>> 0) !== (entry.crc >>> 0)) {
        throw new ArchiveError("INVALID_ARCHIVE", `Checksum mismatch for ${entry.name}`, entry.name)
      }
      return buffer ?? Buffer.alloc(0)
    }
    return await visit(entries, read)
  } finally {
    await reader.close()
  }
}

/** Читает выбранные записи архива в память (для метаданных, а не для контента сборки). */
export async function readArchiveEntries(
  input: ArchiveInput,
  names: string[],
  options: ArchiveReadOptions = {},
): Promise<Map<string, Buffer>> {
  return withArchiveEntries(input, async (entries, read) => {
    const index = indexEntries(entries)
    const results = new Map<string, Buffer>()
    for (const name of names) {
      throwIfAborted(options.signal)
      const entry = index.get(normalizeEntryName(name))
      if (entry) results.set(name, await read(entry))
    }
    return results
  }, options)
}

/** Читает одну запись или возвращает `null`, если её нет. */
export async function readArchiveEntry(
  input: ArchiveInput,
  name: string,
  options: ArchiveReadOptions = {},
): Promise<Buffer | null> {
  const result = await readArchiveEntries(input, [name], options)
  return result.get(name) ?? null
}

export interface ArchiveTextOptions extends ArchiveReadOptions {
  encoding?: BufferEncoding
}

function decodeText(data: Buffer, encoding: BufferEncoding): string {
  return data.toString(encoding)
}

/** Читает выбранные текстовые записи (манифесты, plugin.yml и т.п.). */
export async function readArchiveEntriesText(
  input: ArchiveInput,
  names: string[],
  options: ArchiveTextOptions = {},
): Promise<Map<string, string>> {
  const buffers = await readArchiveEntries(input, names, options)
  const encoding = options.encoding ?? "utf8"
  return new Map([...buffers].map(([name, data]) => [name, decodeText(data, encoding)]))
}

/** Читает одну текстовую запись или возвращает `null`. */
export async function readArchiveEntryText(
  input: ArchiveInput,
  name: string,
  options: ArchiveTextOptions = {},
): Promise<string | null> {
  const data = await readArchiveEntry(input, name, options)
  return data ? decodeText(data, options.encoding ?? "utf8") : null
}
