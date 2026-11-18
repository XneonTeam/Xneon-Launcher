// ============================================================
// XNLC — кэш скачанных jar-файлов
// Author: MAINER4IK
// ============================================================
//
// Мод, который мы анализируем перед установкой, скачивается целиком. Второй раз
// тянуть те же байты при самой установке незачем, поэтому файл кладём в кэш по
// хэшу URL и оттуда же потом забираем при сохранении в сборку.

import crypto from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"

/** Кэш живёт три дня: этого хватает, чтобы не копить мусор, и не мешает обновлениям. */
const JAR_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

function getJarCacheDir(): string {
  return path.join(os.tmpdir(), "xneon-jar-cache")
}

function getJarCacheFile(url: string): string {
  const key = crypto.createHash("sha1").update(url).digest("hex")
  return path.join(getJarCacheDir(), `${key}.jar`)
}

/** Путь к уже скачанному файлу, если он есть в кэше и ещё не устарел. */
export async function getCachedJarPath(url: string): Promise<string | null> {
  const file = getJarCacheFile(url)
  try {
    const stat = await fs.stat(file)
    if (stat.size > 0 && Date.now() - stat.mtimeMs < JAR_CACHE_MAX_AGE_MS) {
      return file
    }
  } catch {
    // Файла нет — обычная ситуация, скачаем.
  }
  return null
}

/** Скачивает jar в кэш и возвращает путь. Загрузчик передаёт вызывающий код. */
export async function cacheJarFromUrl(
  url: string,
  download: (url: string, temporary: string) => Promise<Buffer | void>,
): Promise<string | null> {
  const cached = await getCachedJarPath(url)
  if (cached) return cached

  const file = getJarCacheFile(url)
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    const dir = getJarCacheDir()
    await fs.mkdir(dir, { recursive: true })
    const buffer = await download(url, temporary)
    // Совместимость с существующими buffer-загрузчиками; production пишет поток.
    if (buffer) await fs.writeFile(temporary, buffer)
    await fs.rename(temporary, file)
    return file
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("CONTENT_DOWNLOAD_CANCELLED"))) throw error
    console.warn("[jar-cache] не удалось скачать файл для анализа:", error)
    return null
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}
