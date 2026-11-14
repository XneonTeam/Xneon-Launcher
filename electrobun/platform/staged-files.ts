import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { registerShutdownTask, SHUTDOWN_PRIORITY } from "./shutdown"

/*
 * Файлы из renderer переносятся в main чанками: у Electron был
 * `webUtils.getPathForFile`, у Electrobun аналога нет, поэтому файл читается
 * на стороне renderer и складывается во временный каталог.
 *
 * Один RPC-запрос ограничен `STAGE_FILE_CHUNK_BYTES`: раньше весь файл
 * уходил одной base64-строкой и не влезал в 64 МБ, теперь размер файла
 * ограничен только диском (лимиты ниже — предохранитель от переполнения).
 */

/** Сколько байт передаётся одним RPC-запросом (ответ попадает и в renderer). */
export const STAGE_FILE_CHUNK_BYTES = 8 * 1024 * 1024
/** Предел одного файла: миры и модпаки больше не упираются в 64 МБ. */
const maxFileBytes = 8 * 1024 * 1024 * 1024
/** Предел всех не удалённых временных файлов процесса. */
const maxStagedBytes = 16 * 1024 * 1024 * 1024

const directories = new Set<string>()
const uploads = new Map<string, Upload>()
let stagedBytes = 0

type Upload = {
  directory: string
  file: string
  expectedBytes: number
  writtenBytes: number
}

const validName = (name: unknown): name is string =>
  typeof name === "string" && Boolean(name) && name.length <= 240 && !/[<>:"/\\|?*\x00-\x1f]/.test(name)
  && name !== "." && name !== ".." && !/[. ]$/.test(name)

/** Начинает загрузку: резервирует место и создаёт временный каталог. */
export async function beginUpload(name: string, size: number) {
  if (!validName(name)) throw new Error("Invalid local file")
  if (!Number.isSafeInteger(size) || size < 0 || size > maxFileBytes) throw new Error("Local file limit exceeded")
  if (stagedBytes + size > maxStagedBytes) throw new Error("Local file limit exceeded")
  const directory = await mkdtemp(path.join(tmpdir(), "xneon-bun-upload-"))
  stagedBytes += size
  directories.add(directory)
  const id = randomUUID()
  uploads.set(id, { directory, file: path.join(directory, name), expectedBytes: size, writtenBytes: 0 })
  return { id, chunkBytes: STAGE_FILE_CHUNK_BYTES }
}

/**
 * Дописывает чанк. Путь возвращается только на `final`: renderer не знает,
 * где окажется файл, и не может передать путь сам.
 */
export async function appendUpload(id: string, encoded: string, final: boolean) {
  const upload = typeof id === "string" ? uploads.get(id) : undefined
  if (!upload) throw new Error("Unknown local file upload")
  if (typeof encoded !== "string") throw new Error("Invalid local file")
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.length > STAGE_FILE_CHUNK_BYTES) throw new Error("Invalid local file")
  if (upload.writtenBytes + bytes.length > upload.expectedBytes) {
    await abortUpload(id)
    throw new Error("Local file limit exceeded")
  }
  try {
    // Первый чанк создаёт файл эксклюзивно, остальные дописываются.
    await writeFile(upload.file, bytes, { flag: upload.writtenBytes === 0 ? "wx" : "a" })
  } catch (error) {
    await abortUpload(id)
    throw error
  }
  upload.writtenBytes += bytes.length
  if (!final) return ""
  if (upload.writtenBytes !== upload.expectedBytes) {
    await abortUpload(id)
    throw new Error("Invalid local file")
  }
  // Файл готов: каталог остаётся до выхода из приложения (его удалит cleanup).
  uploads.delete(id)
  return upload.file
}

/** Отменяет загрузку и удаляет недописанный файл. */
export async function abortUpload(id: string) {
  const upload = typeof id === "string" ? uploads.get(id) : undefined
  if (!upload) return
  uploads.delete(id)
  stagedBytes -= upload.expectedBytes
  directories.delete(upload.directory)
  await rm(upload.directory, { recursive: true, force: true }).catch(() => {})
}

export function registerStagedFileCleanup() {
  registerShutdownTask("staged-files", async () => {
    const pending = [...directories]
    uploads.clear()
    const results = await Promise.allSettled(pending.map(async directory => {
      await rm(directory, { recursive: true, force: true })
      directories.delete(directory)
    }))
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
    if (failed) throw failed.reason
    stagedBytes = 0
  }, { priority: SHUTDOWN_PRIORITY.files, timeoutMs: 3000 })
}
