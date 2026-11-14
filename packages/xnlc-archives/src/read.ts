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

async function readEntryBuffer(
  input: ArchiveInput,
  entries: ArchiveEntryInfo[],
  names: string[],
  options: ArchiveReadOptions,
): Promise<Map<string, Buffer>> {
  const maxEntrySize = options.maxEntrySize ?? DEFAULT_MAX_ENTRY_SIZE
  const maxTotalSize = options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE
  const index = indexEntries(entries)
  const result = new Map<string, Buffer>()
  const reader = await openArchiveReader(input)
  let total = 0
  try {
    for (const requested of names) {
      throwIfAborted(options.signal)
      const normalized = normalizeEntryName(requested)
      const entry = index.get(normalized)
      if (!entry) continue
      if (entry.symlink) throw new ArchiveError("UNSAFE_ENTRY", `Archive entry is a symlink: ${entry.name}`, entry.name)
      if (entry.size > maxEntrySize) {
        throw new ArchiveError("LIMIT_EXCEEDED", `Archive entry ${entry.name} is ${entry.size} bytes, limit is ${maxEntrySize}`, entry.name)
      }
      if (total + entry.size > maxTotalSize) {
        throw new ArchiveError("LIMIT_EXCEEDED", `Archive entries exceed the ${maxTotalSize} byte limit`, entry.name)
      }
      const chunks: Buffer[] = []
      let length = 0
      let checksum = 0
      for await (const chunk of readEntryChunks(reader, entry, { signal: options.signal })) {
        chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
        length += chunk.length
        checksum = crc32(chunk, checksum)
        if (length > maxEntrySize) {
          throw new ArchiveError("LIMIT_EXCEEDED", `Archive entry ${entry.name} exceeds the ${maxEntrySize} byte limit`, entry.name)
        }
      }
      if ((checksum >>> 0) !== (entry.crc >>> 0)) {
        throw new ArchiveError("INVALID_ARCHIVE", `Checksum mismatch for ${entry.name}`, entry.name)
      }
      total += length
      result.set(requested, Buffer.concat(chunks, length))
    }
    return result
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
  const entries = await listArchiveEntries(input, { signal: options.signal })
  return readEntryBuffer(input, entries, names, options)
}

/** Читает одну запись или возвращает `null`, если её нет. */
export async function readArchiveEntry(
  input: ArchiveInput,
  name: string,
  options: ArchiveReadOptions = {},
): Promise<Buffer | null> {
  const entries = await listArchiveEntries(input, { signal: options.signal })
  const result = await readEntryBuffer(input, entries, [name], options)
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
